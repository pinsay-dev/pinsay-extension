import {
  SERVER, SESSION_KEYS, LOCAL_KEYS, LEGACY_SERVER_KEY, hostnameOf,
  type BgRequest, type ProxyRequest, type ProxyResponse, type StoredUser, type ExtProject, type WorkspaceChoice,
  type ExtEnvironment,
} from './shared';
import { generatedKeyBase, keyCandidates } from './slug';
import { inviteTokenFromUrl, widgetEnvironmentFor } from './invite';
import { injectMain } from './inject-main';
import { extensionEnv } from './env';
import { signupStatusFromResponse, magicStatusFromResponse, freshPendingChoice, freshAuthOutcome, type SignupStatus } from './signup';
import { LANG } from './i18n';
import { matchProxyRoute, routeAuthorization, redactCredentials, type ProxyRoute } from './proxy-policy';
import { uploadForm } from './upload-form';
import { tokenExpired } from './session';
import { earlyCaptureMatches, sameMatches } from './early-match';
import { armUnclaimed, unclaimedLoad } from './unclaimed';

// ---- token / prefs -------------------------------------------------------
// An expired token ends the session here (see session.ts): nothing may keep sending it.
async function getToken(): Promise<string | null> {
  const s = await chrome.storage.session.get(SESSION_KEYS.token);
  const token = (s[SESSION_KEYS.token] as string) || null;
  if (token && tokenExpired(token, Date.now())) { await clearSession(); return null; }
  return token;
}
// Signed out: the token and the stored user (whose workspaces the popup would otherwise still list) go together.
async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEYS.token);
  await chrome.storage.local.remove(LOCAL_KEYS.user);
}
// The server no longer accepts this token (expired by its clock, or revoked by a security stamp). A 401 on a proxied
// call alone is not proof — a widget sign-in with a wrong code is a 401 too — so ask /api/auth/me with the token.
async function sessionRejected(token: string): Promise<boolean> {
  try {
    const r = await fetch(`${await getServer()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    return r.status === 401;
  } catch { return false; }
}
async function getServer(): Promise<string> {
  return SERVER;
}
// Versions before 0.4.0 let the user point the extension at another server and stored it here.
// There is one server now: drop the stale value so nothing can read it again.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(LEGACY_SERVER_KEY).catch(() => {});
  syncEarlyCapture().catch(() => {});
});
async function getProjectMap(): Promise<Record<string, { project: string; environment: string }>> {
  const s = await chrome.storage.local.get(LOCAL_KEYS.projectByDomain);
  return (s[LOCAL_KEYS.projectByDomain] as Record<string, { project: string; environment: string }>) || {};
}
async function getVisitorMap(): Promise<Record<string, { project: string }>> {
  const s = await chrome.storage.local.get(LOCAL_KEYS.visitorByDomain);
  return (s[LOCAL_KEYS.visitorByDomain] as Record<string, { project: string }>) || {};
}

// ---- early capture (document_start, MAIN world) ----------------------------
// Registers early-capture.js for every site set up in the extension (team or visitor), where the host permission
// is granted, so a bug report can include errors from page load on (see early-capture-core.ts). One registration,
// re-synced whenever the site maps or permissions change; activate() awaits it before reloading the tab.
const EARLY_SCRIPT_ID = 'pinsay-early-capture';
// Callers overlap (activate() awaits a sync while storage.onChanged starts another): run them one after another,
// so an unregister/register pair never interleaves with another one (duplicate or missing script id).
let earlySync: Promise<void> = Promise.resolve();
function syncEarlyCapture(): Promise<void> {
  earlySync = earlySync.then(syncEarlyCaptureNow, syncEarlyCaptureNow);
  return earlySync;
}
async function syncEarlyCaptureNow(): Promise<void> {
  try {
    const hosts = [...Object.keys(await getProjectMap()), ...Object.keys(await getVisitorMap())];
    const matches: string[] = [];
    for (const m of earlyCaptureMatches(hosts)) {
      try { if (await chrome.permissions.contains({ origins: [m] })) matches.push(m); } catch { /* skip */ }
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [EARLY_SCRIPT_ID] });
    if (existing.length === 1 && matches.length && sameMatches(existing[0].matches, matches)) return;
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [EARLY_SCRIPT_ID] });
    if (!matches.length) return;
    await chrome.scripting.registerContentScripts([{
      id: EARLY_SCRIPT_ID,
      js: ['early-capture.js'],
      matches,
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: false,
      persistAcrossSessions: true,
    }]);
  } catch (e) {
    console.warn('[pinsay-ext] early capture not registered', e);
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (LOCAL_KEYS.projectByDomain in changes || LOCAL_KEYS.visitorByDomain in changes)) {
    syncEarlyCapture().catch(() => {});
  }
});
chrome.permissions.onRemoved.addListener(() => { syncEarlyCapture().catch(() => {}); });
async function setVisitorMap(map: Record<string, { project: string }>): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_KEYS.visitorByDomain]: map });
}
// One-shot entry ('leave' | 'track') the popup chose for a visitor-mode tab, read by the next injection.
const SESSION_VISITOR_ENTRY = 'visitorEntry';
async function setVisitorEntry(tabId: number, entry: 'leave' | 'track'): Promise<void> {
  const s = ((await chrome.storage.session.get(SESSION_VISITOR_ENTRY))[SESSION_VISITOR_ENTRY] as Record<number, 'leave' | 'track'>) || {};
  s[tabId] = entry;
  await chrome.storage.session.set({ [SESSION_VISITOR_ENTRY]: s });
}
async function takeVisitorEntry(tabId: number): Promise<'leave' | 'track' | null> {
  const s = ((await chrome.storage.session.get(SESSION_VISITOR_ENTRY))[SESSION_VISITOR_ENTRY] as Record<number, 'leave' | 'track'>) || {};
  const entry = s[tabId] || null;
  if (entry) {
    delete s[tabId];
    await chrome.storage.session.set({ [SESSION_VISITOR_ENTRY]: s });
  }
  return entry;
}
// Universal capture (unclaimed mode) the popup chose for a tab: an arm (see unclaimed.ts) that re-injects on the
// tab's later loads on the same origin, so the page's own reloads don't take the tool away.
const SESSION_UNCLAIMED = 'unclaimedTabs';
async function getUnclaimedArm(tabId: number): Promise<unknown> {
  const s = ((await chrome.storage.session.get(SESSION_UNCLAIMED))[SESSION_UNCLAIMED] as Record<number, unknown>) || {};
  return s[tabId];
}
async function setUnclaimedArm(tabId: number, arm: unknown): Promise<void> {
  const s = ((await chrome.storage.session.get(SESSION_UNCLAIMED))[SESSION_UNCLAIMED] as Record<number, unknown>) || {};
  if (arm) s[tabId] = arm; else delete s[tabId];
  await chrome.storage.session.set({ [SESSION_UNCLAIMED]: s });
}
// A team sign-in ends every visitor-mode activation.
async function endVisitorMode(): Promise<void> {
  await chrome.storage.local.remove(LOCAL_KEYS.visitorByDomain);
  await chrome.storage.session.remove(SESSION_VISITOR_ENTRY);
}

/**
 * A project's URLs for tab matching: active environment URLs (`appUrls`, skipping disabled ones,
 * same filter as the server's project-for-origin lookup) plus the legacy `appUrl`, de-duplicated.
 */
function projectUrls(p: any): string[] {
  const out: string[] = [];
  for (const u of Array.isArray(p?.appUrls) ? p.appUrls : []) {
    if (u && typeof u.url === 'string' && u.url && u.isActive !== false && u.environmentIsEnabled !== false) out.push(u.url);
  }
  if (typeof p?.appUrl === 'string' && p.appUrl) out.push(p.appUrl);
  return [...new Set(out)];
}

// Authenticated call to the PinSay server from the background (the ONLY place that holds the JWT).
// Used for popup control actions (list/create projects, extension-activate entitlement gate).
// A 401 for the token it sent ends the session (`signedOut`): these calls all need a session, so 401 means a dead one.
async function apiFetch(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; message: string | null; signedOut?: boolean }> {
  const server = await getServer();
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let status = 0; let body: any = null;
  try {
    const r = await fetch(server + path, { ...init, headers });
    status = r.status;
    body = await r.json().catch(() => null);
  } catch { /* network error → status stays 0 */ }
  if (token && status === 401) {
    await clearSession();
    return { ok: false, status, data: null, message: null, signedOut: true };
  }
  // Envelope-aware: Result<T> wraps payload in `data` and carries `message` on failure.
  return { ok: status >= 200 && status < 300, status, data: body?.data ?? body, message: body?.message ?? null };
}

// ---- CSP bypass (per-tab session DNR rule) -------------------------------
// Removing the CSP header lets the page load the remote widget.js/widget.css.
// Scoped to the activated tab and removed on deactivate / tab close.
const CSP_RULE_BASE = 100000;
const ruleId = (tabId: number) => CSP_RULE_BASE + tabId;

async function addCspBypass(tabId: number): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId(tabId)],
    addRules: [{
      id: ruleId(tabId),
      priority: 1,
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        responseHeaders: [
          { header: 'content-security-policy', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
          { header: 'content-security-policy-report-only', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
        ],
      },
      condition: {
        tabIds: [tabId],
        // Restrict to MAIN_FRAME only — sub-frames (including cross-origin iframes)
        // do not need their CSP removed, and stripping them is unnecessary over-reach (3.2).
        resourceTypes: [
          'main_frame' as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    }],
  });
}
async function removeCspBypass(tabId: number): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] });
}
async function isActive(tabId: number): Promise<boolean> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((r) => r.id === ruleId(tabId));
}
// Reload every currently-activated tab. Called after a fresh sign-in so an already-injected
// widget (which may be sitting on its own login prompt after a 401) re-injects with the new
// token — the widget picks up auth without the user manually refreshing.
async function reloadActiveTabs(): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const tabIds = rules.filter((r) => r.id >= CSP_RULE_BASE).map((r) => r.id - CSP_RULE_BASE);
  for (const id of tabIds) {
    try { await chrome.tabs.reload(id); } catch { /* tab may be gone */ }
  }
}
// The inverse of reloadActiveTabs — called on sign-out so every activated tab actually leaves the
// page instead of sitting there re-injected-but-unauthenticated (401 → the widget's own login modal,
// with no way to dismiss it since the popup's "Deactivate on this tab" button only exists once
// signed back in).
async function deactivateAllTabs(): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const tabIds = rules.filter((r) => r.id >= CSP_RULE_BASE).map((r) => r.id - CSP_RULE_BASE);
  for (const id of tabIds) {
    try { await deactivate(id); } catch { /* tab may be gone */ }
  }
}

// ---- activation ----------------------------------------------------------
// Tabs waiting for their post-reload 'complete' so we inject exactly once.
// Persisted in chrome.storage.session (not in-memory) so a terminated and
// re-awakened MV3 service worker can still complete the injection (fix 3.1).
const SESSION_PENDING = 'pendingInject';

// First activation on a site: the popup must call chrome.permissions.request (user gesture), and
// Chrome closes the popup the moment its prompt opens — the click handler never resumes, so the
// 'activate' message was never sent and "nothing happened". The popup therefore STAGES the
// activation before asking, and the background finishes it from chrome.permissions.onAdded.
const SESSION_STAGED = 'stagedActivation';
type StagedActivation = { tabId: number; hostname: string; origin: string; project: string; environment: string; at: number };
async function getStaged(): Promise<StagedActivation | null> {
  const r = await chrome.storage.session.get(SESSION_STAGED);
  return (r[SESSION_STAGED] as StagedActivation) || null;
}
async function setStaged(s: StagedActivation | null): Promise<void> {
  if (s) await chrome.storage.session.set({ [SESSION_STAGED]: s });
  else await chrome.storage.session.remove(SESSION_STAGED);
}
// Popup-alive + onAdded can both try to activate the same tab within a second; the second run
// would reload the tab a second time. recentlyActivated remembers the last completed activation
// per tab (runs that finished in the last 5 s); inFlightActivation covers runs still in flight.
const recentlyActivated = new Map<number, { project: string; at: number }>();
// Same tab + project already activating: share that run instead of POSTing a second activation.
const inFlightActivation = new Map<number, { project: string; run: Promise<{ ok: boolean; error?: string }> }>();

async function runActivation(m: { tabId: number; hostname: string; origin: string; project: string; environment: string }): Promise<{ ok: boolean; error?: string }> {
  const pending = inFlightActivation.get(m.tabId);
  if (pending && pending.project === m.project) return pending.run;
  const run: Promise<{ ok: boolean; error?: string }> = runActivationOnce(m).finally(() => {
    if (inFlightActivation.get(m.tabId)?.run === run) inFlightActivation.delete(m.tabId);
  });
  inFlightActivation.set(m.tabId, { project: m.project, run });
  return run;
}

async function runActivationOnce(m: { tabId: number; hostname: string; origin: string; project: string; environment: string }): Promise<{ ok: boolean; error?: string }> {
  const recent = recentlyActivated.get(m.tabId);
  if (recent && recent.project === m.project && Date.now() - recent.at < 5000) return { ok: true };
  const su = (await chrome.storage.local.get(LOCAL_KEYS.user))[LOCAL_KEYS.user] as StoredUser | null;
  if (su?.isSuperAdmin) return { ok: false, error: 'Super admin accounts can’t use PinSay here — sign in with a workspace account instead.' };
  if (!(await hasHostPermission(m.origin))) {
    return { ok: false, error: 'Permission for this site was not granted — click Activate again and allow access when your browser asks.' };
  }
  const gate = await apiFetch('/api/extension/activate', {
    method: 'POST',
    body: JSON.stringify({ projectKey: m.project, origin: m.origin, ...(await extensionEnv()) }),
  });
  if (!gate.ok) {
    const reason = gate.status === 404 ? 'Project not found in your workspace.'
      : (gate.message || 'The browser extension is not available on your current plan.');
    return { ok: false, error: reason };
  }
  await setStaged(null);
  recentlyActivated.set(m.tabId, { project: m.project, at: Date.now() });
  await activate(m.tabId, m.hostname, m.project, m.environment);
  return { ok: true };
}

chrome.permissions.onAdded.addListener((added) => {
  syncEarlyCapture().catch(() => {});
  (async () => {
    const staged = await getStaged();
    if (!staged) return;
    if (Date.now() - staged.at > 5 * 60 * 1000) { await setStaged(null); return; }
    const origins = added.origins || [];
    if (!origins.some((o) => o.startsWith(`${staged.origin}/`) || o === `${staged.origin}/*` || o === '<all_urls>')) return;
    await runActivation(staged);
  })().catch(() => { /* best effort — the popup path still works on the next click */ });
});

