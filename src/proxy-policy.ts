// Which page requests the background proxies, and with whose credentials (SEC-BUG-01).
//
// Every script in the page shares the MAIN world with the widget, so the content bridge cannot tell a widget call from
// any other page script. The background therefore decides from the request alone: only the routes and methods the
// widget really calls are proxied, and only the widget's own routes ever carry the extension's session token.
// Account and session routes (credential issuance, workspace switch, API keys, members, billing, settings) are never
// reachable with that token. Source of the list: every `/api/` call in `pinsay-widget/src` (2026-11-05). A route the
// widget starts calling must be added here, or the extension refuses it (status 0).

import { proxyAuthorization } from './visitor.ts';

/** The placeholder token the MAIN-world transport hands the widget instead of the real JWT (inject-main.ts). */
export const PROXY_PLACEHOLDER = '__pinsay_via_proxy__';

/**
 * - `extension`: the widget's own work (comments, replies, uploads…). The extension's token rides the request when
 *   there is one (else the page's own header, as before), and credentials are stripped from the response.
 * - `page`: sign-in, visitor and public routes. Never the extension's token: only the page's own Authorization header
 *   (never the placeholder), so the page gets nothing it could not get by calling the API itself.
 */
export type ProxyAuthMode = 'extension' | 'page';

export type ProxyRoute = {
  kind: 'fetch' | 'upload';
  method: string;
  path: RegExp;
  mode: ProxyAuthMode;
  /** `page` routes that mean nothing without the page's own token: refused instead of sent anonymously. */
  needsPageAuth?: boolean;
  /** Extra check on the JSON body (route reaches settings; only the exact shape the widget sends passes). */
  body?: (body: string | null) => boolean;
  /** The response carries more than the widget reads (the account profile): a 2xx returns only `{"success":true}`. */
  minimalResponse?: boolean;
};

// One path segment: an id, a project key or a draft token. No `%` (no encoded `/`, `\` or dots), no `.`/`..`.
const S = '[A-Za-z0-9_~-][A-Za-z0-9._~-]*';
const p = (pattern: string) => new RegExp(`^/api/${pattern.replace(/\{\}/g, S)}$`);

const commitStyleOnly = (body: string | null): boolean => {
  try {
    const o = JSON.parse(body ?? '');
    return !!o && typeof o === 'object' && !Array.isArray(o)
      && Object.keys(o).length === 1 && (o.commitStyle === 1 || o.commitStyle === 2);
  } catch { return false; }
};

// The widget's shortcut setting (element.ts saveShortcutPreference): only `{"addCommentShortcut":"<binding>"}`.
const shortcutOnly = (body: string | null): boolean => {
  try {
    const o = JSON.parse(body ?? '');
    return !!o && typeof o === 'object' && !Array.isArray(o)
      && Object.keys(o).length === 1 && typeof o.addCommentShortcut === 'string' && o.addCommentShortcut.length <= 64;
  } catch { return false; }
};

const r = (kind: ProxyRoute['kind'], method: string, path: string, mode: ProxyAuthMode, extra: Partial<ProxyRoute> = {}): ProxyRoute =>
  ({ kind, method, path: p(path), mode, ...extra });

