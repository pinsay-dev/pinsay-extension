import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  ADDON_GUID,
  AMO_BASE,
  EDGE_BASE,
  amoAddonCreateUrl,
  amoAddonUrl,
  amoJwt,
  amoUploadDetailUrl,
  amoUploadUrl,
  amoVersionCreateUrl,
  amoVersionDetailUrl,
  amoVersionSourceUrl,
  compareVersions,
  edgeOperationIdFromLocation,
  edgePackageOperationUrl,
  edgePackageUploadUrl,
  edgeSubmitOperationUrl,
  edgeSubmitUrl,
  liveGuard,
} from '../scripts/publish-lib.mjs';

test('compareVersions compares numeric parts', () => {
  assert.equal(compareVersions('0.4.1', '0.4.1'), 0);
  assert.equal(compareVersions('0.5.0', '0.4.1'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.1'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1); // numeric, not lexicographic
  assert.equal(compareVersions('1.0', '1.0.0'), 0); // missing parts count as 0
  assert.equal(compareVersions('1.0.1', '1.0'), 1);
});

test('liveGuard refuses a version that is <= the recorded one', () => {
  assert.deepEqual(liveGuard(null, '0.5.0'), { ok: true });
  assert.deepEqual(liveGuard(undefined, '0.5.0'), { ok: true });
  assert.deepEqual(liveGuard('0.4.1', '0.5.0'), { ok: true });
  assert.equal(liveGuard('0.4.1', '0.4.1').ok, false); // equal = already live
  assert.equal(liveGuard('0.5.0', '0.4.9').ok, false);
  assert.match(liveGuard('0.4.1', '0.4.1').reason ?? '', /scripts\/published\.json/);
});

function decodePart(part: string): any {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

test('amoJwt builds a fresh HS256 token per call (iss, jti, 60 s ttl)', () => {
  const secret = 'test-secret';
  const token = amoJwt(secret, 'user:123', Date.parse('2026-10-10T12:00:00Z'));
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  assert.equal(token.split('.').length, 3);

  const header = decodePart(headerPart);
  assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });

  const payload = decodePart(payloadPart);
  assert.equal(payload.iss, 'user:123');
  assert.equal(payload.exp - payload.iat, 60);
  assert.equal(Math.floor(Date.parse('2026-10-10T12:00:00Z') / 1000), payload.iat);
  assert.match(payload.jti, /^[0-9a-f]+$/);

  // The signature is HS256 over "header.payload" with the secret.
  const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  assert.equal(signaturePart, expected);

  // A second token differs (fresh jti) but keeps the same claims shape.
  const second = amoJwt(secret, 'user:123', Date.parse('2026-10-10T12:00:00Z'));
  assert.notEqual(second, token);
  assert.deepEqual(decodePart(second.split('.')[1]).iat, payload.iat);
});

test('AMO url builders', () => {
  assert.equal(AMO_BASE, 'https://addons.mozilla.org/api/v5');
  assert.equal(ADDON_GUID, 'pinsay@pinsay.dev');
  assert.equal(amoUploadUrl(), 'https://addons.mozilla.org/api/v5/addons/upload/');
  assert.equal(amoUploadDetailUrl('abc-123'), 'https://addons.mozilla.org/api/v5/addons/upload/abc-123/');
  assert.equal(amoAddonUrl(), 'https://addons.mozilla.org/api/v5/addons/addon/pinsay@pinsay.dev/');
  assert.equal(amoAddonCreateUrl(), 'https://addons.mozilla.org/api/v5/addons/addon/');
  assert.equal(amoVersionCreateUrl(), 'https://addons.mozilla.org/api/v5/addons/addon/pinsay@pinsay.dev/versions/');
  assert.equal(amoVersionDetailUrl('0.5.1'), 'https://addons.mozilla.org/api/v5/addons/addon/pinsay@pinsay.dev/versions/v0.5.1/');
  assert.equal(amoVersionSourceUrl(42), 'https://addons.mozilla.org/api/v5/addons/addon/pinsay@pinsay.dev/versions/42/');
});

test('Edge url builders and operation-id parsing', () => {
  const productId = 'prod-1';
  assert.equal(EDGE_BASE, 'https://api.addons.microsoftedge.microsoft.com/v1');
  assert.equal(edgePackageUploadUrl(productId), 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-1/submissions/draft/package');
  assert.equal(
    edgePackageOperationUrl(productId, 'op-9'),
    'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-1/submissions/draft/package/operations/op-9',
  );
  assert.equal(edgeSubmitUrl(productId), 'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-1/submissions');
  assert.equal(
    edgeSubmitOperationUrl(productId, 'op-9'),
    'https://api.addons.microsoftedge.microsoft.com/v1/products/prod-1/submissions/operations/op-9',
  );
  // The Location header may be an operation URL or a bare id — the id is the last segment.
  assert.equal(edgeOperationIdFromLocation('/v1/products/prod-1/submissions/draft/package/operations/op-9'), 'op-9');
  assert.equal(
    edgeOperationIdFromLocation('https://api.addons.microsoftedge.microsoft.com/v1/products/prod-1/submissions/operations/op-9'),
    'op-9',
  );
  assert.equal(edgeOperationIdFromLocation('op-9'), 'op-9');
});