async function getPendingInject(): Promise<Set<number>> {
  const s = await chrome.storage.session.get(SESSION_PENDING);
  return new Set<number>((s[SESSION_PENDING] as number[]) || []);
}
async function addPendingInject(tabId: number): Promise<void> {
  const set = await getPendingInject();
  set.add(tabId);
  await chrome.storage.session.set({ [SESSION_PENDING]: Array.from(set) });
}
async function removePendingInject(tabId: number): Promise<void> {
  const set = await getPendingInject();
  set.delete(tabId);
  await chrome.storage.session.set({ [SESSION_PENDING]: Array.from(set) });
}

async function activate(tabId: number, hostname: string, project: string, environment: string): Promise<void> {
  await setUnclaimedArm(tabId, null);
  const map = await getProjectMap();
  map[hostname] = { project, environment };
  await chrome.storage.local.set({ [LOCAL_KEYS.projectByDomain]: map });
  await addCspBypass(tabId);
  await addPendingInject(tabId);
  await syncEarlyCapture();
  await chrome.tabs.reload(tabId);
}

// Defense in depth: the popup is responsible for requesting this origin's host permission (a
// user-gesture requirement chrome.permissions.request can't satisfy from here), but every path
// into activate() ultimately comes from that same message, so double-check it actually landed
// before wiring up a CSP-bypass rule that would otherwise silently do nothing for this origin.
async function hasHostPermission(origin: string): Promise<boolean> {
  try { return await chrome.permissions.contains({ origins: [`${origin}/*`] }); }
  catch { return false; }
}

