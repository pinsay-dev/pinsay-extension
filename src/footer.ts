// The popup footer: the extension's version and a link to the public changelog.

export const CHANGELOG_URL = 'https://pinsay.dev/docs/extension-changelog.html';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** "v0.7.2 · What's new"; only the link when the version is unknown. The version stays left-to-right in RTL. */
export function footerHtml(version: string, whatsNew: string): string {
  const link = `<a id="whats-new" href="${CHANGELOG_URL}">${esc(whatsNew)}</a>`;
  if (!version) return link;
  return `<span dir="ltr">v${esc(version)}</span><span aria-hidden="true">·</span>${link}`;
}
