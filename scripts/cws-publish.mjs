#!/usr/bin/env node
// Upload a built extension zip to the Chrome Web Store and, with --submit, submit it for review.
//
//   node scripts/cws-publish.mjs <zip> [--submit] [--dry-run]
//
// Chrome Web Store API v2 (current as of 2026-10; v1 archived October 2025):
//   upload:  POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{itemId}:upload
//   status:  GET  https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{itemId}:fetchStatus
//   publish: POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{itemId}:publish
//   https://developer.chrome.com/docs/webstore/using-api
//   https://developer.chrome.com/docs/webstore/api/reference/rest
// Package validation can be asynchronous: after an upload that reports state IN_PROGRESS, this
// script polls fetchStatus every 5 s for up to 5 minutes and acts on `lastAsyncUploadState`
// (enum UploadState: SUCCEEDED / IN_PROGRESS / FAILED / NOT_FOUND / UPLOAD_STATE_UNSPECIFIED).
//
// Ids: env CWS_ITEM_ID / CWS_PUBLISHER_ID override scripts/cws.config.json (ids are not secret).
// Credentials: macOS Keychain service "pinsay-cws" (client_id, client_secret, refresh_token —
// set up once with scripts/cws-auth.mjs). Tokens and secrets are never printed; on HTTP errors
// only the status code and Google's error message are shown. --dry-run makes no remote calls.

import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const SERVICE = 'pinsay-cws';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://chromewebstore.googleapis.com';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

const die = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google's error details from a JSON response, if any are present (never a token or header).
function responseErrorDetail(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.error_description === 'string' && data.error_description) return data.error_description;
  if (typeof data.error === 'string' && data.error) return data.error;
  if (data.error && typeof data.error.message === 'string' && data.error.message) return data.error.message;
  return null;
}

function dieUploadFailed(source) {
  const detail = responseErrorDetail(source);
  die(
    `error: the Chrome Web Store rejected the package (upload state FAILED)${detail ? `: ${detail}` : ''}. ` +
      'Check the Developer Dashboard (https://chrome.google.com/webstore/devconsole/) for validation details.',
  );
}

