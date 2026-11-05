// Universal capture (unclaimed-domain feedback): which tab URLs may show the Universal Feedback Card.
export function unclaimedEligible(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h.startsWith('[') || h.includes(':')) return false;
  if (h === 'localhost' || /\.(localhost|local|internal)$/.test(h)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return true;
}

/** A tab armed for universal capture: later loads on the same origin get the unclaimed widget again. */
export type UnclaimedArm = { origin: string; at: number; loads: number[] };
/** How long a tab stays armed after "Leave feedback". */
export const UNCLAIMED_ARM_MS = 30 * 60 * 1000;
/** Reload-loop guard: this many injections inside the window disarm the tab. */
export const UNCLAIMED_LOOP_MAX = 5;
export const UNCLAIMED_LOOP_WINDOW_MS = 20 * 1000;

export function armUnclaimed(origin: string, now: number): UnclaimedArm {
  return { origin, at: now, loads: [] };
}

/**
 * One completed load of `url` in a tab that has an arm (`arm` is whatever session storage holds; anything malformed
 * counts as no arm). Returns whether to inject the unclaimed widget and the arm to keep (null = drop it).
 */
export function unclaimedLoad(arm: unknown, url: string, now: number): { inject: boolean; arm: UnclaimedArm | null } {
  const drop = { inject: false, arm: null };
  if (!arm || typeof arm !== 'object') return drop;
  const a = arm as Partial<UnclaimedArm>;
  if (typeof a.origin !== 'string' || typeof a.at !== 'number') return drop;
  if (now - a.at > UNCLAIMED_ARM_MS) return drop;
  let origin: string;
  try { origin = new URL(url).origin; } catch { return drop; }
  if (origin !== a.origin) return drop;
  const loads = (Array.isArray(a.loads) ? a.loads : []).filter((t) => typeof t === 'number' && now - t < UNCLAIMED_LOOP_WINDOW_MS);
  if (loads.length >= UNCLAIMED_LOOP_MAX) return drop;
  return { inject: true, arm: { origin: a.origin, at: a.at, loads: [...loads, now] } };
}