async function deactivate(tabId: number): Promise<void> {
  await setUnclaimedArm(tabId, null);
  await removeCspBypass(tabId);
  await removePendingInject(tabId);
  try { await chrome.tabs.reload(tabId); } catch { /* tab may be gone */ }
}

async function injectInto(tabId: number, url: string, unclaimed = false): Promise<void> {
  const server = await getServer();
  // Universal capture: the popup's one-shot choice wins for this load (no project, no token, no user).
  if (unclaimed) {
    // The CSP strip is one-shot: only the first load after "Leave feedback" loses its CSP; later loads keep theirs (security S-4).
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-bridge.js'] });
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: injectMain,
        args: [{ server, project: '', environment: '', unclaimed: true, snapdomUrl: chrome.runtime.getURL('vendor/snapdom.js') }],
      });
    } finally {
      await removeCspBypass(tabId);
    }
    return;
  }
  const localUser = await chrome.storage.local.get(LOCAL_KEYS.user);
  const user = (localUser[LOCAL_KEYS.user] as StoredUser) || null;
  const map = await getProjectMap();
  const entry = map[hostnameOf(url)];
  if (!entry) {
    const visitor = !(await getToken()) ? (await getVisitorMap())[hostnameOf(url)] : undefined;
    if (!visitor) return;
    const visitorSnapdomUrl = chrome.runtime.getURL('vendor/snapdom.js');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-bridge.js'] });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: injectMain,
      args: [{ server, project: visitor.project, environment: '', visitor: true, visitorEntry: (await takeVisitorEntry(tabId)) ?? undefined, snapdomUrl: visitorSnapdomUrl }],
    });
    return;
  }
  // Only the display name plus three non-PII facts reach the page — email and role name stay out
  // (fix 1.3). The opaque id lets the widget mark the viewer's own comments (so the author sees the
  // verify buttons), isAdmin extends that to admins, isQuickAccess hides backlog actions.
  const displayName: string | undefined = user?.displayName || undefined;
  const userId: string | undefined = user?.id ? String(user.id) : undefined;
  const isAdmin = !!user?.isAdmin;
  const isQuickAccess = !!user?.isQuickAccess;
  // snapdom (screenshot capture) stays bundled — it changes rarely, unlike widget.js/css below.
  const snapdomUrl = chrome.runtime.getURL('vendor/snapdom.js');
  // 1) Isolated bridge (relays proxied requests). 2) MAIN-world config + host mount — injectMain
  // itself appends <script src>/<link> tags pointing at the server's live widget.js/widget.css,
  // exactly like the plain (non-extension) widget embed does. That's page-context code, not
  // extension-privileged code, so it isn't "remotely hosted code" under MV3's policy — and it means
  // a CSS tweak or a small widget fix ships by deploying the server, no extension update needed.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-bridge.js'] });
  // No environment is injected (like a plain embed without the attribute): the widget asks /capture-config, which
  // resolves the page origin against the project's environment URLs (localhost → Local). The stored per-site value was
  // only ever the popup's 'staging' default and tagged every comment Staging (tonight fixes item 4, 2026-10-25).
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: injectMain,
    args: [{ server, project: entry.project, environment: '', displayName, userId, isAdmin, isQuickAccess, snapdomUrl }],
  });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  const url = tab.url;
  (async () => {
    if (inviteTokenFromUrl(url)) { await handleInviteLink(tabId, url); return; }
    // Re-inject on EVERY load of an active tab, not just the first. A hard reload resets the
    // page's MAIN world and drops the widget; `pendingInject` only covers the initial
    // activate-reload, so without the `isActive` check a reload leaves an activated tab bare.
    // A tab armed for universal capture (unclaimed.ts) re-injects on its same-origin loads instead.
    // (SPA soft-navigations that don't fire 'complete' are handled by the MutationObserver the
    // injected code installs — it re-appends the widget host if the app evicts it.)
    const pending = await getPendingInject();
    const wasPending = pending.has(tabId);
    if (wasPending) await removePendingInject(tabId);
    const arm = await getUnclaimedArm(tabId);
    if (arm) {
      const load = unclaimedLoad(arm, url, Date.now());
      await setUnclaimedArm(tabId, load.arm);
      if (load.inject) await injectInto(tabId, url, true);
      else await removeCspBypass(tabId);
      return;
    }
    if (wasPending || await isActive(tabId)) await injectInto(tabId, url);
  })().catch((e) => console.error('[pinsay-ext] inject failed', e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeCspBypass(tabId).catch(() => {});
  removePendingInject(tabId).catch(() => {});
  setUnclaimedArm(tabId, null).catch(() => {});
});

