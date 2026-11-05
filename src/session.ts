// The extension's session is a JWT kept in storage.session, which lives until the browser quits — on a Mac that is
// often days, while the API signs tokens for 12 hours (JWT__LifetimeHours). An expired or revoked token must end the
// extension's session: kept, it made the popup say "Could not load projects." and the proxy swap it over the token the
// widget had just signed in with, so the widget asked to sign in again after every code (2026-10-29-widget-signin-loop).

/** Seconds of slack: a token this close to its `exp` is treated as expired (clock drift, request in flight). */
export const EXPIRY_SKEW_MS = 30_000;

/** The `exp` claim of a JWT in milliseconds, or null when the token is not a readable JWT or has no numeric `exp`. */
export function tokenExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload?.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the token's `exp` is at or before `nowMs + EXPIRY_SKEW_MS`. Unreadable or no `exp` → false (the server decides). */
export function tokenExpired(token: string, nowMs: number): boolean {
  const exp = tokenExpiryMs(token);
  return exp !== null && exp <= nowMs + EXPIRY_SKEW_MS;
}
