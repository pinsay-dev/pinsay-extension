import { projectOptionsHtml } from './project-options';
import { SERVER, hostnameOf, type BgRequest, type StoredUser, type ExtProject, type WorkspaceChoice, type ExtEnvironment } from './shared';
import { chooseProject, type ProjectChoice } from './match';
import { siteName, pickEnvironment } from './slug';
import { inviteTokenFromUrl } from './invite';
import { t, LANG, waitText } from './i18n';
import { unclaimedEligible } from './unclaimed';
import { resendSecondsLeft, authOutcomeMessageKey, throttledBackToCode } from './signup';
import { footerHtml, CHANGELOG_URL } from './footer';

if (LANG === 'ar') { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl'; }
const root = document.getElementById('root')!;
const errEl = document.getElementById('err')!;

function send<T = any>(msg: BgRequest): Promise<T> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}
async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function err(msg: string) { errEl.textContent = msg; }

/** 2026-10-28: the popup's text for a throttled answer (this address vs the network), wait in minutes. */
function limitMessage(status: string, seconds: number | null): string {
  const s = seconds ?? 60;
  if (status === 'rate_limited') return t('rateLimited', { wait: waitText(s, LANG) });
  return t(s > 60 ? 'throttledMany' : 'throttled', { wait: waitText(s, LANG) });
}

// Product name from the server's central branding (GET /api/branding is public). Defaults to
// "PinSay"; the popup's static <h1> and rendered copy are updated to match at render time.
let PRODUCT = 'PinSay';
async function loadProduct(): Promise<void> {
  try {
    const r = await fetch(SERVER + '/api/branding', { headers: { accept: 'application/json' } });
    if (r.ok) { const b = await r.json(); const d = (b && (b.data || b)) || {}; if (d.productName) PRODUCT = d.productName; }
  } catch { /* keep the default */ }
  const brand = document.getElementById('brand');
  if (brand) brand.textContent = PRODUCT + ' Feedback';
}

/** "Acme · Admin", "Personal · Home": the role, or Home for the account's own workspace. */
function workspaceLabel(w: WorkspaceChoice): string {
  const detail = w.isHome ? 'Home' : (w.roleName || '');
  return detail ? `${w.name} · ${detail}` : w.name;
}

type PopupState = {
  user: StoredUser | null; hasToken: boolean;
  pendingSignup: { email: string; sentAt: number; flow: 'sign-in' | 'sign-up' } | null; postSignup: boolean;
  pendingChoice: { workspaces: WorkspaceChoice[]; selectionToken: string; email: string } | null;
  authOutcome: { status: string; email: string } | null;
};

async function render() {
  err('');
  const state = await send<PopupState>({ type: 'getState' });
  await loadProduct();
  // A code sign-in finished while the popup was closed: show its picker or its message (kept by the background).
  if (!state.hasToken && state.pendingChoice) return renderChooseWorkspace(state.pendingChoice.workspaces, state.pendingChoice.selectionToken);
  if (!state.hasToken && state.authOutcome) {
    const key = authOutcomeMessageKey(state.authOutcome.status);
    if (key) { await renderAuth(state.authOutcome.email); return err(t(key)); }
  }
  if (!state.hasToken && state.pendingSignup) {
    const r = await send<{ status: string; workspaces?: WorkspaceChoice[]; selectionToken?: string }>({ type: 'extPollSession' });
    if (r.status === 'ok') return render();
    if (r.status === 'choose-workspace' && r.workspaces && r.selectionToken) return renderChooseWorkspace(r.workspaces, r.selectionToken);
    if (r.status === 'pending_approval') { void send({ type: 'clearAuthOutcome' }); return renderWaitingApproval(); }
    if (r.status === 'pending_confirmation') return renderCheckEmail(state.pendingSignup.email, state.pendingSignup.sentAt, state.pendingSignup.flow);
    // The poll just finished the sign-in without a session: say why here (and drop the copy kept for the next open).
    const failure = authOutcomeMessageKey(r.status);
    if (failure) { void send({ type: 'clearAuthOutcome' }); await renderAuth(state.pendingSignup.email); return err(t(failure)); }
    return renderSignedOut();
  }
  if (!state.hasToken) return renderSignedOut();
  return renderMain(state.user, state.postSignup);
}

