export interface GuideState { projectKey: string; projectName: string; siteOrigin: string | null; startedAt: number; activatedAt?: number }
export const GUIDE_TTL_MS = 24 * 60 * 60 * 1000;

/** Validates the dashboard's guide-start message. Returns null for anything unexpected. No credentials ever. */
export function parseGuideStart(d: unknown, now: number): GuideState | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  if (m.source !== 'pinsay-dashboard' || m.kind !== 'guide-start') return null;
  const key = typeof m.projectKey === 'string' ? m.projectKey : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return null;
  const name = typeof m.projectName === 'string' ? m.projectName.trim().slice(0, 120) : '';
  if (!name) return null;
  let origin: string | null = null;
  if (typeof m.siteOrigin === 'string' && m.siteOrigin) {
    try { const u = new URL(m.siteOrigin); if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.origin; } catch { origin = null; }
  }
  return { projectKey: key, projectName: name, siteOrigin: origin, startedAt: now };
}

export function guideActive(g: GuideState | null | undefined, now: number): g is GuideState {
  return !!g && now - g.startedAt < GUIDE_TTL_MS;
}

export type GuideStepState = 'done' | 'current' | 'todo';

/** D6/AC20: Choose counts only an explicit pick in this popup (never a preselection), or a tab already running the project. */
export function guideProgress(g: GuideState, pickedKey: string, activeProject: string | null): { choose: GuideStepState; activate: GuideStepState; comment: boolean } {
  const activated = !!activeProject && activeProject === g.projectKey;
  const chosen = activated || (!!pickedKey && pickedKey === g.projectKey);
  return { choose: chosen ? 'done' : 'current', activate: activated ? 'done' : chosen ? 'current' : 'todo', comment: activated };
}