// ---- login & workspace switch --------------------------------------------
async function login(email: string, password: string) {
  const base = SERVER;
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);
  const env = r ? await r.json().catch(() => null) : null;
  const data = env && env.data;
  if (data && data.status === 'ok' && data.token) {
    await chrome.storage.session.set({ [SESSION_KEYS.token]: data.token });
    await chrome.storage.local.set({ [LOCAL_KEYS.user]: data.user || null });
    await endVisitorMode();
    return { ok: true, user: data.user || null };
  }
  if (data && data.status === 'choose-workspace' && data.token) {
    const workspaces = toWorkspaceChoices(data.workspaces);
    return {
      ok: false,
      status: 'choose-workspace',
      workspaces,
      selectionToken: data.token as string,
      message: (env && env.message) || 'Please select a workspace.',
    };
  }
  return { ok: false, status: (data && data.status) || 'error', message: (env && env.message) || 'Login failed' };
}

async function loginWithInvite(token: string) {
  const r = await fetch(`${SERVER}/api/auth/login-with-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => null);
  const env = r ? await r.json().catch(() => null) : null;
  const data = env && env.data;
  if (data && data.status === 'ok' && data.token) {
    await adoptSession({ token: data.token, user: data.user || null });
    return { ok: true, user: data.user || null };
  }
  return { ok: false };
}

async function handleInviteLink(tabId: number, url: string): Promise<boolean> {
  try {
    const token = inviteTokenFromUrl(url);
    if (!token) return false;
    const origin = new URL(url).origin;
    const hostname = hostnameOf(url);
    if (!/^https?:/.test(url)) return false;
    if (!(await hasHostPermission(origin))) return false;
    const [embedded] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!document.querySelector('pinsay-feedback'),
    });
    if (embedded?.result) return true;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const u = new URL(location.href);
        if (!u.searchParams.has('pinsay_invite')) return;
        u.searchParams.delete('pinsay_invite');
        history.replaceState({}, '', u.toString());
      },
    });
    const login = await loginWithInvite(token);
    if (!login.ok) return false;
    const r = await apiFetch('/api/extension/project-for-origin?origin=' + encodeURIComponent(origin));
    if (!r.ok) return false;
    const map = await getProjectMap();
    const environment = widgetEnvironmentFor(r.data.environmentName);
    map[hostname] = { project: r.data.key, environment };
    await chrome.storage.local.set({ [LOCAL_KEYS.projectByDomain]: map });
    const res = await runActivation({ tabId, hostname, origin, project: r.data.key, environment });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- extension signup ----------------------------------------------------
type PendingSignup = { pendingToken: string; email: string; sentAt: number; flow: 'sign-in' | 'sign-up' };
async function getPendingSignup(): Promise<PendingSignup | null> {
  const v = (await chrome.storage.local.get(LOCAL_KEYS.pendingSignup))[LOCAL_KEYS.pendingSignup] as PendingSignup | undefined;
  if (!v) return null;
  if (typeof v.pendingToken !== 'string') { await chrome.storage.local.remove(LOCAL_KEYS.pendingSignup); return null; } // an old 0.7.x value
  return v;
}
async function setPendingSignup(p: PendingSignup): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_KEYS.pendingSignup]: p });
}
async function clearPendingSignup(): Promise<void> {
  await chrome.storage.local.remove(LOCAL_KEYS.pendingSignup);
}
// Same as login() on status 'ok': the token stays in the background, the user is kept for the popup.
async function adoptSession(login: any): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEYS.token]: login.token });
  await chrome.storage.session.remove([SESSION_KEYS.pendingChoice, SESSION_KEYS.authOutcome]);
  await chrome.storage.local.set({ [LOCAL_KEYS.user]: login.user || null });
  await endVisitorMode();
}
function toWorkspaceChoices(list: any): WorkspaceChoice[] {
  return (list || []).map((w: any) => ({
    workspaceId: String(w.workspaceId || w.id || ''),
    name: String(w.name || 'Unnamed workspace'),
    roleName: w.roleName ? String(w.roleName) : '',
    isAdmin: !!w.isAdmin,
    isHome: !!w.isHome,
  }));
}
// The `done` answer of a magic-link verify / status call: adopt the session or say what is left to do. Outcomes other
// than `ok` are also kept in storage.session: the popup may be gone by now (Chrome closes it when a dialog takes
// focus), and reopening it must show the workspace picker or the message instead of an empty sign-in form.
async function finishMagic(data: any, email: string): Promise<{ status: SignupStatus; workspaces?: WorkspaceChoice[]; selectionToken?: string; welcome: boolean }> {
  const status = magicStatusFromResponse(200, data);
  let workspaces: WorkspaceChoice[] | undefined;
  let selectionToken: string | undefined;
  if (status === 'ok') {
    await adoptSession(data.login);
    await clearPendingSignup();
    if (data.welcome) await chrome.storage.local.set({ [LOCAL_KEYS.postSignup]: { at: Date.now() } });
  } else if (status === 'choose-workspace') {
    await clearPendingSignup();
    workspaces = toWorkspaceChoices(data.login.workspaces);
    selectionToken = data.login.token;
    await chrome.storage.session.set({ [SESSION_KEYS.pendingChoice]: { workspaces, selectionToken, email, at: Date.now() } });
  } else if (['pending_approval', 'mfa_required', 'no_workspace', 'rejected', 'disabled'].includes(status)) {
    await clearPendingSignup();
    await chrome.storage.session.set({ [SESSION_KEYS.authOutcome]: { status, email, at: Date.now() } });
  }
  return { status, workspaces, selectionToken, welcome: !!data.welcome };
}

async function switchWorkspace(workspaceId: string, selectionToken?: string) {
  const server = await getServer();
  const token = selectionToken || (await getToken());
  if (!token) return { ok: false, error: 'No active session or selection token.' };

  const r = await fetch(`${server}/api/auth/switch-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ workspaceId }),
  }).catch(() => null);

  const env = r ? await r.json().catch(() => null) : null;
  const data = env && env.data;
  if (data && data.status === 'ok' && data.token) {
    await chrome.storage.session.set({ [SESSION_KEYS.token]: data.token });
    await chrome.storage.session.remove(SESSION_KEYS.pendingChoice);
    await chrome.storage.local.set({ [LOCAL_KEYS.user]: data.user || null });
    await endVisitorMode();
    return { ok: true, user: data.user || null };
  }
  return { ok: false, error: (env && env.message) || 'Failed to switch workspace.' };
}