/** Signed out: on a visitor-enabled site offer the visitor entry points, otherwise the team sign-in. */
async function renderSignedOut() {
  const tab = await currentTab();
  const rawUrl = tab?.url || '';
  if (!tab || tab.id === undefined || !/^https?:/.test(rawUrl)) return renderAuth();
  const origin = new URL(rawUrl).origin;
  const hostname = hostnameOf(rawUrl);
  const found = await send<{ ok: boolean; project: { key: string; name: string } | null }>({ type: 'visitorProjectForOrigin', origin });
  if (!found.ok || !found.project) return unclaimedEligible(rawUrl) ? renderUnclaimedCard(tab.id, origin) : renderAuth();
  const project = found.project;
  const tabState = await send<{ visitor?: boolean }>({ type: 'getTabState', tabId: tab.id, hostname });
  setView(`
    <h2>${esc(t('visitorSiteTitle', { name: project.name }))}</h2>
    <button class="primary" id="v-leave">${esc(t('visitorLeave'))}</button>
    <button class="secondary" id="v-track">${esc(t('visitorTrack'))}</button>
    <button class="ghost secondary" id="v-team">${esc(t('visitorTeamSignIn'))}</button>
    ${tabState?.visitor ? `<button class="ghost secondary" id="v-off">${esc(t('visitorTurnOff'))}</button>` : ''}
    <div class="note">${esc(t('visitorNote'))}</div>`);
  const buttons = ['v-leave', 'v-track'].map((id) => document.getElementById(id) as HTMLButtonElement);
  const start = (entry: 'leave' | 'track') => async () => {
    err('');
    buttons.forEach((b) => { b.disabled = true; });
    // Synchronously first: chrome.permissions.request only honors a direct user gesture.
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    const res = granted ? await send<{ ok: boolean }>({ type: 'activateVisitor', tabId: tab.id!, hostname, origin, project: project.key, entry }) : null;
    if (!res || !res.ok) {
      buttons.forEach((b) => { b.disabled = false; });
      return err(t('networkError'));
    }
    window.close();
  };
  buttons[0].onclick = start('leave');
  buttons[1].onclick = start('track');
  (document.getElementById('v-team') as HTMLButtonElement).onclick = () => renderAuth();
  const off = document.getElementById('v-off') as HTMLButtonElement | null;
  if (off) off.onclick = async () => {
    err('');
    await send({ type: 'deactivate', tabId: tab.id! });
    render();
  };
}

/** Universal capture: permission (needs the click's user gesture), then a one-shot unclaimed injection. */
async function startUnclaimed(tabId: number, origin: string, button: HTMLButtonElement) {
  err('');
  button.disabled = true;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  const res = granted ? await send<{ ok: boolean }>({ type: 'activateUnclaimed', tabId, origin }) : null;
  if (!res || !res.ok) { button.disabled = false; return err(t('networkError')); }
  window.close();
}

/** Signed out on a site with no visitor feedback: the Universal Feedback Card, plus the team sign-in. */
async function renderUnclaimedCard(tabId: number, origin: string) {
  const tabState = await send<{ unclaimed?: boolean }>({ type: 'getTabState', tabId, hostname: new URL(origin).hostname });
  setView(`
    <h2>${esc(t('unclaimedTitle'))}</h2>
    <div class="note">${esc(t('unclaimedNote', { product: PRODUCT }))}</div>
    <button class="primary" id="u-leave">${esc(t('unclaimedLeave'))}</button>
    <button class="ghost secondary" id="v-team">${esc(t('visitorTeamSignIn'))}</button>
    ${tabState?.unclaimed ? `<button class="ghost secondary" id="u-off">${esc(t('visitorTurnOff'))}</button>` : ''}`);
  const leave = document.getElementById('u-leave') as HTMLButtonElement;
  leave.onclick = () => startUnclaimed(tabId, origin, leave);
  (document.getElementById('v-team') as HTMLButtonElement).onclick = () => renderAuth();
  const off = document.getElementById('u-off') as HTMLButtonElement | null;
  if (off) off.onclick = async () => {
    err('');
    await send({ type: 'deactivate', tabId });
    render();
  };
}

// ---- create account ------------------------------------------------------
let tickTimer: ReturnType<typeof setInterval> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
/** Replaces the view; stops the previous view's countdown. */
function setView(html: string) {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  root.innerHTML = html;
}
function focusById(id: string) { (document.getElementById(id) as HTMLElement | null)?.focus(); }
function onEnter(id: string, fn: () => void) {
  (document.getElementById(id) as HTMLElement).onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') fn(); };
}

async function renderSignup(prefillEmail = '') {
  err('');
  const en = await send<{ enabled: boolean }>({ type: 'signupEnabled' });
  if (!en.enabled) return renderSignupClosed();
  setView(`
    <label for="su-name">${esc(t('name'))}</label>
    <input id="su-name" autocomplete="name" />
    <label for="su-email">${esc(t('email'))}</label>
    <input id="su-email" type="email" autocomplete="email" value="${esc(prefillEmail)}" />
    <button class="primary" id="su-submit">${esc(t('createAccount'))}</button>
    <button class="ghost secondary" id="su-have">${esc(t('haveAccount'))}</button>`);
  focusById('su-name');
  const submit = async () => {
    err('');
    const displayName = (document.getElementById('su-name') as HTMLInputElement).value.trim();
    const email = (document.getElementById('su-email') as HTMLInputElement).value.trim();
    if (!displayName || !email) return err(t('enterNameEmail'));
    const btn = document.getElementById('su-submit') as HTMLButtonElement;
    btn.disabled = true;
    const r = await send<{ ok: boolean; status: string; message: string | null; email: string; resendAfterSeconds: number | null }>({ type: 'extSignup', displayName, email });
    if (r.status === 'code_sent') return renderCheckEmail(r.email || email, Date.now(), 'sign-up');
    if (r.status === 'signup_closed') return renderSignupClosed();
    btn.disabled = false;
    if (r.status === 'throttled' || r.status === 'rate_limited') return err(limitMessage(r.status, r.resendAfterSeconds));
    err(r.message || t('networkError'));
  };
  (document.getElementById('su-submit') as HTMLButtonElement).onclick = submit;
  (document.getElementById('su-have') as HTMLButtonElement).onclick = () => renderAuth();
  for (const id of ['su-name', 'su-email']) onEnter(id, submit);
}