export const PROXY_ROUTES: readonly ProxyRoute[] = [
  // ---- the widget's own work: extension token, response stripped ----
  r('fetch', 'GET', 'statuses', 'extension'),
  r('fetch', 'GET', 'branding', 'extension'),
  r('fetch', 'GET', 'public/projects/{}/widget-status', 'extension'),
  r('fetch', 'GET', 'projects/{}/comments', 'extension'),
  r('fetch', 'POST', 'projects/{}/comments', 'extension'),
  r('fetch', 'GET', 'projects/{}/predefined-actions', 'extension'),
  r('fetch', 'GET', 'projects/{}/capture-config', 'extension'),
  r('fetch', 'POST', 'projects/{}/builds', 'extension'),
  r('fetch', 'GET', 'projects/{}/mentions/(users|search|comments)', 'extension'),
  r('fetch', 'POST', 'events', 'extension'),
  // Only the add-comment shortcut, and the answer (the whole account profile) is cut to `{"success":true}`.
  r('fetch', 'PATCH', 'me/preferences', 'extension', { body: shortcutOnly, minimalResponse: true }),
  r('fetch', 'GET', 'comments/{}', 'extension'),
  r('fetch', 'PATCH', 'comments/{}', 'extension'),
  r('fetch', 'PUT', 'comments/{}', 'extension'),
  r('fetch', 'DELETE', 'comments/{}', 'extension'),
  r('fetch', 'POST', 'comments/{}/verify', 'extension'),
  r('fetch', 'POST', 'comments/{}/replies', 'extension'),
  r('fetch', 'PATCH', 'comments/{}/visibility', 'extension'),
  r('fetch', 'PATCH', 'comments/{}/fields', 'extension'),
  r('fetch', 'PUT', 'replies/{}', 'extension'),
  r('fetch', 'DELETE', 'replies/{}', 'extension'),
  r('fetch', 'GET', 'figma-drafts/{}', 'extension'),
  // The widget's commit-style control (element.ts setCommitStyle): only `{"commitStyle":1|2}`, no other project setting.
  r('fetch', 'PATCH', 'admin/projects/[0-9]+', 'extension', { body: commitStyleOnly, minimalResponse: true }),
  r('upload', 'POST', 'uploads', 'extension'),

  // ---- sign-in, visitor and public routes: the page's own credentials only ----
  r('fetch', 'GET', 'roles', 'page'),
  r('fetch', 'POST', 'auth/login', 'page'),
  r('fetch', 'POST', 'auth/register', 'page'),
  r('fetch', 'POST', 'auth/login-with-invite', 'page'),
  r('fetch', 'POST', 'auth/magic/(sign-in|widget-sign-up|verify|status|resend)', 'page'),
  r('fetch', 'POST', 'auth/mfa/verify', 'page'),
  r('fetch', 'POST', 'auth/switch-workspace', 'page', { needsPageAuth: true }),
  r('fetch', 'GET', 'auth/me', 'page', { needsPageAuth: true }),
  r('fetch', 'GET', 'public/projects/{}/visitor-config', 'page'),
  r('fetch', 'GET', 'public/visitor/challenge', 'page'),
  r('fetch', 'POST', 'public/visitor/start', 'page'),
  r('fetch', 'POST', 'public/visitor/track', 'page'),
  r('fetch', 'GET', 'public/unclaimed/challenge', 'page'),
  r('fetch', 'GET', 'visitor/me', 'page'),
  r('fetch', 'GET', 'visitor/comments', 'page'),
  r('fetch', 'POST', 'visitor/comments', 'page'),
  r('fetch', 'PUT', 'visitor/comments/{}', 'page'),
  r('fetch', 'DELETE', 'visitor/comments/{}', 'page'),
  r('fetch', 'POST', 'visitor/comments/{}/replies', 'page'),
  r('upload', 'POST', 'public/unclaimed/comments', 'page'),
];

/** The route a proxied request matches (kind, method and URL path; the query is not part of the match), or null. */
export function matchProxyRoute(kind: 'fetch' | 'upload', method: string, pathname: string, body: string | null = null): ProxyRoute | null {
  const m = (method || '').toUpperCase();
  const route = PROXY_ROUTES.find((x) => x.kind === kind && x.method === m && x.path.test(pathname));
  if (!route) return null;
  if (route.body && !route.body(body)) return null;
  return route;
}

/** The page's own Authorization header for a `page` route: a well-formed Bearer that is not the placeholder, else null. */
export function pageAuthorization(pageAuth: string | null | undefined): string | null {
  const v = proxyAuthorization(null, pageAuth);
  return v && v !== `Bearer ${PROXY_PLACEHOLDER}` ? v : null;
}

/**
 * The Authorization header a matched request carries, or `undefined` when it must be refused.
 * `extension` routes: the extension's token, else the page's own header (unchanged behaviour). `page` routes: only the
 * page's own header; a `needsPageAuth` route without one is refused.
 */
export function routeAuthorization(route: ProxyRoute, extToken: string | null, pageAuth: string | null | undefined): string | null | undefined {
  if (route.mode === 'extension') return proxyAuthorization(extToken, pageAuth);
  const own = pageAuthorization(pageAuth);
  if (!own && route.needsPageAuth) return undefined;
  return own;
}

// Keys whose values are credentials, whatever their content.
const CREDENTIAL_KEYS = new Set([
  'token', 'accesstoken', 'refreshtoken', 'selectiontoken', 'idtoken', 'jwt', 'apikey', 'apikeys',
  'secret', 'clientsecret', 'password', 'passwordhash',
]);
// A JWT (header and payload are base64url JSON objects, so both start `eyJ`).
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}/g;

function strip(v: unknown): unknown {
  // Decoded strings: a JWT written with JSON escapes (`\u0065yJ…`) only shows its shape after parsing.
  if (typeof v === 'string') return v.replace(JWT_RE, '[redacted]');
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // `token` is also a mention's display text (`#12`, `@Anna`): drop it only when it is not one.
      if (k.toLowerCase() === 'token' && typeof x === 'string' && /^[#@]/.test(x)) { out[k] = strip(x); continue; }
      if (CREDENTIAL_KEYS.has(k.toLowerCase())) continue;
      out[k] = strip(x);
    }
    return out;
  }
  return v;
}

/**
 * Defence in depth for `extension` routes (the allowlist is the fix): removes credential fields from a JSON body and
 * any JWT-shaped string from any body. A body that is not JSON only gets the JWT pass.
 */
export function redactCredentials(body: string, route?: Pick<ProxyRoute, 'minimalResponse'>, ok = true): string {
  if (route?.minimalResponse && ok) return '{"success":true}';
  const text = body.replace(JWT_RE, '[redacted]');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return text; }
  if (!parsed || typeof parsed !== 'object') return text;
  return JSON.stringify(strip(parsed));
}
