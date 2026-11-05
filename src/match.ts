// Pure URL -> project matching for the popup. No chrome APIs and no imports, so it is unit-tested
// with node:test (see test/match.test.ts). The popup calls chooseProject() once per render.

/** The smallest project shape the matcher needs: its key and every URL it is registered under. */
export type MatchableProject = { key: string; urls?: unknown };

/**
 * How a project URL matched the tab, strongest first:
 * 3 = same origin (scheme, host, port), the rule the server uses for activation;
 * 2 = a wildcard app-URL pattern (https://myapp-*.vercel.app);
 * 1 = same site, differing only by http/https, a leading "www.", or a loopback alias
 *     (localhost, 127.0.0.1, [::1]). Ports must always agree: localhost:3000 and :5173 are two apps.
 */
export type MatchTier = 1 | 2 | 3;

/** A project's best match. pathScore breaks ties within a tier: the length of the URL's path when
 * the tab is under it, 0 for a URL without a path, -1 for a URL whose path the tab is not under. */
export type ProjectMatch = { key: string; tier: MatchTier; pathScore: number };

/** What the popup preselects, and why (drives the hint under the picker). */
export type ProjectChoice =
  | { key: string; source: 'remembered' | 'matched' }
  | { key: ''; source: 'ambiguous'; candidates: string[] }
  | { key: ''; source: 'none' };

type Parsed = { scheme: string; host: string; port: string; path: string; search: string };

const WILDCARD = 'wildcardplaceholder';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(raw: string): Parsed | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  // URL already lower-cases scheme and host and drops a default port (port === '').
  return { scheme: u.protocol, host: u.hostname, port: u.port, path: u.pathname.replace(/\/+$/, ''), search: u.search };
}

/** "www.acme.com" -> "acme.com", any loopback alias -> "localhost". */
function siteHost(host: string): string {
  if (LOOPBACK.has(host)) return 'localhost';
  return host.startsWith('www.') ? host.slice(4) : host;
}

function pathScore(urlPath: string, tabPath: string): number {
  if (urlPath === '') return 0;
  if (tabPath === urlPath || tabPath.startsWith(urlPath + '/')) return urlPath.length;
  return -1;
}

/** Same shape as the server's OriginNormalizer.Matches: one '*' in the leftmost host label, no
 * path or query, scheme/port/label count equal, the other labels literal. */
function patternMatches(pattern: string, tab: Parsed): boolean {
  if ((pattern.match(/\*/g) || []).length !== 1) return false;
  const p = parse(pattern.replace('*', WILDCARD));
  if (!p || p.path !== '' || p.search !== '') return false;
  if (p.scheme !== tab.scheme || p.port !== tab.port) return false;
  const pl = p.host.split('.');
  const tl = tab.host.split('.');
  if (pl.length !== tl.length) return false;
  if (!pl[0].includes(WILDCARD) || pl.slice(1).some((l) => l.includes(WILDCARD))) return false;
  for (let i = 1; i < pl.length; i++) if (pl[i] !== tl[i]) return false;
  const [prefix, suffix] = pl[0].split(WILDCARD);
  const label = tl[0];
  return label.length >= prefix.length + suffix.length && label.startsWith(prefix) && label.endsWith(suffix);
}

function matchOne(url: string, tab: Parsed): { tier: MatchTier; pathScore: number } | null {
  if (!url) return null;
  if (url.includes('*')) return patternMatches(url, tab) ? { tier: 2, pathScore: 0 } : null;
  const c = parse(url);
  if (!c) return null;
  const score = pathScore(c.path, tab.path);
  if (c.scheme === tab.scheme && c.host === tab.host && c.port === tab.port) return { tier: 3, pathScore: score };
  if (c.port === tab.port && siteHost(c.host) === siteHost(tab.host)) return { tier: 1, pathScore: score };
  return null;
}

function better(a: { tier: number; pathScore: number }, b: { tier: number; pathScore: number }): boolean {
  return a.tier !== b.tier ? a.tier > b.tier : a.pathScore > b.pathScore;
}

/** Every project with at least one URL matching the tab, best first (ties keep the input order). */
export function matchProjects(projects: MatchableProject[], tabUrl: string): ProjectMatch[] {
  const tab = parse(tabUrl);
  if (!tab) return [];
  const out: ProjectMatch[] = [];
  for (const p of projects) {
    let best: { tier: MatchTier; pathScore: number } | null = null;
    for (const url of Array.isArray(p.urls) ? p.urls : []) {
      if (typeof url !== 'string') continue;
      const m = matchOne(url, tab);
      if (m && (!best || better(m, best))) best = m;
    }
    if (best) out.push({ key: p.key, tier: best.tier, pathScore: best.pathScore });
  }
  // Array.prototype.sort is stable, so equal matches keep the list's order.
  return out.sort((a, b) => (b.tier - a.tier) || (b.pathScore - a.pathScore));
}

/**
 * The project to preselect. A remembered choice for this site (the user's last activation here)
 * wins when that project is still in the list; otherwise the single best URL match; when several
 * projects match equally well nothing is selected (a wrong silent pick binds a tab to the wrong
 * project); no match selects nothing.
 */
export function chooseProject(projects: MatchableProject[], tabUrl: string, remembered?: string | null): ProjectChoice {
  if (remembered && projects.some((p) => p.key === remembered)) return { key: remembered, source: 'remembered' };
  const matches = matchProjects(projects, tabUrl);
  if (matches.length === 0) return { key: '', source: 'none' };
  const top = matches[0];
  const tied = matches.filter((m) => m.tier === top.tier && m.pathScore === top.pathScore);
  if (tied.length === 1) return { key: top.key, source: 'matched' };
  return { key: '', source: 'ambiguous', candidates: tied.map((m) => m.key) };
}