function renderSignupClosed() {
  err('');
  setView(`
    <div class="who">${esc(t('signupClosedTitle'))}</div>
    <div class="note spaced">${esc(t('signupClosedBody'))}</div>
    <button class="primary" id="closed-signin">${esc(t('signIn'))}</button>`);
  const b = document.getElementById('closed-signin') as HTMLButtonElement;
  b.onclick = () => renderAuth();
  b.focus();
}

async function renderCheckEmail(email: string, sentAt: number, flow: 'sign-in' | 'sign-up') {
  err('');
  setView(`
    <div class="who">${esc(t('checkEmailTitle'))}</div>
    <div class="note spaced">${esc(t('codeSent', { email }))}</div>
    <label for="code">${esc(t('code'))}</label>
    <input id="code" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" />
    <button class="primary" id="confirm">${esc(t('confirm'))}</button>
    <button class="ghost secondary" id="resend" disabled></button>
    <div class="note"><a id="other-email" href="#" role="button">${esc(t('differentEmail'))}</a></div>`);
  focusById('code');
  const resend = document.getElementById('resend') as HTMLButtonElement;
  const tick = () => {
    const left = resendSecondsLeft(sentAt, Date.now());
    resend.disabled = left > 0;
    resend.textContent = left > 0 ? t('resendIn', { wait: waitText(left, LANG) }) : t('resendCode');
    if (left === 0 && tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
  };
  tick();
  tickTimer = setInterval(tick, 1000);

  let confirming = false;
  const stopTimers = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
  };
  const onOutcome = (r: { status: string; welcome?: boolean; workspaces?: WorkspaceChoice[]; selectionToken?: string }): boolean => {
    if (r.status === 'ok') { stopTimers(); (flow === 'sign-up' || r.welcome ? afterSignup(false) : render()); return true; }
    if (r.status === 'choose-workspace' && r.workspaces && r.selectionToken) { stopTimers(); renderChooseWorkspace(r.workspaces, r.selectionToken); return true; }
    if (r.status === 'pending_approval') { stopTimers(); void send({ type: 'clearAuthOutcome' }); renderWaitingApproval(); return true; }
    const failure = authOutcomeMessageKey(r.status);
    if (!failure) return false;
    stopTimers();
    void send({ type: 'clearAuthOutcome' }); // shown here, so not again on the next open
    renderAuth(email);
    err(t(failure));
    return true;
  };
  const poll = async () => {
    if (confirming) return;
    const r = await send<{ status: string; welcome?: boolean; workspaces?: WorkspaceChoice[]; selectionToken?: string }>({ type: 'extPollSession' });
    if (confirming) return;
    if (r.status === 'invalid_token') {
      if (!document.getElementById('code')) { stopTimers(); return; }
      renderAuth(); return err(t('signupExpired'));
    }
    onOutcome(r);
  };
  pollTimer = setInterval(poll, 3000);

  // The answer is handled as soon as it comes. No site-access prompt here: in Chrome it takes focus and closes the
  // popup before the answer can be shown (DIAGNOSIS 2026-10-25, root cause A). Access is asked by Activate instead.
  const onConfirm = async () => {
    err('');
    const code = (document.getElementById('code') as HTMLInputElement).value.trim();
    if (!code) return err(t('enterCode'));
    const confirmBtn = document.getElementById('confirm') as HTMLButtonElement;
    confirmBtn.disabled = true;
    confirming = true;
    const r = await send<{ status: string; attemptsLeft: number | null; welcome?: boolean; workspaces?: WorkspaceChoice[]; selectionToken?: string }>({ type: 'extVerifyCode', code });
    if (onOutcome(r)) return;
    if (r.status === 'invalid_token') { renderAuth(); return err(t('signupExpired')); }
    confirming = false;
    confirmBtn.disabled = false;
    if (r.status === 'wrong_code') return err(t('wrongCode', { n: r.attemptsLeft ?? 0 }));
    if (r.status === 'code_dead') return err(t('codeDead'));
    err(t('networkError'));
  };
  (document.getElementById('confirm') as HTMLButtonElement).onclick = onConfirm;
  onEnter('code', onConfirm);

  resend.onclick = async () => {
    err('');
    resend.disabled = true;
    const r = await send<{ status: string; resendAfterSeconds: number | null }>({ type: 'extResendCode' });
    if (r.status === 'code_sent') sentAt = Date.now();
    else if (r.status === 'throttled') sentAt = Date.now() - 60_000 + (r.resendAfterSeconds ?? 60) * 1000;
    else if (r.status === 'rate_limited') err(limitMessage(r.status, r.resendAfterSeconds));
    else if (r.status === 'invalid_token') { renderAuth(); return err(t('signupExpired')); }
    else err(t('networkError'));
    if (!tickTimer) tickTimer = setInterval(tick, 1000);
    tick();
  };
  const other = document.getElementById('other-email') as HTMLElement;
  other.onclick = async (e) => { e.preventDefault(); await send({ type: 'extForgetSignup' }); if (flow === 'sign-in') renderAuth(); else renderSignup(); };
}

