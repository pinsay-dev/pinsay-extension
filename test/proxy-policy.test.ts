// SEC-BUG-01: page scripts share the MAIN world with the widget, so the background proxies only the widget's own
// routes, never puts the extension's token on account/session routes, and strips credentials from what it returns.
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProxyRoute, routeAuthorization, redactCredentials, pageAuthorization, PROXY_PLACEHOLDER } from '../src/proxy-policy.ts';

// Fake JWTs built at runtime (base64url header.payload.signature), so the source holds no JWT-shaped literal.
const fakeJwt = (payload: object, signature: string) =>
  [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'), signature].join('.');
const EXT = fakeJwt({ sub: 'ext-user' }, 'ext-signature-abcdef');
const PLACEHOLDER = `Bearer ${PROXY_PLACEHOLDER}`;
const OWN = `Bearer ${fakeJwt({ sub: 'own' }, 'own-signature-abcdef')}`;

/** What the background does with a bridge `fetch` message: 'refused', or the Authorization it sends (null = none). */
function decide(method: string, path: string, pageAuth: string | null, extToken: string | null = EXT, body: string | null = null) {
  const route = matchProxyRoute('fetch', method, path, body);
  if (!route) return 'refused';
  const auth = routeAuthorization(route, route.mode === 'extension' ? extToken : null, pageAuth);
  return auth === undefined ? 'refused' : auth;
}

test('GET /api/auth/me with the widget placeholder is refused (no extension token)', () => {
  assert.equal(decide('GET', '/api/auth/me', PLACEHOLDER), 'refused');
  assert.equal(decide('GET', '/api/auth/me', null), 'refused');
});

test('POST /api/auth/switch-workspace never gets the extension token', () => {
  assert.equal(decide('POST', '/api/auth/switch-workspace', PLACEHOLDER), 'refused');
  assert.equal(decide('POST', '/api/auth/switch-workspace', null), 'refused');
  // The widget's own workspace picker sends its own selection token: forwarded as is, never swapped for ours.
  assert.equal(decide('POST', '/api/auth/switch-workspace', OWN), OWN);
});

test('account, key, member, billing and settings routes are refused', () => {
  for (const [m, path] of [
    ['GET', '/api/auth/workspaces'], ['POST', '/api/auth/refresh'], ['POST', '/api/auth/logout'],
    ['GET', '/api/keys'], ['POST', '/api/keys'], ['DELETE', '/api/keys/1'],
    ['GET', '/api/members'], ['POST', '/api/workspace/members/invite'], ['GET', '/api/billing'],
    ['POST', '/api/billing/checkout'], ['GET', '/api/me'], ['PATCH', '/api/me'], ['GET', '/api/me/preferences'],
    ['GET', '/api/admin/projects'], ['DELETE', '/api/admin/projects/5'], ['GET', '/api/admin/projects/5'],
    ['GET', '/api/projects'], ['DELETE', '/api/projects/web'], ['POST', '/api/share-links'],
  ] as const) {
    assert.equal(decide(m, path, PLACEHOLDER), 'refused', `${m} ${path}`);
  }
});

test('the widget routes carry the extension token', () => {
  for (const [m, path] of [
    ['GET', '/api/projects/web/comments'], ['POST', '/api/projects/web/comments'],
    ['GET', '/api/projects/web/capture-config'], ['GET', '/api/projects/web/predefined-actions'],
    ['POST', '/api/projects/web/builds'], ['GET', '/api/projects/web/mentions/search'],
    ['GET', '/api/comments/12'], ['PATCH', '/api/comments/12'], ['PUT', '/api/comments/12'], ['DELETE', '/api/comments/12'],
    ['POST', '/api/comments/12/replies'], ['POST', '/api/comments/12/verify'], ['PATCH', '/api/comments/12/visibility'],
    ['PATCH', '/api/comments/12/fields'], ['PUT', '/api/replies/3'], ['DELETE', '/api/replies/3'],
    ['POST', '/api/events'], ['GET', '/api/statuses'], ['GET', '/api/branding'],
    ['GET', '/api/figma-drafts/abc_DEF-1'], ['GET', '/api/public/projects/web/widget-status'],
  ] as const) {
    assert.equal(decide(m, path, PLACEHOLDER), `Bearer ${EXT}`, `${m} ${path}`);
  }
  assert.equal(matchProxyRoute('upload', 'post', '/api/uploads')?.mode, 'extension');
});

test('wrong method on a widget path is refused', () => {
  assert.equal(decide('DELETE', '/api/projects/web/comments', PLACEHOLDER), 'refused');
  assert.equal(decide('POST', '/api/comments/12', PLACEHOLDER), 'refused');
  assert.equal(decide('OPTIONS', '/api/statuses', PLACEHOLDER), 'refused');
  assert.equal(matchProxyRoute('upload', 'POST', '/api/keys'), null);
  assert.equal(matchProxyRoute('fetch', 'POST', '/api/uploads'), null);
});

test('encoded or dotted segments cannot step out of a widget route', () => {
  assert.equal(decide('GET', '/api/comments/..%2Fauth%2Fme', PLACEHOLDER), 'refused');
  assert.equal(decide('GET', '/api/comments/%2e%2e', PLACEHOLDER), 'refused');
  assert.equal(decide('GET', '/api/comments/12/../../auth/me', PLACEHOLDER), 'refused');
  assert.equal(decide('GET', '/api/projects/web/comments/extra', PLACEHOLDER), 'refused');
  assert.equal(decide('GET', '/api/statuses/', PLACEHOLDER), 'refused');
});

test('admin project PATCH passes only the commit-style body', () => {
  assert.equal(decide('PATCH', '/api/admin/projects/7', PLACEHOLDER, EXT, '{"commitStyle":2}'), `Bearer ${EXT}`);
  assert.equal(decide('PATCH', '/api/admin/projects/7', PLACEHOLDER, EXT, '{"commitStyle":2,"allowedOrigins":["*"]}'), 'refused');
  assert.equal(decide('PATCH', '/api/admin/projects/7', PLACEHOLDER, EXT, '{"commitStyle":3}'), 'refused');
  assert.equal(decide('PATCH', '/api/admin/projects/7', PLACEHOLDER, EXT, null), 'refused');
  assert.equal(decide('PATCH', '/api/admin/projects/web', PLACEHOLDER, EXT, '{"commitStyle":1}'), 'refused');
});

test('sign-in, visitor and public routes use only the page\'s own header', () => {
  assert.equal(decide('POST', '/api/auth/login', PLACEHOLDER), null);
  assert.equal(decide('POST', '/api/auth/magic/verify', null), null);
  assert.equal(decide('POST', '/api/auth/mfa/verify', OWN), OWN);
  assert.equal(decide('GET', '/api/visitor/comments', OWN), OWN);
  assert.equal(decide('POST', '/api/public/visitor/start', PLACEHOLDER), null);
  assert.equal(matchProxyRoute('upload', 'POST', '/api/public/unclaimed/comments')?.mode, 'page');
  assert.equal(pageAuthorization(PLACEHOLDER), null);
  assert.equal(pageAuthorization('Basic abc'), null);
});

test('with no extension token, widget routes forward the page\'s own sign-in (unchanged)', () => {
  assert.equal(decide('GET', '/api/projects/web/comments', OWN, null), OWN);
});

test('credential fields and JWTs are stripped from widget-route responses', () => {
  const body = JSON.stringify({
    success: true,
    data: {
      token: EXT, accessToken: 'opaque', refreshToken: 'r', selectionToken: 's', apiKey: 'k', user: { id: 'u1', jwt: 'j' },
      body: `see ${EXT} here`,
      mentions: [{ kind: 'comment', token: '#12', commentId: 7 }, { kind: 'user', token: '@Anna' }],
    },
  });
  const out = JSON.parse(redactCredentials(body));
  assert.deepEqual(out, {
    success: true,
    data: {
      user: { id: 'u1' },
      body: 'see [redacted] here',
      mentions: [{ kind: 'comment', token: '#12', commentId: 7 }, { kind: 'user', token: '@Anna' }],
    },
  });
  assert.equal(redactCredentials(`error ${EXT}`), 'error [redacted]');
  assert.equal(redactCredentials('plain text'), 'plain text');
});

test('PATCH /api/me/preferences passes only the shortcut body', () => {
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, '{"addCommentShortcut":"Alt+C"}'), `Bearer ${EXT}`);
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, '{"addCommentShortcut":""}'), `Bearer ${EXT}`);
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, '{}'), 'refused');
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, null), 'refused');
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, '{"addCommentShortcut":"Alt+C","language":"ar"}'), 'refused');
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, '{"emailOnMention":false}'), 'refused');
  assert.equal(decide('PATCH', '/api/me/preferences', PLACEHOLDER, EXT, '{"addCommentShortcut":1}'), 'refused');
});

