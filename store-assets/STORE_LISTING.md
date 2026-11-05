# Store listings — PinSay extension (0.5.0 and later)

One section per store. Website https://pinsay.dev · Docs https://pinsay.dev/docs/ · Privacy policy https://pinsay.dev/privacy.html

## Chrome Web Store

### Short description (≤ 132 chars)
Click any element on a running web app, leave a comment, and your AI agent applies it to the real source.

### Detailed description

PinSay turns "make this button bigger" into an actual code change.

Click any element on a running web app, leave a short comment, and your AI agent applies it to the real source files. No more translating vague feedback into code.

This extension carries PinSay onto **any** page, including apps you don't control or can't add a script tag to. You sign in once and stay signed in on every site.

── How it works ──
1. Click the toolbar icon and sign in once.
2. Open any site, pick a project, and Activate. The PinSay widget appears on the page.
3. Click an element, type what should change, submit. The comment is saved to your PinSay account, tagged with project, environment, stakeholder, and author.
4. Your AI agent pulls the queue and applies each edit to the real source. The comment carries the element's selector, a snapshot, the CSS that actually applies, and the page route, so the change lands precisely.

── Why the extension ──
• Works on any site, even ones with a strict Content-Security-Policy.
• Sign in once. No per-site setup, no script tag to install.
• The widget loads live from the PinSay service, so it updates without an extension release.
• The widget renders in an isolated Shadow DOM, so it never clashes with the page's styles.

── For teams ──
• Clients, PMs and testers just click and comment on the live app. They only need this extension.
• Developers get a clean, source-aware queue instead of screenshots and vague notes.

── Privacy & permissions ──
Your feedback and sign-in go only to the PinSay service.
• Your sign-in token stays inside the extension and is never exposed to the pages you visit.
• Host access (all sites) is used only to inject the widget on tabs you explicitly activate.
• On an activated tab, the extension adjusts that tab's content-security policy solely so the feedback widget can load. This is scoped to that one tab and removed when you deactivate or close it.

Requires a free PinSay account. PinSay is free.

── Links ──
Website: https://pinsay.dev
Docs: https://pinsay.dev/docs/
Privacy policy: https://pinsay.dev/privacy.html

### Category
Developer Tools

### Single purpose description
Injects the PinSay feedback widget onto any webpage, letting the user click an element and leave
feedback that syncs to their PinSay account. Every requested permission exists solely to support
this: `<all_urls>`/`scripting` inject the widget on the tab the user activates;
`declarativeNetRequestWithHostAccess` strips CSP only on that activated tab so the widget can load on
CSP-strict sites; `storage` holds the session token and remembers the per-domain project choice.

### Permission justifications (paste into the review form)
- **Host permissions / `<all_urls>` (optional, granted per site)** — to inject the feedback widget into the page on tabs the user explicitly activates. No narrower match pattern is possible: the user picks which site to activate, and access is requested per origin at that moment (`chrome.permissions.request`), never up front.
- **`activeTab`** — to read the URL of the tab the user is on when they click the toolbar icon, so the popup can show which site it is and request host access for exactly that origin. Before that first grant the extension has no host permission on the site, so this is the only way to know the origin. It is never used to inject scripts or read page content — injection happens only after the user grants host access and clicks Activate.
- **`declarativeNetRequestWithHostAccess`** — to remove the page's CSP **only on the user-activated tab** so the widget can load; the rule is scoped to that tab and removed on deactivate/close.
- **`scripting`** — to inject the widget + bridge into the activated tab.
- **`storage`** — to keep the user signed in (session token) and remember per-domain project preferences.

Not requested: `tabs` — the per-origin host grant plus `activeTab` cover everything the popup needs; `chrome.tabs.query/reload` and the `onUpdated`/`onRemoved` listeners work without the `tabs` permission.

### Data disclosures
- Collects: authentication info (login token) and user-submitted content (feedback comments + captured element metadata, including optional console/network context when the **Bug** pill is on), sent to the PinSay service.
- Collects (since 0.5.0): **user activity** — each time the user activates PinSay on a tab: the time, the project, the browser (Chrome / Edge / Firefox / other Chromium), the store build and the extension version; and, once per workspace and site, the site's origin (scheme, host and port, no path). Used only to count extension use for the PinSay operator; visible only to PinSay's platform administrators. The per-person totals are kept while the account exists and erased with it; the raw activation records are deleted after 180 days.
- Privacy practices answers (before submitting): tick **Authentication information**, **User activity**, **Website content** (the comments and element snapshots the user submits); leave every other category unticked; certify the three disclosures (not sold, not used for unrelated purposes, not used for creditworthiness).
- **Bug reports (DB-26):** when a project turns on bug capture, a comment marked as a bug carries network calls, console errors and the user's steps from the page (and, if the project's admin enables it, redacted request/response content). This is still **Website content** (already ticked); no new category. Re-check the answers before the next submission.
- Not sold to third parties; not used for advertising or unrelated purposes.
- Privacy policy: https://pinsay.dev/privacy.html

## Microsoft Edge Add-ons