function renderWaitingApproval() {
  err('');
  setView(`
    <div class="who">${esc(t('waitingTitle'))}</div>
    <div class="note spaced">${esc(t('waitingBody'))}</div>
    <button class="primary" id="check-again">${esc(t('checkAgain'))}</button>
    <div class="note"><a id="other-email" href="#" role="button">${esc(t('differentEmail'))}</a></div>`);
  const check = document.getElementById('check-again') as HTMLButtonElement;
  check.focus();
  check.onclick = async () => {
    err('');
    check.disabled = true;
    const r = await send<{ status: string }>({ type: 'extPollSession' });
    if (r.status === 'ok') return afterSignup(false);
    check.disabled = false;
    if (r.status === 'invalid_token') { renderAuth(); return err(t('signupExpired')); }
    if (r.status !== 'pending_approval') err(t('networkError'));
  };
  (document.getElementById('other-email') as HTMLElement).onclick = async (e) => { e.preventDefault(); await send({ type: 'extForgetSignup' }); renderSignup(); };
}

/** Signed up and in: on a web page we already may use, set up the first project and activate it right here. */
async function afterSignup(granted: boolean) {
  const tab = await currentTab();
  const url = tab?.url || '';
  if (tab?.id !== undefined && /^https?:/.test(url)) {
    try {
      const origin = new URL(url).origin;
      const hostname = hostnameOf(url);
      if (granted || await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
        const envs = await send<{ ok: boolean; environments: ExtEnvironment[] }>({ type: 'listEnvironments' });
        const picked = envs && envs.ok ? pickEnvironment(envs.environments, hostname) : null;
        const created = await send<{ ok: boolean; project?: ExtProject }>({
          type: 'createProject', name: siteName(hostname), appUrl: origin, appEnvironmentId: picked ? picked.id : null, takenKeys: [],
        });
        if (created.ok && created.project) {
          const res = await send<{ ok: boolean }>({ type: 'activate', tabId: tab.id, hostname, origin, project: created.project.key, environment: 'staging' });
          if (res.ok) { await send({ type: 'clearPostSignup' }); return window.close(); }
        }
      }
    } catch { /* fall through to the normal screen */ }
  }
  return render();
}

async function renderAuth(prefillEmail = '', mode: 'code' | 'password' = 'code') {
  const tab = await currentTab();
  const rawUrl = tab?.url || '';
  const inviteToken = /^https?:/.test(rawUrl) ? inviteTokenFromUrl(rawUrl) : null;
  const codeMode = mode === 'code';
  setView(`
    ${inviteToken ? `
    <div class="hint" data-tone="ok" id="invite-detected">${esc(t('inviteDetected'))}</div>
    <button class="primary" id="use-invite">${esc(t('useInvitation'))}</button>` : ''}
    <label for="email">${esc(t('email'))}</label>
    <input id="email" type="email" autocomplete="username" value="${esc(prefillEmail)}" />
    ${codeMode ? `
    <button class="primary" id="send-code">${esc(t('sendCode'))}</button>
    <button class="ghost secondary" id="use-password">${esc(t('usePassword'))}</button>` : `
    <label for="password">${esc(t('password'))}</label>
    <input id="password" type="password" autocomplete="current-password" />
    <button class="primary" id="signin">${esc(t('signIn'))}</button>
    <button class="ghost secondary" id="use-code">${esc(t('useCode'))}</button>`}
    <button class="ghost secondary" id="create-account">${esc(t('createAccount'))}</button>
    <div class="note">${esc(t('signInNote'))}</div>
    <div class="note">${esc(t('inviteReentryHint'))}</div>`);
  focusById(!codeMode && prefillEmail ? 'password' : 'email');
  const typedEmail = () => (document.getElementById('email') as HTMLInputElement).value.trim();
  if (inviteToken) {
    (document.getElementById('use-invite') as HTMLButtonElement).onclick = async () => {
      err('');
      const btn = document.getElementById('use-invite') as HTMLButtonElement;
      btn.disabled = true;
      const origin = new URL(rawUrl).origin;
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) { btn.disabled = false; return err(t('networkError')); }
      const r = await send<{ ok: boolean }>({ type: 'redeemInvite', token: inviteToken, url: rawUrl, tabId: tab!.id! });
      if (!r.ok) { btn.disabled = false; return err(t('inviteRedeemFailed')); }
      window.close();
    };
  }
  (document.getElementById('create-account') as HTMLButtonElement).onclick = () => renderSignup(typedEmail());
  if (codeMode) {
    const sendCode = async () => {
      err('');
      const email = typedEmail();
      if (!email) return err(t('enterEmail'));
      const btn = document.getElementById('send-code') as HTMLButtonElement;
      btn.disabled = true;
      const r = await send<{ status: string; message: string | null; resendAfterSeconds: number | null }>({ type: 'extMagicSignIn', email });
      if (r.status === 'code_sent') return renderCheckEmail(email, Date.now(), 'sign-in');
      btn.disabled = false;
      if (r.status === 'throttled') {
        const st = await send<PopupState>({ type: 'getState' });
        if (st.pendingSignup && throttledBackToCode(st.pendingSignup, email)) return renderCheckEmail(st.pendingSignup.email, st.pendingSignup.sentAt, st.pendingSignup.flow);
        return err(limitMessage(r.status, r.resendAfterSeconds));
      }
      if (r.status === 'rate_limited') return err(limitMessage(r.status, r.resendAfterSeconds));
      err(r.message || t('networkError'));
    };
    (document.getElementById('send-code') as HTMLButtonElement).onclick = sendCode;
    onEnter('email', sendCode);
    (document.getElementById('use-password') as HTMLButtonElement).onclick = () => renderAuth(typedEmail(), 'password');
    return;
  }
  (document.getElementById('use-code') as HTMLButtonElement).onclick = () => renderAuth(typedEmail(), 'code');
  const doLogin = async () => {
    err('');
    const email = typedEmail();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    if (!email || !password) return err(t('enterEmailPassword'));
    const r = await send<{
      ok: boolean;
      status?: string;
      message?: string;
      workspaces?: WorkspaceChoice[];
      selectionToken?: string;
    }>({ type: 'login', email, password });
    if (r.ok) return render();
    if (r.status === 'choose-workspace' && r.workspaces && r.workspaces.length > 0 && r.selectionToken) {
      return renderChooseWorkspace(r.workspaces, r.selectionToken);
    }
    err(r.status === 'pending' ? t('accountPending') : r.status === 'rejected' ? t('accountRejected') : (r.message || t('loginFailed')));
  };
  (document.getElementById('signin') as HTMLButtonElement).onclick = doLogin;
  (document.getElementById('password') as HTMLInputElement).onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
}