test('settings routes answer only {"success":true}: the profile never reaches the page', () => {
  const profile = JSON.stringify({ success: true, data: { id: 'u1', email: 'a@b.c', role: 'Owner', permissions: ['x'] } });
  const prefs = matchProxyRoute('fetch', 'PATCH', '/api/me/preferences', '{"addCommentShortcut":"Alt+C"}')!;
  assert.equal(redactCredentials(profile, prefs, true), '{"success":true}');
  const admin = matchProxyRoute('fetch', 'PATCH', '/api/admin/projects/7', '{"commitStyle":1}')!;
  assert.equal(redactCredentials(profile, admin, true), '{"success":true}');
  // A failed call keeps its (redacted) error body so the widget can show it.
  assert.equal(redactCredentials('{"success":false,"message":"nope"}', prefs, false), '{"success":false,"message":"nope"}');
});

test('a JWT written with JSON escapes is redacted after decoding', () => {
  const escaped = EXT.replace(/^e/, '\\u0065');
  const body = `{"success":true,"data":{"message":"${escaped}","mentions":[{"kind":"user","token":"@${escaped}"}]}}`;
  const out = JSON.parse(redactCredentials(body));
  assert.equal(out.data.message, '[redacted]');
  assert.equal(out.data.mentions[0].token, '@[redacted]');
});
