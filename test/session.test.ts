import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenExpired, tokenExpiryMs, EXPIRY_SKEW_MS } from '../src/session.ts';
import { proxyAuthorization } from '../src/visitor.ts';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
const now = Date.UTC(2026, 9, 29, 8, 0, 0);

test('a token past its exp is expired', () => {
  assert.equal(tokenExpired(jwt({ exp: now / 1000 - 3600 }), now), true);
});

test('a token inside the skew window counts as expired', () => {
  assert.equal(tokenExpired(jwt({ exp: (now + EXPIRY_SKEW_MS - 1000) / 1000 }), now), true);
});

test('a live token is not expired', () => {
  assert.equal(tokenExpired(jwt({ exp: now / 1000 + 12 * 3600 }), now), false);
});

test('unreadable tokens or no exp are left to the server', () => {
  assert.equal(tokenExpired('not-a-jwt', now), false);
  assert.equal(tokenExpired('a.%%%.c', now), false);
  assert.equal(tokenExpired(jwt({ sub: '1' }), now), false);
  assert.equal(tokenExpiryMs(jwt({ exp: 'soon' })), null);
});

test('base64url payloads with - and _ decode', () => {
  const t = jwt({ exp: now / 1000 + 60, name: '??>>~~' });
  assert.equal(tokenExpiryMs(t), (now / 1000 + 60) * 1000);
});

// The 2026-10-29 loop: the extension kept a 12-hour token past its exp and the proxy put it over the token the
// widget had just signed in with. Once getToken() drops the expired token, the widget's own header goes through.
test('with the expired extension token dropped, the widget sign-in is forwarded', () => {
  const extToken = jwt({ exp: now / 1000 - 60 });
  const widget = 'Bearer ' + jwt({ exp: now / 1000 + 3600 });
  assert.equal(proxyAuthorization(extToken, widget), `Bearer ${extToken}`); // before: the dead token wins
  const kept = tokenExpired(extToken, now) ? null : extToken;
  assert.equal(proxyAuthorization(kept, widget), widget);
});