function renderChooseWorkspace(workspaces: WorkspaceChoice[], selectionToken: string) {
  err('');
  const defaultWs = workspaces.find((w) => w.isHome) || workspaces[0];
  const opts = workspaces.map((w) => {
    const selected = (defaultWs && defaultWs.workspaceId === w.workspaceId) ? ' selected' : '';
    return `<option value="${esc(w.workspaceId)}"${selected}>${esc(workspaceLabel(w))}</option>`;
  }).join('');

  setView(`
    <div class="bar"><span class="who">${esc(t('chooseWorkspace'))}</span></div>
    <div class="note">${esc(t('chooseWorkspaceBody'))}</div>
    <label for="workspace-select">${esc(t('workspace'))}</label>
    <select id="workspace-select">${opts}</select>
    <button class="primary" id="continue-workspace">${esc(t('continue'))}</button>
    <button class="ghost secondary" id="back-to-login">${esc(t('backToSignIn'))}</button>`);

  const doSwitch = async () => {
    err('');
    const sel = document.getElementById('workspace-select') as HTMLSelectElement | null;
    const workspaceId = sel?.value;
    if (!workspaceId) return err(t('selectWorkspace'));
    const btn = document.getElementById('continue-workspace') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;

    const res = await send<{ ok: boolean; error?: string }>({
      type: 'switchWorkspace',
      workspaceId,
      selectionToken,
    });
    if (res.ok) {
      return render();
    }
    if (btn) btn.disabled = false;
    err(res.error || t('selectWorkspaceFailed'));
  };

  (document.getElementById('continue-workspace') as HTMLButtonElement).onclick = doSwitch;
  (document.getElementById('back-to-login') as HTMLButtonElement).onclick = async () => { await send({ type: 'clearAuthOutcome' }); renderAuth(); };
}