// ---- proxied API traffic (from the page via the content bridge) ----------

/**
 * Validate a page request against the route allowlist (SEC-BUG-01, see proxy-policy.ts):
 * - origin must match the PinSay server;
 * - kind + method + path must be a route the widget really calls (JSON body checked where the route says so).
 * Returns the matched route, or null when it must be refused.
 */
async function validateProxyUrl(url: string, kind: 'fetch' | 'upload', method: string, body: string | null = null): Promise<ProxyRoute | null> {
  const server = await getServer(); // already strips trailing slash
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.origin !== new URL(server).origin) return null;
  if (parsed.username || parsed.password) return null;
  return matchProxyRoute(kind, method, parsed.pathname, body);
}

/** The response handed back to the page: credentials stripped on the widget's own (`extension`) routes. */
async function proxyResponse(route: ProxyRoute, r: Response): Promise<ProxyResponse> {
  const text = await r.text();
  return {
    ok: r.ok, status: r.status,
    body: route.mode === 'extension' ? redactCredentials(text, route, r.ok) : text,
    contentType: r.headers.get('content-type'),
  };
}

async function handleProxy(msg: Exclude<ProxyRequest, { kind: 'capture' }>): Promise<ProxyResponse> {
  const blocked: ProxyResponse = { ok: false, status: 0, body: 'blocked', contentType: null };

  if (msg.kind === 'upload') {
    const route = await validateProxyUrl(msg.url, 'upload', 'POST');
    if (!route) return blocked;

    const token = route.mode === 'extension' ? await getToken() : null;
    const auth = routeAuthorization(route, token, msg.auth);
    if (auth === undefined) return blocked;
    const fd = uploadForm(msg);
    let r = await fetch(msg.url, { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: fd });
    if (token && r.status === 401 && await sessionRejected(token)) {
      // The extension's session is dead: end it and send the widget's own sign-in instead (see session.ts).
      await clearSession();
      const own = routeAuthorization(route, null, msg.auth);
      r = await fetch(msg.url, { method: 'POST', headers: own ? { Authorization: own } : {}, body: fd });
    }
    return proxyResponse(route, r);
  }

  // kind === 'fetch'. The page-supplied `auth` flag is ignored (#2 fix): the route decides which credentials ride.
  const route = await validateProxyUrl(msg.url, 'fetch', msg.method, msg.body ?? null);
  if (!route) return blocked;

  // Only the widget's own routes ever see the extension's token (SEC-BUG-01).
  const token = route.mode === 'extension' ? await getToken() : null;
  // Strip any Authorization header the page may have supplied; the background is
  // the sole authority on whether and which token rides the request.
  const headers: Record<string, string> = { ...(msg.headers || {}) };
  const pageAuth = headers.Authorization ?? headers.authorization;
  delete headers.authorization;
  delete headers.Authorization;
  const auth = routeAuthorization(route, token, pageAuth);
  if (auth === undefined) return blocked;
  if (auth) headers.Authorization = auth;

  let r = await fetch(msg.url, { method: msg.method, headers, body: msg.body ?? undefined });
  if (token && r.status === 401 && await sessionRejected(token)) {
    // The extension's session is dead (expired or revoked): end it and retry once with the widget's own header, so a
    // sign-in made in the widget works instead of being replaced by the dead token on every call (see session.ts).
    await clearSession();
    delete headers.Authorization;
    const own = routeAuthorization(route, null, pageAuth);
    if (own) headers.Authorization = own;
    r = await fetch(msg.url, { method: msg.method, headers, body: msg.body ?? undefined });
  }
  return proxyResponse(route, r);
}