async function keychainGet(account) {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// Minimal zip reader: enough to pull one small root entry (manifest.json) out of the store zip.
// Handles the stored/deflate methods a `zip -qr dist .` archive produces; no zip64.
function zipEntry(zipBuf, entryName) {
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

function zipManifestVersion(zipPath) {
  let raw;
  try {
    raw = zipEntry(readFileSync(zipPath), 'manifest.json');
  } catch (e) {
    die(`error: cannot read ${basename(zipPath)}: ${e.message}.`);
  }
  if (raw === null) {
    die(`error: ${basename(zipPath)} has no manifest.json at its root — build the zip from dist/ (see README).`);
  }
  try {
    const version = JSON.parse(raw).version;
    if (typeof version === 'string' && version.length > 0) return version;
  } catch {}
  die(`error: manifest.json inside ${basename(zipPath)} has no valid version.`);
}

async function accessToken(clientId, clientSecret, refreshToken) {
  let res;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    die(`error: token refresh failed: ${e && e.message ? e.message : 'network error'}.`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok || !data || !data.access_token) {
    const err = data && data.error;
    const reason =
      (data && data.error_description) ||
      (typeof err === 'string' ? err : err && err.message) ||
      'no error message from Google';
    die(`error: token refresh failed (HTTP ${res.status}): ${reason}. Run npm run cws:auth to sign in again.`);
  }
  return data.access_token;
}

async function callApi(url, token, body, label, method = 'POST') {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'GET'
          ? {}
          : { 'Content-Type': body ? 'application/octet-stream' : 'application/json' }),
      },
      body: method === 'GET' ? undefined : (body ?? '{}'),
      signal: AbortSignal.timeout(10 * 60_000),
    });
  } catch (e) {
    die(`error: ${label} failed: ${e && e.message ? e.message : 'network error'}.`);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      const err = parsed && parsed.error;
      message = parsed?.error_description || (typeof err === 'string' ? err : err?.message) || text;
    } catch {}
    die(`error: ${label} failed (HTTP ${res.status}): ${message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return die(`error: ${label} returned a non-JSON response.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const submit = args.includes('--submit');
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length !== 1) {
    console.error('Usage: npm run cws:publish -- <zip> [--submit] [--dry-run]');
    process.exit(2);
  }
  const zipPath = resolve(positional[0]);
  if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
    die(`error: zip not found: ${zipPath} — build it first (npm run build, then zip dist/ per README).`);
  }

  let config = {};
  try {
    config = JSON.parse(readFileSync(resolve(here, 'cws.config.json'), 'utf8'));
  } catch {}
  const itemId = process.env.CWS_ITEM_ID || config.itemId || '';
  const publisherId = process.env.CWS_PUBLISHER_ID || config.publisherId || '';
  const missingIds = [!itemId && 'CWS_ITEM_ID', !publisherId && 'CWS_PUBLISHER_ID'].filter(Boolean);
  if (missingIds.length > 0) {
    die(`error: missing ${missingIds.join(' and ')} — set the env vars or fill scripts/cws.config.json.`);
  }
  const idSource =
    process.env.CWS_ITEM_ID || process.env.CWS_PUBLISHER_ID
      ? 'env CWS_ITEM_ID/CWS_PUBLISHER_ID'
      : 'scripts/cws.config.json';

  // The store only accepts a version higher than the published one, and the zip must be built
  // from what this folder declares: compare zip manifest.json against the folder's manifest.json.
  const zipVersion = zipManifestVersion(zipPath);
  let folderVersion;
  try {
    folderVersion = JSON.parse(readFileSync(resolve(here, '..', 'manifest.json'), 'utf8')).version;
  } catch {
    die('error: cannot read manifest.json next to scripts/ — run from extension/.');
  }
  if (zipVersion !== folderVersion) {
    die(`error: zip manifest version ${zipVersion} != extension manifest.json version ${folderVersion} — rebuild the zip (see README).`);
  }

  const clientId = await keychainGet('client_id');
  const clientSecret = await keychainGet('client_secret');
  const refreshToken = await keychainGet('refresh_token');

  if (dryRun) {
    const missingKeys = [
      !clientId && 'client_id',
      !clientSecret && 'client_secret',
      !refreshToken && 'refresh_token',
    ].filter(Boolean);
    if (missingKeys.length > 0) {
      die(`error: Keychain service "${SERVICE}" is missing ${missingKeys.join(', ')} — run npm run cws:auth (client_id/client_secret setup: docs/RELEASING.md in the PinSay monorepo).`);
    }
    console.log('dry-run OK — no remote calls made.');
    console.log(`  ids:      item ${itemId}, publisher ${publisherId} (${idSource})`);
    console.log(`  zip:      ${basename(zipPath)} (${statSync(zipPath).size} bytes), manifest version ${zipVersion} == extension manifest.json`);
    console.log(`  keychain: "${SERVICE}" has client_id, client_secret, refresh_token`);
    process.exit(0);
  }

  if (!clientId || !clientSecret || !refreshToken) {
    die(`error: Keychain service "${SERVICE}" is incomplete (needs client_id, client_secret, refresh_token) — run npm run cws:auth.`);
  }

  const token = await accessToken(clientId, clientSecret, refreshToken);
  console.log(`Uploading ${basename(zipPath)} (${statSync(zipPath).size} bytes) → items/${itemId}`);
  const upload = await callApi(
    `${API_BASE}/upload/v2/publishers/${publisherId}/items/${itemId}:upload`,
    token,
    readFileSync(zipPath),
    'upload',
  );
  let uploadState = upload.uploadState || 'UPLOAD_STATE_UNSPECIFIED';
  console.log(`Upload state: ${uploadState}${upload.crxVersion ? ` (version ${upload.crxVersion})` : ''}`);
  if (uploadState === 'FAILED') {
    dieUploadFailed(upload);
  }

  // Package validation can be asynchronous: poll fetchStatus (empty body on GET) until
  // lastAsyncUploadState leaves IN_PROGRESS, every 5 s for up to 5 minutes.
  let lastStatus = null;
  if (uploadState === 'IN_PROGRESS') {
    console.log(
      `Google is still validating the package — polling fetchStatus every ${POLL_INTERVAL_MS / 1000} s for up to ${POLL_TIMEOUT_MS / 60_000} minutes…`,
    );
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (uploadState === 'IN_PROGRESS' && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      lastStatus = await callApi(
        `${API_BASE}/v2/publishers/${publisherId}/items/${itemId}:fetchStatus`,
        token,
        null,
        'fetch status',
        'GET',
      );
      if (lastStatus.lastAsyncUploadState) {
        uploadState = lastStatus.lastAsyncUploadState;
        console.log(`Upload state: ${uploadState}`);
      }
    }
    if (uploadState === 'IN_PROGRESS') {
      die(
        `error: upload still IN_PROGRESS after ${POLL_TIMEOUT_MS / 60_000} minutes of polling — ` +
          'check the Chrome Web Store Developer Dashboard (https://chrome.google.com/webstore/devconsole/) ' +
          'for the upload outcome before doing anything else.',
      );
    }
  }

  if (uploadState === 'FAILED') {
    dieUploadFailed(lastStatus || upload);
  }
  if (uploadState !== 'SUCCEEDED') {
    die(`error: upload did not succeed (state: ${uploadState}) — check the Chrome Web Store Developer Dashboard.`);
  }

  if (submit) {
    const published = await callApi(
      `${API_BASE}/v2/publishers/${publisherId}/items/${itemId}:publish`,
      token,
      null,
      'publish',
    );
    console.log(`Submitted for review — item state: ${published.state || 'UNKNOWN'}`);
    const warnings = published.warningInfo && published.warningInfo.warnings;
    if (warnings && warnings.length > 0) {
      for (const warning of warnings) console.log(`  warning: ${warning.reason}: ${warning.description}`);
    }
  }
}

main().catch((e) => die(e && e.message ? e.message : 'Unexpected failure.'));
