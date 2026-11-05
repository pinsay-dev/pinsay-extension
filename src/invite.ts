/** The `pinsay_invite` token in a URL, or null. Pure — unit-tested. */
export function inviteTokenFromUrl(url: string): string | null {
  try { return new URL(url).searchParams.get('pinsay_invite'); } catch { return null; }
}

/** The same URL without the `pinsay_invite` param (other params and hash preserved). Pure. */
export function stripInviteParam(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('pinsay_invite')) return url;
    u.searchParams.delete('pinsay_invite');
    return u.toString();
  } catch { return url; }
}

/**
 * The widget's environment name (`local` | `staging` | `production` | `unknown`) for the environment the API matched
 * this site's origin to (`environmentName` from /api/extension/project-for-origin). An unknown name becomes `unknown`
 * so the server tags comments by origin; a missing name (an API older than this field) keeps the old `staging`. Pure.
 */
export function widgetEnvironmentFor(environmentName: string | null | undefined): string {
  if (!environmentName) return 'staging';
  const n = environmentName.trim().toLowerCase();
  if (n === 'local') return 'local';
  if (n === 'staging') return 'staging';
  if (n === 'prod' || n === 'production') return 'production';
  return 'unknown';
}
