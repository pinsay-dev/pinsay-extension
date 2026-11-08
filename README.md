# PinSay — Browser Extension (Chrome, Edge, Firefox · MV3)

The browser extension of [PinSay](https://pinsay.dev): click any element of a web page, leave a comment on
it, and let any AI coding agent apply it. The extension injects the PinSay feedback widget into **any** web
page — including sites you don't control and can't add the `widget.js` loader to — and you **log in once**
instead of per site. The embedded `<pinsay-feedback>` widget remains the base product; this extension is a
way to *carry it anywhere*.

Install: [Chrome Web Store](https://chromewebstore.google.com/detail/mbigbdbfinpebboelnjfahidmcmepoek) ·
[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/pinsay/) · docs at [pinsay.dev/docs](https://pinsay.dev/docs/).

This repository is a **read-only mirror** of the extension's folder in PinSay's main (private) repository,
updated at each extension release. Licence: [MIT](LICENSE). Security reports: [SECURITY.md](SECURITY.md).

## Permissions and why

| Permission | Why |
|---|---|
| `storage` | Keeps your sign-in token in `chrome.storage.session` (cleared when the browser closes; the stored token is not injected into pages) and your per-site choices (which project a site uses) in `chrome.storage.local`. |
| `scripting` | Injects the content bridge and the widget loader into a tab **you** activate, and registers the early error capture on sites you set up. |
| `activeTab` | Lets the popup act on the tab you clicked the toolbar icon on. |
| `declarativeNetRequestWithHostAccess` | Removes the page's `Content-Security-Policy` header **only for the tab you activated**, so the widget can load on strict-CSP sites; the rule is removed when you deactivate or close the tab. |
| Host access to `app.pinsay.dev`, `api.pinsay.dev` | The PinSay API: sign-in, projects, comments. The widget's API requests go through the background worker, which adds your sign-in. |
| Optional access to other sites (`<all_urls>`, asked per site) | Asked only when you set up a site in the popup, and only for that site's origin (`chrome.permissions.request`). Without it the extension injects nothing and captures nothing on that site. |
| `vendor/snapdom.js` web-accessible | The screenshot library the widget uses to attach a capture to a comment. |

Firefox asks for data-collection consent for: authentication info, personally identifying info (your account),
website activity and website content — the comments, screenshots and page details you choose to send to PinSay.

Requests the extension makes to PinSay (`app.pinsay.dev`), and when:
- **Opening the popup** on a web page: it fetches the product name (`/api/branding`) and sends the page's
  **origin** (e.g. `https://example.com`, no path) to find a PinSay project that takes visitor feedback on that
  site; signed in, it loads your workspace's projects too.
- **Activating** PinSay on a site: the project key, the site's origin, and the browser, store and extension
  version (`/api/extension/activate`).
- **While a site is active**: the widget's own requests (your comments, screenshots and the page details you
  choose to send), through the background worker.

It never reads or sends page content on its own; the early error capture keeps errors in the page's memory
and sends nothing.

**Note: while PinSay is active on a site, scripts on that page share it with the feedback tool and can make the
same requests it makes with your account:** read, post, edit and delete comments and replies in your projects, change
your add-comment shortcut, and (as a project admin) the project's commit style. The extension never puts your session
on any other request: account, workspace switch, API-key, member, billing and other settings requests are refused,
and sign-in tokens are removed from what the page receives. Sign-in requests the page makes with its own credentials
still go through, as they would without the extension. Activate PinSay only on sites whose scripts you trust,
including their third-party scripts (typically your own app).

## How it relates to the widget

The extension does **not** reimplement the UI. On activation it loads the **live `widget.js`
from your PinSay server**, so any widget update you deploy shows up in the extension automatically
— **no extension re-release needed**. Only changes to the extension *shell* (popup, background,
manifest) require rebuilding/re-publishing.

The base widget exposes a small injection seam (in the PinSay widget):
- `window.__PINSAY_CONFIG__` — `{server, project, environment, token, user}`; the extension sets
  this so the widget starts already authenticated and targeting the chosen project.
- `window.__PINSAY_FETCH__` — a transport the widget routes all API calls through; the extension
  points it at its background service worker.

## Architecture

```
popup (login + per-domain project picker + activate)
      │  chrome.runtime
      ▼
background service worker
  • holds the JWT in chrome.storage.session  (never enters the page)
  • API proxy: every widget request is re-issued here with the real token —
    bypasses the page's connect-src CSP
  • activation: adds a per-tab declarativeNetRequest rule that strips the page's
    CSP header (so the remote widget.js/css can load), reloads the tab, then
    injects the content bridge (ISOLATED) + config/loader (MAIN world)
      ▲  window.postMessage
      │
content-bridge.js (ISOLATED)  ⇄  inject-main (MAIN world: __PINSAY_CONFIG__ +
                                   __PINSAY_FETCH__ + loads widget.js)
```

Security note: the real JWT stays in the background worker — the page only ever sees a placeholder
token (`__pinsay_via_proxy__`); the background swaps in the real token on each request. The CSP
strip is scoped to the single tab you explicitly activate and is removed on deactivate / tab close.

Bug reports from page load on: for every site set up in the extension (where its host permission is granted),
the background registers `early-capture.js` (MAIN world, `document_start`). It only listens for uncaught errors and
unhandled promise rejections and keeps up to 50 in page memory (`window.__PINSAY_EARLY__`); it never patches
console, fetch or XHR and sends nothing. When the widget's bug capture starts, it takes those entries (same
redaction, look-back window and caps) and the script stops. Failed page and resource loads (status ≥ 400) come
from the widget itself, via the Performance API.

## Install (reviewers)

Install from the store links above, then click the toolbar icon and sign in with your PinSay account → open the
app, click the toolbar icon, pick the project, **Activate**.

`npx @pinsay/cli init` sets a repository up for the extension by default (since CLI 0.9.0; `npx @pinsay/cli embed`
puts the widget in the code instead).

## Develop

```bash
cd extension            # or the root of this repository
npm install              # Node >= 22 (repo uses node@26)
npm run build            # Chrome → extension/dist (same as: node build.mjs --target chrome)
node build.mjs --target edge      # → extension/dist-edge
node build.mjs --target firefox   # → extension/dist-firefox
# Chrome: chrome://extensions → Developer mode → Load unpacked → select extension/dist
# Edge: edge://extensions → Load unpacked → dist-edge/
# Firefox: about:debugging → This Firefox → Load Temporary Add-on → dist-firefox/manifest.json
npm run watch            # rebuild on change (reload the extension after shell changes)
```

The extension talks only to `https://app.pinsay.dev` (since 0.4.0 there is no server setting).

### Build from source (this repository on its own)

Before building, fetch the screenshot library PinSay serves (snapdom v2.12.9, MIT):

```bash
mkdir -p vendor-src && curl -fsSL -o vendor-src/snapdom.js https://app.pinsay.dev/vendor/snapdom.js
npm ci && npm run typecheck && npm test   # the two pinsay.dev changelog-page tests are skipped here
node build.mjs --target chrome            # or edge / firefox
```

## Manual verification (E2E)

1. **Auth once** — click the toolbar icon → sign in with a PinSay account. The popup should show
   your name; the token lives in `chrome.storage.session` (never in any page).
2. **Plain site** — open e.g. `https://example.com`, set a project key, **Activate**. The tab
   reloads once and the PinSay launcher appears, already authenticated (no login prompt). Leave a
   comment → it appears in the dashboard under that project (self-registers).
3. **Strict-CSP site** — repeat on a site that sends a `Content-Security-Policy` (e.g. GitHub). The
   widget still loads (CSP stripped for the tab) and the comment POST is carried by the **background
   worker** (visible as a request from the service worker, not the page).
4. **Project match** — open a site whose URL is one of a project's URLs (app or environment URL) →
   the popup preselects that project with "Matches this site's URL." Reopen the popup on a site where
   you activated a project → that project is pre-filled ("Last used on this site.").
5. **Widget auto-update** — deploy a widget change to the server, reload the activated tab → the
   change appears with no extension rebuild.
6. **Deactivate** — Deactivate on the tab → it reloads with its original CSP restored.

## Not in this MVP

`data-component-source` mapping on third-party pages (applies fall back to snapshot/selector), and popup-driven re-auth on 401 (the
widget currently falls back to its own login modal).

## Contributing

This repository is a mirror: changes are made in PinSay's main repository and pushed here at each release, so
pull requests can't be merged directly. Found a bug or have an idea? Email support@pinsay.dev.

## License

[MIT](LICENSE) © PinSay

## Changelog

The same notes for users are on the public page
[pinsay.dev/docs/extension-changelog.html](https://pinsay.dev/docs/extension-changelog.html), which the popup
footer links to.

- **0.8.5** — Security fix: scripts on a page where PinSay is active can no longer use your PinSay sign-in for anything beyond the feedback tool's own requests. Sign-in, account, workspace, key, member and billing requests from the page never carry your session, and sign-in tokens are removed from what the page receives.
- **0.8.4** — **Leave feedback** on a site without visitor feedback keeps working when the page reloads or redirects by itself: the feedback tool comes back on the same site for 30 minutes, and the popup offers **Turn off on this site**. The card no longer says the site doesn't use PinSay (it may have a project with visitor feedback off) and says the page reloads once.
- **0.8.3** — On a site that doesn't use PinSay yet, the popup offers **Leave feedback**: with the site's permission it opens the PinSay feedback form on that page, and your feedback (screenshot included) is kept for the site's owner — your email is optional. On the sites you set up in the extension, a bug report now also includes uncaught page errors and unhandled rejections from the very start of the page load, before the feedback form opens.
- **0.8.2** — When your extension sign-in expires or is ended, the extension signs you out instead of keeping it: the popup asks you to sign in again rather than saying "Could not load projects.", and signing in from the widget on the page works instead of asking for a code again and again.
- **0.8.1** — Signing in with an emailed code always shows the result: the popup no longer waits for the site-access prompt, and if your account is in several workspaces, reopening the popup brings the workspace picker back. Asking for a new code too soon now says when you can ask again instead of "Too many requests". Comments are tagged with the environment whose URL matches the page (for example Local on localhost) instead of always Staging.
- **0.8.0** — Sign in with an emailed 6-digit code (or the email link) by default; sign up without a password. On sites whose workspace enables visitor feedback, the popup offers to leave feedback or track your feedback with just an email, and "Team sign in" for members. Comments can carry attached reference images (with the updated widget).
- **0.7.3** — The popup shows the extension's version and a What's new link to this changelog.
- **0.7.2** — Screenshots attached to a comment are real-pixel captures of the page, with a fallback when the browser cannot capture the tab.
- **0.7.1** — The project picker lists project names only, without a search box. After you use an invitation link, the extension keeps the site's real environment (for example staging), so your comments land there.
- **0.7.0** — Open an invitation link and the popup offers **Use this invitation**: it signs you in to the workspace you were invited to. Signed out, the popup explains how to get back in: reopen your invitation email, or ask the workspace admin for a new invitation.

- **0.6.0** — Create an account from the popup: confirm with a 6-digit code or the email link; your first project is set up on the site you're on. Members who own no workspace can create one.
- **0.5.1** — Firefox and Edge builds from the same source; no change for Chrome users. Activating twice at once (the first-time permission prompt) now counts once. Firefox: the first activation on a site asks for access correctly.
- **0.5.0** — Each activation also tells your PinSay server which browser (Chrome, Edge, Firefox, other Chromium), which store build and which extension version made it, so the operator can see extension use per browser and version. No page content or URL beyond the site's origin is sent. Build: `node build.mjs --target <chrome|edge|firefox>` (default Chrome).
- **0.4.1** — **+ Add project** asks only for a name and the environment the site's URL belongs to (local for
  local hosts, production otherwise); the project key is generated, with a short random tail so it never clashes
  with another workspace's key. On an activated tab the popup names the active project, and the main button says
  "Reload PinSay on this tab" when that project is selected. On a site that embeds its own PinSay widget, the
  extension's widget replaces it (it used to keep the page's own one, signed out and on the page's project).
- **0.4.0** — One server only: the sign-in form's server field and the Options page are gone (the
  extension always talks to app.pinsay.dev; an old saved server is cleared on update). The workspace
  switcher shows only for accounts with more than one workspace. The popup preselects the project
  whose URL matches the open tab (any of its app or environment URLs: the same origin first, then a
  wildcard pattern, then the same site via http/https, `www.` or a localhost alias, never another
  port; the most specific path wins) and says why under the picker. Several equal matches or none
  select nothing, with a hint; a project you last activated on that site still wins; switching
  workspace matches again; the picker can still be changed. Quick-access accounts get their matched
  project preselected. **+ Add project** names the tab's URL it stamps on the new project.
- **0.3.0** — New PinSay mark icons (toolbar + store), popup and options restyled to the PinSay design
  system (light + dark), refreshed Web Store assets. The widget itself updates live from the server,
  so it needs no extension release. Permissions unchanged.