// Real-pixel screenshot for the widget (SPEC 33). Only for the top frame of the tab that asked, only while that tab is
// the active tab of its window (captureVisibleTab captures whatever tab is visible), and only on a site the extension
// is enabled for. Needs activeTab or <all_urls> at runtime; without it Chrome throws and the widget falls back to
// snapdom (see company/work/2026-10-13-bug-capture/PLAN.md, Q-L2).
async function handleCapture(sender: chrome.runtime.MessageSender): Promise<ProxyResponse> {
  const fail: ProxyResponse = { ok: false, status: 0, body: '', contentType: null };
  const tab = sender.tab;
  if (!tab || tab.id === undefined || !tab.url || sender.frameId !== 0) return fail;
  const map = await getProjectMap();
  const captureHost = hostnameOf(tab.url);
  if (!map[captureHost] && !(await getVisitorMap())[captureHost]) return fail;
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!active || active.id !== tab.id) return fail;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, status: 200, body: dataUrl, contentType: 'text/plain' };
  } catch {
    return fail;
  }
}

// ---- message router ------------------------------------------------------
chrome.runtime.onMessage.addListener((msg: BgRequest | ProxyRequest, sender, sendResponse) => {
  if ((msg as ProxyRequest).source === 'pinsay-ext' && (msg as ProxyRequest).kind === 'capture') {
    handleCapture(sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, status: 0, body: '', contentType: null }));
    return true;
  }
  // Page proxy traffic
  if ((msg as ProxyRequest).source === 'pinsay-ext') {
    handleProxy(msg as Exclude<ProxyRequest, { kind: 'capture' }>)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, status: 0, body: '', contentType: null }));
    return true;
  }
  // Popup control messages
  const m = msg as BgRequest;
  (async () => {
    switch (m.type) {
      case 'getState': {
        let user = (await chrome.storage.local.get(LOCAL_KEYS.user))[LOCAL_KEYS.user] || null;
        const hasToken = !!(await getToken());
        if (hasToken && user && !user.workspaces) {
          const r = await apiFetch('/api/auth/me', { method: 'GET' });
          if (r.ok && r.data) {
            user = r.data;
            await chrome.storage.local.set({ [LOCAL_KEYS.user]: user });
          }
        }
        const pending = await getPendingSignup();
        const postSignup = !!(await chrome.storage.local.get(LOCAL_KEYS.postSignup))[LOCAL_KEYS.postSignup];
        const kept = await chrome.storage.session.get([SESSION_KEYS.pendingChoice, SESSION_KEYS.authOutcome]);
        const now = Date.now();
        const pendingChoice = hasToken ? null : freshPendingChoice(kept[SESSION_KEYS.pendingChoice], now);
        const authOutcome = hasToken ? null : freshAuthOutcome(kept[SESSION_KEYS.authOutcome], now);
        if (kept[SESSION_KEYS.authOutcome]) await chrome.storage.session.remove(SESSION_KEYS.authOutcome); // one-shot
        if (kept[SESSION_KEYS.pendingChoice] && !pendingChoice) await chrome.storage.session.remove(SESSION_KEYS.pendingChoice); // expired or junk
        return {
          user, hasToken,
          pendingSignup: pending ? { email: pending.email, sentAt: pending.sentAt, flow: pending.flow } : null,
          postSignup,
          pendingChoice: pendingChoice ? { workspaces: pendingChoice.workspaces, selectionToken: pendingChoice.selectionToken, email: pendingChoice.email } : null,
          authOutcome,
        };
      }
      case 'clearPostSignup': { await chrome.storage.local.remove(LOCAL_KEYS.postSignup); return { ok: true }; }
      case 'signupEnabled': {
        const r = await apiFetch('/api/auth/signup-enabled', { method: 'GET' });
        return { ok: true, enabled: r.ok && r.data && typeof r.data.enabled === 'boolean' ? r.data.enabled : true };
      }
      case 'extMagicSignIn':
      case 'extSignup': {
        const signUp = m.type === 'extSignup';
        const r = await apiFetch(signUp ? '/api/auth/magic/sign-up' : '/api/auth/magic/sign-in', {
          method: 'POST',
          body: JSON.stringify(signUp
            ? { email: m.email, displayName: m.displayName, client: 'extension', language: LANG }
            : { email: m.email, client: 'extension', language: LANG }),
        });
        const status = magicStatusFromResponse(r.status, r.data);
        if (status === 'code_sent' && r.data?.pendingToken) {
          await setPendingSignup({ pendingToken: r.data.pendingToken, email: r.data.email || m.email, sentAt: Date.now(), flow: signUp ? 'sign-up' : 'sign-in' });
        }
        return { ok: status === 'code_sent', status, message: r.message, email: r.data?.email || m.email, resendAfterSeconds: r.data?.resendAfterSeconds ?? r.data?.retryAfterSeconds ?? null };
      }
      case 'extVerifyCode': {
        const pending = await getPendingSignup();
        if (!pending) return { status: 'invalid_token', attemptsLeft: null, message: null };
        const r = await apiFetch('/api/auth/magic/verify', {
          method: 'POST',
          body: JSON.stringify({ pendingToken: pending.pendingToken, code: m.code }),
        });
        const status = magicStatusFromResponse(r.status, r.data);
        if (r.data?.status === 'done') return { ...(await finishMagic(r.data, pending.email)), attemptsLeft: null, message: r.message };
        if (status === 'invalid_token') await clearPendingSignup();
        return { status, attemptsLeft: r.data?.attemptsLeft ?? null, message: r.message };
      }
      case 'extResendCode': {
        const pending = await getPendingSignup();
        if (!pending) return { status: 'invalid_token', resendAfterSeconds: null };
        const r = await apiFetch('/api/auth/magic/resend', { method: 'POST', body: JSON.stringify({ pendingToken: pending.pendingToken }) });
        const status = magicStatusFromResponse(r.status, r.data);
        if (status === 'code_sent' && r.data?.pendingToken) await setPendingSignup({ ...pending, pendingToken: r.data.pendingToken, sentAt: Date.now() });
        else if (status === 'invalid_token') await clearPendingSignup();
        return { status, resendAfterSeconds: r.data?.resendAfterSeconds ?? r.data?.retryAfterSeconds ?? null };
      }
      case 'extPollSession': {
        const pending = await getPendingSignup();
        if (!pending) return { status: 'invalid_token' };
        const r = await apiFetch('/api/auth/magic/status', { method: 'POST', body: JSON.stringify({ pendingToken: pending.pendingToken }) });
        const status = magicStatusFromResponse(r.status, r.data);
        if (r.data?.status === 'done') return await finishMagic(r.data, pending.email);
        if (status === 'invalid_token') await clearPendingSignup();
        return { status };
      }
      case 'extForgetSignup': { await clearPendingSignup(); return { ok: true }; }
      case 'clearAuthOutcome': { await chrome.storage.session.remove([SESSION_KEYS.pendingChoice, SESSION_KEYS.authOutcome]); return { ok: true }; }
      case 'extFirstWorkspace': {
        const r = await apiFetch('/api/auth/extension/first-workspace', { method: 'POST', body: JSON.stringify({ name: m.name || null }) });
        const status = signupStatusFromResponse(r.status, r.data) === 'account_exists' ? 'already_owns' : signupStatusFromResponse(r.status, r.data);
        if (status === 'ok' && r.data?.login?.token) {
          await adoptSession(r.data.login);
          await reloadActiveTabs();
        }
        return { status, message: r.message };
      }
      case 'getTabState': {
        const map = await getProjectMap();
        const staged = await getStaged();
        const stagedHere = staged && staged.hostname === m.hostname ? { project: staged.project, environment: staged.environment } : null;
        return { active: await isActive(m.tabId), remembered: map[m.hostname] || stagedHere || null, visitor: (await getVisitorMap())[m.hostname] ? true : false, unclaimed: !!(await getUnclaimedArm(m.tabId)) };
      }
      case 'stageActivation': {
        await setStaged({ tabId: m.tabId, hostname: m.hostname, origin: m.origin, project: m.project, environment: m.environment, at: Date.now() });
        return { ok: true };
      }
      case 'deactivate': {
        try {
          const tab = await chrome.tabs.get(m.tabId);
          const host = hostnameOf(tab.url || '');
          const visitors = await getVisitorMap();
          if (host && visitors[host]) { delete visitors[host]; await setVisitorMap(visitors); }
        } catch { /* tab may be gone */ }
        await deactivate(m.tabId);
        return { ok: true };
      }
      case 'visitorProjectForOrigin': {
        try {
          const r = await fetch(`${await getServer()}/api/public/visitor/project-for-origin?origin=${encodeURIComponent(m.origin)}`);
          if (!r.ok) return { ok: false, project: null };
          const data = await r.json().catch(() => null);
          const d = data && (data.data ?? data);
          if (!d || !d.projectKey) return { ok: false, project: null };
          return { ok: true, project: { key: d.projectKey, name: d.projectName } };
        } catch { return { ok: false, project: null }; }
      }
      case 'activateVisitor': {
        if (await getToken()) return { ok: false, error: 'signed-in' };
        if (!(await hasHostPermission(m.origin))) {
          return { ok: false, error: 'Permission for this site was not granted — click Activate again and allow access when your browser asks.' };
        }
        const map = await getVisitorMap();
        map[m.hostname] = { project: m.project };
        await setVisitorMap(map);
        await setUnclaimedArm(m.tabId, null);
        await setVisitorEntry(m.tabId, m.entry);
        await addCspBypass(m.tabId);
        await addPendingInject(m.tabId);
        await chrome.tabs.reload(m.tabId);
        return { ok: true };
      }
      case 'activateUnclaimed': {
        if (!(await hasHostPermission(m.origin))) {
          return { ok: false, error: 'Permission for this site was not granted — click Leave feedback again and allow access when your browser asks.' };
        }
        await setUnclaimedArm(m.tabId, armUnclaimed(m.origin, Date.now()));
        await addCspBypass(m.tabId);
        await addPendingInject(m.tabId);
        await chrome.tabs.reload(m.tabId);
        return { ok: true };
      }
      case 'login': {
        const res = await login(m.email, m.password);
        // On success, refresh any activated tabs so their widget re-injects authenticated.
        if ((res as { ok?: boolean }).ok) await reloadActiveTabs();
        return res;
      }
      case 'switchWorkspace': {
        const res = await switchWorkspace(m.workspaceId, m.selectionToken);
        if ((res as { ok?: boolean }).ok) await reloadActiveTabs();
        return res;
      }
      case 'logout': {
        await clearSession();
        await deactivateAllTabs();
        return { ok: true };
      }
      case 'setProjectForDomain': {
        const map = await getProjectMap();
        const prev = map[m.hostname];
        map[m.hostname] = { project: m.project, environment: prev?.environment || 'staging' };
        await chrome.storage.local.set({ [LOCAL_KEYS.projectByDomain]: map });
        return { ok: true };
      }
      case 'listProjects': {
        // A super admin owns no tenant, so GET /api/admin/projects returns every tenant's projects
        // at once (by design, for platform management) rather than "the caller's workspace" — showing
        // that list here would look like duplicate project keys and can never activate (see 'activate').
        const su = (await chrome.storage.local.get(LOCAL_KEYS.user))[LOCAL_KEYS.user] as StoredUser | null;
        if (su?.isSuperAdmin) return { ok: false, projects: [], error: 'Super admin accounts can’t use PinSay here — sign in with a workspace account instead.' };
        const r = await apiFetch('/api/admin/projects', { method: 'GET' });
        if (r.signedOut) return { ok: false, projects: [], signedOut: true };
        if (!r.ok) return { ok: false, projects: [], error: r.message || 'Could not load projects.' };
        const projects = (Array.isArray(r.data) ? r.data : [])
          .filter((p: any) => p && p.key && p.isActive !== false)
          .map((p: any): ExtProject => ({ key: p.key, name: p.name || p.key, isActive: p.isActive !== false, urls: projectUrls(p) }));
        return { ok: true, projects };
      }
      case 'projectForOrigin': {
        // For quick-access (Client) accounts: a single scoped lookup by the tab's own origin,
        // instead of listProjects's tenant-wide browse (which they're barred from).
        const r = await apiFetch(`/api/extension/project-for-origin?origin=${encodeURIComponent(m.origin)}`, { method: 'GET' });
        if (r.signedOut) return { ok: false, project: null, signedOut: true };
        if (!r.ok) return { ok: false, project: null, error: r.message || 'No project is set up for this site.' };
        return { ok: true, project: { key: r.data.key, name: r.data.name, isActive: true, urls: [m.origin] } as ExtProject };
      }
      case 'createProject': {
        // The key is generated, never typed: from the name, else the site's name, else "project";
        // ... plus a random tail so it never collides with another workspace's key (see slug.ts).
        // made unique against the keys the popup already knows, and on a 409 (a key taken by a project
        // the popup cannot see, e.g. an inactive one) the next candidate is tried.
        const base = generatedKeyBase(m.name, hostnameOf(m.appUrl));
        let last: { ok: boolean; status: number; message: string | null } = { ok: false, status: 0, message: null };
        for (const key of keyCandidates(base, m.takenKeys || [])) {
          const body: Record<string, unknown> = { key, name: m.name, appUrl: m.appUrl || null };
          // Stamp the AppUrl under the environment the user picked; without one the API files it under
          // "local", which is wrong for a deployed site.
          if (m.appUrl && m.appEnvironmentId) body.appEnvironmentId = m.appEnvironmentId;
          last = await apiFetch('/api/admin/projects', { method: 'POST', body: JSON.stringify(body) });
          if (last.ok) return { ok: true, project: { key, name: m.name, isActive: true, urls: m.appUrl ? [m.appUrl] : [] } };
          if (last.status !== 409) break;
        }
        return { ok: false, error: last.status === 409 ? 'Could not find a free project key. Try another name.' : (last.message || 'Could not create project.') };
      }
      case 'listEnvironments': {
        const r = await apiFetch('/api/admin/environments', { method: 'GET' });
        if (!r.ok) return { ok: false, environments: [] };
        const environments: ExtEnvironment[] = (Array.isArray(r.data) ? r.data : [])
          .filter((e: any) => e && typeof e.id === 'number' && e.isEnabled !== false && e.isRetired !== true)
          .map((e: any) => ({ id: e.id, name: String(e.name || '') }));
        return { ok: true, environments };
      }
      case 'activate': {
        // Super-admin guard, host-permission check, entitlement gate (/api/extension/activate) and the
        // injection itself live in runActivation so the permissions.onAdded path shares them.
        return runActivation({ tabId: m.tabId, hostname: m.hostname, origin: m.origin, project: m.project, environment: m.environment });
      }
      case 'redeemInvite': { return { ok: await handleInviteLink(m.tabId, m.url) }; }
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
