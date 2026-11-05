// Pure helpers for scripts/publish.mjs (no network, no filesystem, no secrets) — tested by
// test/publish.test.ts.

import { createHmac, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const AMO_BASE = 'https://addons.mozilla.org/api/v5';
export const EDGE_BASE = 'https://api.addons.microsoftedge.microsoft.com/v1';
export const ADDON_GUID = 'pinsay@pinsay.dev';
export const AMO_JWT_TTL_S = 60;

// -1 / 0 / 1, dot-separated numeric parts (missing parts count as 0): "0.10.0" > "0.9.0".
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10));
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isNaN(pa[i]) ? 0 : pa[i] ?? 0;
    const y = Number.isNaN(pb[i]) ? 0 : pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// The already-live guard against scripts/published.json: refuse when the version is ≤ the
// recorded one for the store (recorded null/undefined = nothing published yet).
export function liveGuard(recorded, version) {
  if (recorded == null) return { ok: true };
  if (compareVersions(version, recorded) > 0) return { ok: true };
  return {
    ok: false,
    reason: `version ${version} is already live or lower than the recorded ${recorded} (scripts/published.json) — bump manifest.json first.`,
  };
}

// AMO API v5 auth: HS256 JWT, iss = jwt-issuer, jti = random hex, iat = now, exp = now + 60 s —
// a fresh token per request. https://addons-server.readthedocs.io/en/latest/topics/api/auth.html
export function amoJwt(secret, issuer, nowMs = Date.now()) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const iat = Math.floor(nowMs / 1000);
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const payload = enc({ iss: issuer, jti: randomBytes(12).toString('hex'), iat, exp: iat + AMO_JWT_TTL_S });
  const data = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export const amoUploadUrl = () => `${AMO_BASE}/addons/upload/`;
export const amoUploadDetailUrl = (uuid) => `${AMO_BASE}/addons/upload/${uuid}/`;
export const amoAddonUrl = () => `${AMO_BASE}/addons/addon/${ADDON_GUID}/`;
export const amoAddonCreateUrl = () => `${AMO_BASE}/addons/addon/`;
export const amoVersionCreateUrl = () => `${AMO_BASE}/addons/addon/${ADDON_GUID}/versions/`;
// AMO accepts the version number with a `v` prefix wherever a version id is expected.
export const amoVersionDetailUrl = (version) => `${AMO_BASE}/addons/addon/${ADDON_GUID}/versions/v${version}/`;
export const amoVersionSourceUrl = (versionId) => `${AMO_BASE}/addons/addon/${ADDON_GUID}/versions/${versionId}/`;

export const edgePackageUploadUrl = (productId) => `${EDGE_BASE}/products/${productId}/submissions/draft/package`;
export const edgePackageOperationUrl = (productId, opId) =>
  `${EDGE_BASE}/products/${productId}/submissions/draft/package/operations/${opId}`;
export const edgeSubmitUrl = (productId) => `${EDGE_BASE}/products/${productId}/submissions`;
export const edgeSubmitOperationUrl = (productId, opId) =>
  `${EDGE_BASE}/products/${productId}/submissions/operations/${opId}`;

// The upload/publish responses point at their operation via the Location header (a URL or a bare
// id) — the operation id is its last path segment either way.
export function edgeOperationIdFromLocation(location) {
  const path = location.startsWith('/') || location.includes('://') ? new URL(location, EDGE_BASE).pathname : location;
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

// Minimal zip reader: enough to pull one small root entry (manifest.json) out of a store zip.
// Same algorithm as scripts/cws-publish.mjs (kept in step with it; cws-publish must not be edited).
// Handles the stored/deflate methods a `zip -qr dist .` archive produces; no zip64.
export function zipEntry(zipBuf, entryName) {
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= 0 && i >= zipBuf.length - 22 - 0xffff; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip archive (no end-of-central-directory record)');
  const entryCount = zipBuf.readUInt16LE(eocd + 10);
  let p = zipBuf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > zipBuf.length || zipBuf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('corrupt zip central directory');
    }
    const method = zipBuf.readUInt16LE(p + 10);
    const compressedSize = zipBuf.readUInt32LE(p + 20);
    const nameLen = zipBuf.readUInt16LE(p + 28);
    const extraLen = zipBuf.readUInt16LE(p + 30);
    const commentLen = zipBuf.readUInt16LE(p + 32);
    const localOffset = zipBuf.readUInt32LE(p + 42);
    const name = zipBuf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      if (localOffset + 30 > zipBuf.length || zipBuf.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error('corrupt zip local header');
      }
      const localNameLen = zipBuf.readUInt16LE(localOffset + 26);
      const localExtraLen = zipBuf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = zipBuf.subarray(start, start + compressedSize);
      return (method === 0 ? compressed : inflateRawSync(compressed)).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export function zipManifestVersion(zipBuf) {
  const raw = zipEntry(zipBuf, 'manifest.json');
  if (raw === null) return null;
  const version = JSON.parse(raw).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('manifest.json inside the zip has no valid version');
  }
  return version;
}