### Short description (≤ 132 chars)
Click any element on a running web app, leave a comment, and your AI agent applies it to the real source.

### Detailed description

PinSay turns "make this button bigger" into an actual code change.

Click any element on a running web app, leave a short comment, and your AI agent applies it to the real source files. No more translating vague feedback into code.

This extension carries PinSay onto **any** page, including apps you don't control or can't add a script tag to. You sign in once and stay signed in on every site.

── How it works ──
1. Click the toolbar icon and sign in once.
2. Open any site, pick a project, and Activate. The PinSay widget appears on the page.
3. Click an element, type what should change, submit. The comment is saved to your PinSay account, tagged with project, environment, stakeholder, and author.
4. Your AI agent pulls the queue and applies each edit to the real source. The comment carries the element's selector, a snapshot, the CSS that actually applies, and the page route, so the change lands precisely.

── Why the extension ──
• Works on any site, even ones with a strict Content-Security-Policy.
• Sign in once. No per-site setup, no script tag to install.
• The widget loads live from the PinSay service, so it updates without an extension release.
• The widget renders in an isolated Shadow DOM, so it never clashes with the page's styles.

── For teams ──
• Clients, PMs and testers just click and comment on the live app. They only need this extension.
• Developers get a clean, source-aware queue instead of screenshots and vague notes.

── Privacy & permissions ──
Your feedback and sign-in go only to the PinSay service.
• Your sign-in token stays inside the extension and is never exposed to the pages you visit.
• Host access (all sites) is used only to inject the widget on tabs you explicitly activate.
• On an activated tab, the extension adjusts that tab's content-security policy solely so the feedback widget can load. This is scoped to that one tab and removed when you deactivate or close it.

Requires a free PinSay account. PinSay is free.

── Links ──
Website: https://pinsay.dev
Docs: https://pinsay.dev/docs/
Privacy policy: https://pinsay.dev/privacy.html

### Category
Developer tools

### Single purpose description
Injects the PinSay feedback widget onto any webpage, letting the user click an element and leave
feedback that syncs to their PinSay account. Every requested permission exists solely to support
this: `<all_urls>`/`scripting` inject the widget on the tab the user activates;
`declarativeNetRequestWithHostAccess` strips CSP only on that activated tab so the widget can load on
CSP-strict sites; `storage` holds the session token and remembers the per-domain project choice.

### Permission justifications (paste into the review form)
- **Host permissions / `<all_urls>` (optional, granted per site)** — to inject the feedback widget into the page on tabs the user explicitly activates. No narrower match pattern is possible: the user picks which site to activate, and access is requested per origin at that moment (`chrome.permissions.request`), never up front.
- **`activeTab`** — to read the URL of the tab the user is on when they click the toolbar icon, so the popup can show which site it is and request host access for exactly that origin. Before that first grant the extension has no host permission on the site, so this is the only way to know the origin. It is never used to inject scripts or read page content — injection happens only after the user grants host access and clicks Activate.
- **`declarativeNetRequestWithHostAccess`** — to remove the page's CSP **only on the user-activated tab** so the widget can load; the rule is scoped to that tab and removed on deactivate/close.
- **`scripting`** — to inject the widget + bridge into the activated tab.
- **`storage`** — to keep the user signed in (session token) and remember per-domain project preferences.

Not requested: `tabs` — the per-origin host grant plus `activeTab` cover everything the popup needs; `chrome.tabs.query/reload` and the `onUpdated`/`onRemoved` listeners work without the `tabs` permission.

### Data disclosures
- Collects: authentication info (login token) and user-submitted content (feedback comments + captured element metadata, including optional console/network context when the **Bug** pill is on), sent to the PinSay service.
- **Bug reports (DB-26):** when a project turns on bug capture, a comment marked as a bug carries network calls, console errors and the user's steps from the page (and, if the project's admin enables it, redacted request/response content). This is still **Website content** (already ticked); no new category. Re-check the answers before the next submission.
- Collects (since 0.5.0): **user activity** — each time the user activates PinSay on a tab: the time, the project, the browser (Chrome / Edge / Firefox / other Chromium), the store build and the extension version; and, once per workspace and site, the site's origin (scheme, host and port, no path). Used only to count extension use for the PinSay operator; visible only to PinSay's platform administrators. The per-person totals are kept while the account exists and erased with it; the raw activation records are deleted after 180 days.
- Privacy practices answers (same answers as Chrome): tick **Authentication information**, **User activity**, **Website content** (the comments and element snapshots the user submits); leave every other category unticked; certify the three disclosures (not sold, not used for unrelated purposes, not used for creditworthiness).
- Not sold to third parties; not used for advertising or unrelated purposes.
- Privacy policy: https://pinsay.dev/privacy.html

## Firefox Add-ons (AMO)

### Short description (≤ 132 chars)
Click any element on a running web app, leave a comment, and your AI agent applies it to the real source.

### Detailed description

PinSay turns "make this button bigger" into an actual code change.

Click any element on a running web app, leave a short comment, and your AI agent applies it to the real source files. No more translating vague feedback into code.

This extension carries PinSay onto **any** page, including apps you don't control or can't add a script tag to. You sign in once and stay signed in on every site.