async function renderMain(user: StoredUser | null, postSignup = false) {
  const tab = await currentTab();
  const url = tab?.url || '';
  const hostname = hostnameOf(url);
  const injectable = /^https?:/.test(url);

  const who = user ? esc(user.displayName || user.email || 'Signed in') : 'Signed in';
  // Workspace switcher: only for accounts in more than one workspace. With exactly one there is
  // nothing to choose, so nothing about workspaces is shown at all.
  const workspaces = user?.workspaces ?? [];
  const hasMultipleWorkspaces = workspaces.length > 1;
  const currentWorkspaceId =
    workspaces.find((w) => w.workspaceId === user?.workspaceId)?.workspaceId ??
    workspaces.find((w) => w.name === user?.tenantName)?.workspaceId ??
    '';
  const workspaceSwitcherHtml = hasMultipleWorkspaces ? `
    <div class="ws">
      <label for="switch-ws-select">Workspace</label>
      <select id="switch-ws-select">
        ${workspaces.map((w) => `<option value="${esc(w.workspaceId)}"${w.workspaceId === currentWorkspaceId ? ' selected' : ''}>${esc(workspaceLabel(w))}</option>`).join('')}
      </select>
    </div>` : '';

  // A member who owns no workspace can start their own (the first one; a second is created in the dashboard).
  let canCreateOwn = !!workspaces.length && !workspaces.some((w) => w.isAdmin) && !user?.isSuperAdmin;
  const extrasHtml = () => `
    ${canCreateOwn ? `<div class="note"><a id="own-ws" href="#" role="button">${esc(t('createOwnWorkspace'))}</a></div>` : ''}`;
  const postSignupHtml = postSignup ? `
    <div class="hint" data-tone="ok" id="post-signup" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span>${esc(t('openYourApp').replace('PinSay', PRODUCT))}</span>
      <a id="post-signup-x" href="#" role="button" aria-label="${esc(t('dismiss'))}" title="${esc(t('dismiss'))}">×</a>
    </div>` : '';
  const bindExtras = () => {
    const x = document.getElementById('post-signup-x') as HTMLElement | null;
    if (x) x.onclick = async (e) => { e.preventDefault(); await send({ type: 'clearPostSignup' }); postSignup = false; document.getElementById('post-signup')?.remove(); };
    const own = document.getElementById('own-ws') as HTMLElement | null;
    if (own) own.onclick = async (e) => {
      e.preventDefault();
      err('');
      const r = await send<{ status: string; message?: string | null }>({ type: 'extFirstWorkspace' });
      if (r.status === 'ok') return render();
      if (r.status === 'pending_approval') return err(t('waitingBody'));
      if (r.status === 'email_not_verified') return err(t('confirmEmailFirst'));
      if (r.status === 'already_owns') { canCreateOwn = false; own.remove(); return; }
      err(r.message || t('networkError'));
    };
  };

  const bindWorkspaceSwitcher = () => {
    const wsSelect = document.getElementById('switch-ws-select') as HTMLSelectElement | null;
    if (!wsSelect) return;
    wsSelect.onchange = async () => {
      const newWsId = wsSelect.value;
      if (newWsId === currentWorkspaceId) return;
      wsSelect.disabled = true;
      wsSelect.setAttribute('aria-busy', 'true');
      err('');
      // The background re-issues the session for that workspace and reloads activated tabs.
      const res = await send<{ ok: boolean; error?: string }>({ type: 'switchWorkspace', workspaceId: newWsId });
      if (res.ok) {
        render();
      } else {
        wsSelect.disabled = false;
        wsSelect.removeAttribute('aria-busy');
        wsSelect.value = currentWorkspaceId;
        err(res.error || 'Could not switch workspace.');
      }
    };
  };

  if (!injectable) {
    setView(`
      <div class="bar"><span class="who">${who}</span><a id="signout">Sign out</a></div>
      ${workspaceSwitcherHtml}
      ${extrasHtml()}
      ${postSignupHtml}
      <div class="note spaced">Open a normal web page (http/https) to activate ${PRODUCT} here.</div>`);
    (document.getElementById('signout') as HTMLElement).onclick = signOut;
    bindWorkspaceSwitcher();
    bindExtras();
    return;
  }

  const tabState = await send<{ active: boolean; remembered: { project: string; environment: string } | null }>({ type: 'getTabState', tabId: tab!.id!, hostname });
  const env = tabState.remembered?.environment || 'staging';
  const origin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
  // Only true the first time — chrome.permissions.request persists a grant once given, so this
  // anticipatory copy shouldn't keep showing on every subsequent visit to an already-approved site.
  const needsPermissionPrompt = origin ? !(await chrome.permissions.contains({ origins: [`${origin}/*`] })) : false;
  // Projects come from the signed-in user's workspace (dashboard-managed) — no free-typing keys.
  // Quick-access (Client) accounts are barred from browsing the tenant's full project list, so they
  // get a single scoped lookup by this tab's own origin instead (see 'projectForOrigin').
  const isQuickAccess = !!user?.isQuickAccess;
  const listed = isQuickAccess
    ? await send<{ ok: boolean; project: ExtProject | null; error?: string }>({ type: 'projectForOrigin', origin })
    : await send<{ ok: boolean; projects: ExtProject[]; error?: string }>({ type: 'listProjects' });
  // The session expired or was revoked: the background ended it, so draw the sign-in instead of "Could not load projects."
  if ((listed as { signedOut?: boolean }).signedOut) { await render(); return; }
  const projects: ExtProject[] = isQuickAccess
    ? (('project' in listed && listed.ok && listed.project) ? [listed.project] : [])
    : ('projects' in listed && listed.ok ? listed.projects : []);
  // A super admin owns no workspace to add a project to (backend rejects it), and a client's one
  // project comes from their invite, not from creating one — never show the affordance for either.
  const isAdmin = !!user?.isAdmin && !user?.isSuperAdmin && !isQuickAccess;
  // The hint under the picker says why a project is (or is not) preselected.
  type Choice = ProjectChoice | { key: string; source: 'created' };
  const hints: Record<Choice['source'], { text: string; tone: 'ok' | 'muted' }> = {
    matched: { text: 'Matches this site’s URL.', tone: 'ok' },
    created: { text: 'Created for this site.', tone: 'ok' },
    remembered: { text: 'Last used on this site.', tone: 'muted' },
    ambiguous: { text: 'Several projects use this site’s URL. Pick one.', tone: 'muted' },
    none: {
      text: isAdmin
        ? 'No project in this workspace uses this site’s URL. Pick one, or add a project for it.'
        : 'No project in this workspace uses this site’s URL. Pick one from the list.',
      tone: 'muted',
    },
  };
  // Set after "+ Add project" succeeds, so the new project is selected on the redraw.
  let createdKey = '';

  // Which project the tab runs now, and what the main button will do with the selected one: the
  // popup used to say "Switch to selected project" even when that project was already active.
  const activeKey = tabState.active ? (tabState.remembered?.project || '') : '';
  const projectLabel = (key: string) => projects.find((p) => p.key === key)?.name || key;
  const toggleLabel = (selected: string) => !tabState.active ? 'Activate on this tab'
    : (selected && selected === activeKey ? 'Reload PinSay on this tab' : 'Switch to selected project');
  // Environments for "+ Add project", loaded the first time the form opens.
  let environments: ExtEnvironment[] | null = null;

  const draw = () => {
    const remembered = tabState.remembered?.project;
    const hasProjects = projects.length > 0;
    // What to preselect, and why: a project just created here; for a quick-access account the one
    // project the server matched to this origin; otherwise chooseProject (this site's remembered
    // choice, then the single best URL match). Never a silent "first project" default: a wrong
    // silent pick is exactly how a tab ends up bound to the wrong project.
    const choice: Choice = createdKey
      ? { key: createdKey, source: 'created' }
      : isQuickAccess
        ? (projects[0] ? { key: projects[0].key, source: 'matched' } : { key: '', source: 'none' })
        : chooseProject(projects, url, remembered);
    const selectedKey = choice.key;
    const hint = hints[choice.source];
    const showUnclaimed = choice.source === 'none' && unclaimedEligible(url);
    // Matched projects first in the suggestions (all tied candidates when ambiguous), then the rest.
    const firstKeys = choice.source === 'ambiguous' ? choice.candidates : (selectedKey ? [selectedKey] : []);
    const ordered = [...projects.filter((p) => firstKeys.includes(p.key)), ...projects.filter((p) => !firstKeys.includes(p.key))];
    const opts = projectOptionsHtml(ordered, selectedKey);

    setView(`
      <div class="bar"><span class="who">${who}</span><a id="signout">Sign out</a></div>
      ${workspaceSwitcherHtml}
      ${extrasHtml()}
      ${postSignupHtml}
      <div class="dom">${esc(hostname)}</div>
      ${showUnclaimed ? `<div class="note" id="u-note">${esc(t('unclaimedNoteMember'))}</div>
        <button class="secondary" id="u-leave">${esc(t('unclaimedLeave'))}</button>` : ''}
      ${hasProjects
        ? `<label for="project">Project</label>
           <select id="project" aria-describedby="project-hint">${opts}</select>
           <div class="hint" id="project-hint" data-tone="${hint.tone}">${esc(hint.text)}</div>`
        : (listed.error ? '' : `<div class="note" style="margin-top:8px;">${isAdmin ? 'No projects yet — add one below.' : 'No projects available. Ask your workspace admin to create one.'}</div>`)}
      ${isAdmin ? `
        <a id="add-toggle" href="#" role="button" style="display:inline-block;margin:8px 0;cursor:pointer;" aria-expanded="false" aria-controls="add-form">+ ${esc(t('addAsNewProject', { workspace: user?.tenantName || t('yourWorkspace') }))}</a>
        <div id="add-form" hidden>
          <label for="new-name">Project name</label>
          <input id="new-name" value="${esc(siteName(hostname))}" autocomplete="off" />
          <div id="new-env-field" hidden>
            <label for="new-env">Environment of this site</label>
            <select id="new-env"></select>
          </div>
          <div class="note">${esc(origin)} is saved as the project's URL, so the project is picked here next time.</div>
          <button class="primary" id="create">Create project</button>
        </div>` : ''}
      ${tabState.active && tabState.remembered ? `<div class="hint" data-tone="ok" id="active-state">Active on this tab: <b>${esc(projectLabel(tabState.remembered.project))}</b></div>` : ''}
      <button class="primary" id="toggle"${!hasProjects ? ' disabled' : ''}>${esc(toggleLabel(selectedKey))}</button>
      ${tabState.active ? `<button class="danger" id="deactivate" style="margin-top:6px;">Deactivate on this tab</button>` : ''}
      ${needsPermissionPrompt ? `<div class="note">Your browser will ask you to confirm access to this site — click "Allow" to continue.</div>` : ''}
      <div class="note">Activating reloads this tab once, then injects the ${PRODUCT} widget. Switch environment inside the widget (Comments panel).</div>`);

    (document.getElementById('signout') as HTMLElement).onclick = signOut;
    bindWorkspaceSwitcher();
    bindExtras();
    const uLeave = document.getElementById('u-leave') as HTMLButtonElement | null;
    if (uLeave && tab?.id !== undefined) uLeave.onclick = () => startUnclaimed(tab.id!, origin, uLeave);

    // The hint explains the automatic choice only; hide it once the user picks something else.
    const projectInput = document.getElementById('project') as HTMLSelectElement | null;
    const hintEl = document.getElementById('project-hint');
    const toggleBtn = document.getElementById('toggle') as HTMLButtonElement | null;
    if (projectInput) projectInput.addEventListener('change', () => {
      if (hintEl) hintEl.hidden = projectInput.value.trim() !== selectedKey;
      if (toggleBtn) toggleBtn.textContent = toggleLabel(projectInput.value.trim());
    });

    if (isAdmin) {
      const addForm = document.getElementById('add-form') as HTMLElement | null;
      const addToggle = document.getElementById('add-toggle') as HTMLElement | null;
      const envField = document.getElementById('new-env-field') as HTMLElement | null;
      const envSelect = document.getElementById('new-env') as HTMLSelectElement | null;
      const fillEnvironments = (list: ExtEnvironment[]) => {
        if (!envField || !envSelect) return;
        // No list (or an error): the field stays hidden and the API files the URL under "local".
        if (list.length === 0) { envField.hidden = true; return; }
        const preferred = pickEnvironment(list, hostname) || list[0];
        envSelect.innerHTML = list.map((e) => `<option value="${e.id}"${e.id === preferred.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
        envField.hidden = false;
      };
      if (addToggle && addForm) {
        addToggle.onclick = async (e: MouseEvent) => {
          e.preventDefault();
          addForm.hidden = !addForm.hidden;
          addToggle.setAttribute('aria-expanded', String(!addForm.hidden));
          if (addForm.hidden) return;
          (document.getElementById('new-name') as HTMLInputElement | null)?.focus();
          if (environments === null) {
            const r = await send<{ ok: boolean; environments: ExtEnvironment[] }>({ type: 'listEnvironments' });
            environments = r && r.ok ? r.environments : [];
          }
          fillEnvironments(environments);
        };
        // role="button": Space activates it too (Enter already does, through the href).
        addToggle.onkeydown = (e: KeyboardEvent) => { if (e.key === ' ') { e.preventDefault(); addToggle.click(); } };
      }
      const createBtn = document.getElementById('create') as HTMLButtonElement | null;
      if (createBtn) createBtn.onclick = async () => {
        err('');
        const name = (document.getElementById('new-name') as HTMLInputElement).value.trim();
        if (!name) return err('Enter a project name.');
        const envValue = envField && !envField.hidden && envSelect ? Number(envSelect.value) : NaN;
        const appEnvironmentId = Number.isInteger(envValue) && envValue > 0 ? envValue : null;
        createBtn.disabled = true;
        const res = await send<{ ok: boolean; project?: ExtProject; error?: string }>({
          type: 'createProject', name, appUrl: origin, appEnvironmentId, takenKeys: projects.map((p) => p.key),
        });
        if (!res.ok || !res.project) { createBtn.disabled = false; return err(res.error || 'Could not create project.'); }
        if (!projects.some((p) => p.key === res.project!.key)) projects.push(res.project);
        createdKey = res.project.key; // preselect the newly created project
        draw();
      };
    }

    // Activates (or, on an already-active tab, re-activates onto whatever's now selected — this is
    // the ONLY way to move a tab from one project to another; the deactivate button below always
    // just turns the widget off, never switches).
    (document.getElementById('toggle') as HTMLButtonElement).onclick = async () => {
      err('');
      const project = (document.getElementById('project') as HTMLSelectElement | null)?.value || '';
      const environment = env; // initial default; the viewer switches environment inside the widget
      if (!project) return err('Pick a project first.');
      if (!projects.some((p) => p.key === project)) return err('Pick a project from your list.');
      if (!origin) return err('Could not determine this site\'s origin.');
      // Must run right here, synchronously in this click handler — chrome.permissions.request only
      // honors a direct user gesture; proxying it through a message to the background loses that.
      // Persists once granted, so this only prompts the first time PinSay activates on this site.
      // Chrome closes this popup when its permission prompt opens, so on that first time nothing
      // after the await ever runs. Stage the activation first: the background completes it from
      // chrome.permissions.onAdded, and a reopened popup shows the staged project as selected.
      // Firefox only honours permissions.request while this click's user activation is alive, so ask FIRST,
      // synchronously in the handler; the stage message is sent (not awaited) just before, so the background
      // has it long before the person clicks Allow (permissions.onAdded fires only after that).
      const staged = send({ type: 'stageActivation', tabId: tab!.id!, hostname, origin, project, environment });
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      await staged;
      if (!granted) return err('PinSay needs access to this site to activate here — click Activate again to allow it.');
      const res = await send<{ ok: boolean; error?: string }>({ type: 'activate', tabId: tab!.id!, hostname, origin, project, environment });
      if (!res.ok) return err(res.error || 'Could not activate.'); // e.g. extension disabled on this plan
      if (postSignup) await send({ type: 'clearPostSignup' });
      window.close();
    };

    const deactivateBtn = document.getElementById('deactivate') as HTMLButtonElement | null;
    if (deactivateBtn) deactivateBtn.onclick = async () => {
      err('');
      await send({ type: 'deactivate', tabId: tab!.id! });
      window.close();
    };
  };

  if (!listed.ok && listed.error) err(listed.error);
  draw();
}

async function signOut() { await send({ type: 'logout' }); render(); }

/** Fills the static footer once; it sits outside #root, so no view replaces it. */
function renderFooter() {
  const foot = document.getElementById('foot');
  if (!foot) return;
  let version = '';
  try { version = chrome.runtime.getManifest().version; } catch { version = ''; }
  foot.innerHTML = footerHtml(version, t('whatsNew'));
  document.getElementById('whats-new')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: CHANGELOG_URL });
    window.close();
  });
}

renderFooter();
render();
