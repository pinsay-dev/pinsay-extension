// Project-key helpers for "+ Add project". Same rules as the dashboard's slugifyKey
// (pinsay-dashboard/react/src/lib/project-utils.ts) and the API's CreateProjectValidator:
// ^[a-z0-9-]+$, at most 64 characters. Pure: no chrome APIs, unit-tested with node:test.

export const KEY_MAX_LENGTH = 64;

const ARABIC_MAP: Record<string, string> = {
  'ء': 'a', 'آ': 'a', 'أ': 'a', 'ؤ': 'w', 'إ': 'a', 'ئ': 'y', 'ا': 'a', 'ب': 'b',
  'ة': 'h', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z',
  'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ى': 'a', 'ي': 'y',
  'پ': 'p', 'چ': 'ch', 'ژ': 'zh', 'ک': 'k', 'گ': 'g', 'ی': 'y',
};

function asciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/** "My Shop!" -> "my-shop", "متجر" -> "mtjr"; "" when nothing usable is left. */
export function slugifyKey(name: string): string {
  const latin = asciiDigits(name.toLowerCase())
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[ء-ۿ]/g, (ch) => ARABIC_MAP[ch] ?? ' ');
  return latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/** A readable default project name for a site: "www.bassitedu.com" -> "bassitedu",
 * "app.acme.io" -> "app.acme", "localhost" -> "localhost", an IP -> "local-app". */
export function siteName(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) return 'local-app';
  const labels = host.split('.');
  if (labels.length > 1) labels.pop();
  return labels.join('.');
}

/** The first `count` keys to try, in order: base, base-2, base-3, … skipping keys already taken
 * (case-insensitive). Each stays within KEY_MAX_LENGTH. */
export function keyCandidates(base: string, taken: string[], count = 6): string[] {
  const used = new Set(taken.map((k) => k.toLowerCase()));
  const out: string[] = [];
  for (let i = 1; out.length < count && i < 100; i++) {
    const suffix = i === 1 ? '' : `-${i}`;
    const key = base.slice(0, KEY_MAX_LENGTH - suffix.length).replace(/-+$/g, '') + suffix;
    if (key && !used.has(key)) out.push(key);
  }
  return out;
}

/** The environment a new project's site URL most likely belongs to. */
export function defaultEnvironmentName(hostname: string): 'local' | 'production' {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0'
    || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.test')
    || /^(10|127)\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return 'local';
  return 'production';
}

// Same aliases as the API's TagFromEnvironmentName (ProjectService.cs), which decides the comment tag.
const ENV_ALIASES: Record<'local' | 'production', string[]> = {
  local: ['local', 'localhost', 'development', 'dev'],
  production: ['production', 'prod', 'live'],
};

/** The environment to preselect for a new project's site URL: the first whose name means the
 * wanted kind (aliases in order of preference), else the first production-like one, else the
 * first in the list; null for an empty list. */
export function pickEnvironment<T extends { name: string }>(list: T[], hostname: string): T | null {
  if (list.length === 0) return null;
  const byKind = (kind: 'local' | 'production') => {
    for (const alias of ENV_ALIASES[kind]) {
      const hit = list.find((e) => e.name.trim().toLowerCase() === alias);
      if (hit) return hit;
    }
    return undefined;
  };
  return byKind(defaultEnvironmentName(hostname)) || byKind('production') || list[0];
}

const TAIL_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Four random base-36 characters for a generated key. Keys are unique only per workspace on the
 * server and the widget finds its project by key alone, so a generated key another workspace
 * already uses would hide that workspace's live widget (2026-10-09, bassitedu.com). The popup cannot
 * see other workspaces' keys; a random tail makes such a collision practically impossible. */
export function randomTail(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += TAIL_ALPHABET[Math.min(35, Math.floor(rand() * 36))];
  return out;
}

/** The base key for a new project: the slug of the name (or of the site's name, or "project"),
 * shortened so that "-xxxx" still fits in KEY_MAX_LENGTH, plus a random tail. */
export function generatedKeyBase(name: string, hostname: string, rand: () => number = Math.random): string {
  const slug = slugifyKey(name) || slugifyKey(siteName(hostname)) || 'project';
  const head = slug.slice(0, KEY_MAX_LENGTH - 5).replace(/-+$/g, '') || 'project';
  return `${head}-${randomTail(rand)}`;
}