── How it works ──
1. Click the toolbar icon and sign in once.
2. Open any site, pick a project, and Activate. The PinSay widget appears on the page.
3. Click an element, type what should change, submit. The comment is saved to your PinSay account, tagged with project, environment, stakeholder, and author.
4. Your AI agent pulls the queue and applies each edit to the real source. The comment carries the element's selector, a snapshot, the CSS that actually applies, and the page route, so the change lands precisely.

── Why the extension ──
• Works on any site, even ones with a strict Content-Security-Policy.
• Sign in once. No per-site setup, no script tag to install.
• The widget loads live from the PinSay service, so it updates without an extension release.
• The widget renders in an isolated Shadow DOM, so it never clashes with the page's styles.

── For teams ──
• Clients, PMs and testers just click and comment on the live app. They only need this extension.
• Developers get a clean, source-aware queue instead of screenshots and vague notes.

── Privacy & permissions ──
Your feedback and sign-in go only to the PinSay service.
• Your sign-in token stays inside the extension and is never exposed to the pages you visit.
• Host access (all sites) is used only to inject the widget on tabs you explicitly activate.
• On an activated tab, the extension adjusts that tab's content-security policy solely so the feedback widget can load. This is scoped to that one tab and removed when you deactivate or close it.

Requires a free PinSay account. PinSay is free.

── Links ──
Website: https://pinsay.dev
Docs: https://pinsay.dev/docs/
Privacy policy: https://pinsay.dev/privacy.html

### Category
Web Development

### Single purpose description
Injects the PinSay feedback widget onto any webpage, letting the user click an element and leave
feedback that syncs to their PinSay account. Every requested permission exists solely to support
this: `<all_urls>`/`scripting` inject the widget on the tab the user activates;
`declarativeNetRequestWithHostAccess` strips CSP only on that activated tab so the widget can load on
CSP-strict sites; `storage` holds the session token and remembers the per-domain project choice.

### Permission justifications (paste into the review form)
- **Host permissions / `<all_urls>` (optional, granted per site)** — to inject the feedback widget into the page on tabs the user explicitly activates. No narrower match pattern is possible: the user picks which site to activate, and access is requested per origin at that moment (`chrome.permissions.request`), never up front.
- **`activeTab`** — to read the URL of the tab the user is on when they click the toolbar icon, so the popup can show which site it is and request host access for exactly that origin. Before that first grant the extension has no host permission on the site, so this is the only way to know the origin. It is never used to inject scripts or read page content — injection happens only after the user grants host access and clicks Activate.
- **`declarativeNetRequestWithHostAccess`** — to remove the page's CSP **only on the user-activated tab** so the widget can load; the rule is scoped to that tab and removed on deactivate/close.
- **`scripting`** — to inject the widget + bridge into the activated tab.
- **`storage`** — to keep the user signed in (session token) and remember per-domain project preferences.

Not requested: `tabs` — the per-origin host grant plus `activeTab` cover everything the popup needs; `chrome.tabs.query/reload` and the `onUpdated`/`onRemoved` listeners work without the `tabs` permission.

### Firefox specifics
- Add-on id: `pinsay@pinsay.dev`. Minimum Firefox version: **140**.
- Firefox runs the background script as an event page, not a `service_worker`. Users see no difference.

### Data-collection declaration (`data_collection_permissions.required`)
- `authenticationInfo` — your PinSay sign-in token, kept inside the extension.
- `personallyIdentifyingInfo` — your PinSay account name and email, used to sign you in and tag your comments.
- `websiteActivity` — when you activate PinSay on a tab: the time, the project and the site's origin (no path).
- `websiteContent` — the comments and element snapshots you submit.

### Data disclosures
- Collects: authentication info (login token) and user-submitted content (feedback comments + captured element metadata, including optional console/network context when the **Bug** pill is on), sent to the PinSay service.
- **Bug reports (DB-26):** when a project turns on bug capture, a comment marked as a bug carries network calls, console errors and the user's steps from the page (and, if the project's admin enables it, redacted request/response content). This is covered by websiteContent; no new category. Re-check the answers before the next submission.
- Collects (since 0.5.0): **user activity** — each time the user activates PinSay on a tab: the time, the project, the browser (Chrome / Edge / Firefox / other Chromium), the store build and the extension version; and, once per workspace and site, the site's origin (scheme, host and port, no path). Used only to count extension use for the PinSay operator; visible only to PinSay's platform administrators. The per-person totals are kept while the account exists and erased with it; the raw activation records are deleted after 180 days.
- Not sold to third parties; not used for advertising or unrelated purposes.
- Privacy policy: https://pinsay.dev/privacy.html

### Source code (AMO review)
Each version is uploaded with its source archive `pinsay-ext-source-<version>.zip`, which contains `SOURCE-BUILD.md` with the exact steps to rebuild the submitted add-on.

## Screenshots
Media is producing the new screenshot set (hand-off `pinsay-media/handoffs/2026-10-10-store-listing-assets.md`). Name each file here when it lands in `store-assets/`; no screenshot is listed until it exists.
