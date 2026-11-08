#!/usr/bin/env node
// Publish the packaged extension to all three stores with one command, and, with --submit,
// submit it for review.
//
//   npm run publish -- --target chrome|edge|firefox|all [--submit] [--dry-run]
//
// --target all runs chrome, then firefox, then edge; a failure in one target stops the run and
// says which targets were done. Zips come from `npm run package` (scripts/package.mjs):
// pinsay-ext-<target>-<version>.zip plus pinsay-ext-source-<version>.zip for Firefox.
//
// Credentials: macOS Keychain only, never the repo, never printed.
//   chrome:  service "pinsay-cws"  (client_id, client_secret, refresh_token — see scripts/cws-auth.mjs)
//   firefox: service "pinsay-amo"  (jwt-issuer, jwt-secret — AMO API keys)
//   edge:    service "pinsay-edge" (client-id, api-key, product-id — Partner Center)
//
// Already-live guard (every store): refuses a version ≤ the recorded one in scripts/published.json
// (committed; updated after each successful --submit — the run then prints "commit
// scripts/published.json"), plus remote checks where the API allows. --dry-run makes no remote
// calls. Submissions happen only under the CEO's standing approval (devops runs it).
//
// APIs (current as of 2026-10):
//   chrome:  Chrome Web Store API v2, delegated to scripts/cws-publish.mjs (unchanged)
//   firefox: AMO API v5, https://addons-server.readthedocs.io/en/latest/topics/api/
//   edge:    Edge Add-ons API v1.1,
//            https://learn.microsoft.com/microsoft-edge/extensions/publish/api/using-addons-api

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  amoAddonCreateUrl,
  amoAddonUrl,
  amoJwt,
  amoUploadDetailUrl,
  amoUploadUrl,
  amoVersionCreateUrl,
  amoVersionDetailUrl,
  amoVersionSourceUrl,
  edgeOperationIdFromLocation,
  edgePackageOperationUrl,
  edgePackageUploadUrl,
  edgeSubmitOperationUrl,
  edgeSubmitUrl,
  liveGuard,
  zipManifestVersion,
} from './publish-lib.mjs';

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(here, '..');
// --target all order, per the task.
const ORDER = ['chrome', 'firefox', 'edge'];
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10 * 60_000;
// The Firefox short description, from brand/store-listings/browser-extension/STORE_LISTING.md § Firefox Add-ons (P2-T11).
const AMO_SUMMARY =
  'Click any element on a running web app, leave a comment, and your AI agent applies it to the real source.';

const die = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A child whose output goes straight through (the task's "inherit stdio"): its errors and
// dry-run details are printed by the child itself; only its exit code comes back.
function runInherited(cmd, args, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', (e) => rejectPromise(new Error(`${label}: ${e.message}.`)));
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${label} failed (exit ${code}).`));
    });
  });
}

const KEYCHAIN = {
  chrome: { service: 'pinsay-cws', accounts: ['client_id', 'client_secret', 'refresh_token'] },
  firefox: { service: 'pinsay-amo', accounts: ['jwt-issuer', 'jwt-secret'] },
  edge: { service: 'pinsay-edge', accounts: ['client-id', 'api-key', 'product-id'] },
};

async function keychainGet(service, account) {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// Missing Keychain entries for one target: the Edge wording is the task's set-up message; the
// others name the missing accounts (never their values).
function keychainFailure(target, missing) {
  if (target === 'edge') {
    return 'Edge is not set up yet (Partner Center, see SPEC "What the CEO must do once")';
  }
  if (target === 'chrome') {
    return `Keychain service "${KEYCHAIN.chrome.service}" is missing ${missing.join(', ')} — run npm run cws:auth.`;
  }
  return `Keychain service "${KEYCHAIN.firefox.service}" is missing ${missing.join(', ')} — add them once with security add-generic-password (docs/RELEASING.md in the PinSay monorepo).`;
}

async function checkKeychain(target) {
  const { service, accounts } = KEYCHAIN[target];
  const missing = [];
  for (const account of accounts) {
    if (!(await keychainGet(service, account))) missing.push(account);
  }
  if (missing.length > 0) throw new Error(keychainFailure(target, missing));
}

function readPublished() {
  try {
    return JSON.parse(readFileSync(resolve(here, 'published.json'), 'utf8'));
  } catch {
    die('error: cannot read scripts/published.json — it must exist (a committed file with the last submitted version per store).');
  }
}

function recordPublished(target, version) {
  const published = readPublished();
  published[target] = version;
  writeFileSync(resolve(here, 'published.json'), `${JSON.stringify(published, null, 2)}\n`);
  console.log(`Recorded ${target} ${version} in scripts/published.json — commit scripts/published.json.`);
}

// The zips npm run package writes, per target (firefox also carries the AMO source archive).
function zipPaths(target, version) {
  const zips = [`pinsay-ext-${target}-${version}.zip`];
  if (target === 'firefox') zips.push(`pinsay-ext-source-${version}.zip`);
  return zips.map((name) => resolve(extRoot, name));
}

function checkZips(target, version) {
  const paths = zipPaths(target, version);
  for (const zipPath of paths) {
    if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
      throw new Error(`zip not found: ${basename(zipPath)} — run npm run package.`);
    }
  }
  for (const zipPath of paths) {
    let zipVersion;
    try {
      zipVersion = zipManifestVersion(readFileSync(zipPath));
    } catch (e) {
      throw new Error(`cannot read ${basename(zipPath)}: ${e.message}.`);
    }
    // The AMO source archive has manifest.json at its root too (git archive of this folder).
    if (zipVersion !== null && zipVersion !== version) {
      throw new Error(`zip manifest version ${zipVersion} != extension manifest.json version ${version} in ${basename(zipPath)} — run npm run package.`);
    }
  }
  return paths;
}

// Chrome: the upload/publish itself is cws-publish.mjs (child process, stdio inherited). The
// already-live check against the store happens here first: fetchStatus, refuse when the published
// revision is the same crxVersion.
function cwsConfig() {
  let config = {};
  try {
    config = JSON.parse(readFileSync(resolve(here, 'cws.config.json'), 'utf8'));
  } catch {}
  const itemId = process.env.CWS_ITEM_ID || config.itemId || '';
  const publisherId = process.env.CWS_PUBLISHER_ID || config.publisherId || '';
  if (!itemId || !publisherId) {
    throw new Error('missing CWS_ITEM_ID / CWS_PUBLISHER_ID — set the env vars or fill scripts/cws.config.json.');
  }
  return { itemId, publisherId };
}

async function chromeNotLiveYet(version) {
  const { itemId, publisherId } = cwsConfig();
  const clientId = await keychainGet('pinsay-cws', 'client_id');
  const clientSecret = await keychainGet('pinsay-cws', 'client_secret');
  const refreshToken = await keychainGet('pinsay-cws', 'refresh_token');
  const missing = [!clientId && 'client_id', !clientSecret && 'client_secret', !refreshToken && 'refresh_token'].filter(Boolean);
  if (missing.length > 0) throw new Error(keychainFailure('chrome', missing));

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    throw new Error(`chrome token refresh failed: ${e && e.message ? e.message : 'network error'}.`);
  });
  const tokenData = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(`chrome token refresh failed (HTTP ${tokenRes.status}).`);
  }

  const statusRes = await fetch(
    `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:fetchStatus`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(60_000),
    },
  ).catch((e) => {
    throw new Error(`chrome fetchStatus failed: ${e && e.message ? e.message : 'network error'}.`);
  });
  const status = await statusRes.json().catch(() => null);
  if (!statusRes.ok) throw new Error(`chrome fetchStatus failed (HTTP ${statusRes.status}).`);
  const crxVersion = status?.publishedItemRevisionStatus?.crxVersion;
  if (crxVersion === version) {
    throw new Error(`version ${version} is already live in the Chrome Web Store (fetchStatus publishedItemRevisionStatus crxVersion) — bump manifest.json first.`);
  }
  if (crxVersion) console.log(`Chrome live version: ${crxVersion} → ${version} is fine to upload.`);
}

async function publishChrome(zipPaths, version, submit, dryRun) {
  cwsConfig(); // fail before any remote call if the store ids are missing
  if (!dryRun) await chromeNotLiveYet(version);
  await runInherited(
    process.execPath,
    [resolve(here, 'cws-publish.mjs'), zipPaths[0], ...(submit ? ['--submit'] : []), ...(dryRun ? ['--dry-run'] : [])],
    'cws-publish',
  );
  return { reviewState: dryRun ? 'dry run OK' : submit ? 'submitted for review (state above)' : 'uploaded (not submitted)' };
}

// Fresh JWT per request (iss/jti/iat/exp, 60 s).
function amoAuthHeader(secret, issuer) {
  return { Authorization: `JWT ${amoJwt(secret, issuer)}` };
}

async function amoFetch(url, secret, issuer, options, label) {
  return fetch(url, {
    ...options,
    headers: { ...amoAuthHeader(secret, issuer), ...options.headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((e) => {
    throw new Error(`firefox ${label} failed: ${e && e.message ? e.message : 'network error'}.`);
  });
}

function amoErrorDetail(res, text) {
  try {
    const data = JSON.parse(text);
    return data?.error ?? data?.detail ?? text;
  } catch {
    return text;
  }
}

async function publishFirefox(zipPaths, version, submit, dryRun) {
  if (dryRun) return { reviewState: 'dry run OK' };
  const [zipPath, sourceZipPath] = zipPaths;
  const issuer = await keychainGet('pinsay-amo', 'jwt-issuer');
  const secret = await keychainGet('pinsay-amo', 'jwt-secret');

  // Already-live guard against the store: the version existing on AMO means it was submitted.
  const known = await amoFetch(amoVersionDetailUrl(version), secret, issuer, { method: 'GET' }, 'version check');
  if (known.status === 200) {
    throw new Error(`version ${version} already exists on addons.mozilla.org — bump manifest.json first.`);
  }
  if (known.status !== 404) {
    const detail = amoErrorDetail(known, await known.text().catch(() => ''));
    throw new Error(`firefox version check failed (HTTP ${known.status})${detail ? `: ${detail}` : ''}.`);
  }

  // 1. Upload the add-on zip (channel listed) → uuid.
  const form = new FormData();
  form.append('upload', new Blob([readFileSync(zipPath)], { type: 'application/zip' }), basename(zipPath));
  form.append('channel', 'listed');
  const upload = await amoFetch(amoUploadUrl(), secret, issuer, { method: 'POST', body: form }, 'upload');
  const uploadText = await upload.text();
  let uploadData = null;
  try {
    uploadData = JSON.parse(uploadText);
  } catch {}
  if (!upload.ok || !uploadData?.uuid) {
    throw new Error(`firefox upload failed (HTTP ${upload.status})${uploadText ? `: ${amoErrorDetail(upload, uploadText)}` : ''}.`);
  }
  console.log(`Firefox upload ${uploadData.uuid} accepted — waiting for validation (up to ${POLL_TIMEOUT_MS / 60_000} min)…`);

  // 2. Poll every 5 s until processed; invalid → the first 5 validation messages.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let detail = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await amoFetch(amoUploadDetailUrl(uploadData.uuid), secret, issuer, { method: 'GET' }, 'validation poll');
    const text = await poll.text();
    try {
      detail = JSON.parse(text);
    } catch {}
    if (!poll.ok || !detail) throw new Error(`firefox validation poll failed (HTTP ${poll.status}).`);
    if (detail.processed) break;
  }
  if (!detail?.processed) {
    throw new Error(`firefox validation still not processed after ${POLL_TIMEOUT_MS / 60_000} minutes — check https://addons.mozilla.org/developers/.`);
  }
  if (detail.valid === false) {
    const messages = (detail.validation?.messages ?? []).slice(0, 5).map((m) => `  - ${m.type}: ${m.message}`);
    throw new Error(`firefox validation failed:\n${messages.join('\n')}`);
  }
  console.log('Firefox validation: valid.');

  // Without --submit, stop here: AMO has no unsubmitted upload state, so the upload was
  // validation only. With --submit the upload becomes the listed version below.
  if (!submit) return { reviewState: 'validated (nothing submitted — AMO has no unsubmitted state)' };

  // 3. Create the add-on (first submission) or add the version to the existing add-on.
  const exists = await amoFetch(amoAddonUrl(), secret, issuer, { method: 'GET' }, 'add-on lookup');
  if (exists.status === 404) {
    const create = await amoFetch(amoAddonCreateUrl(), secret, issuer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: { firefox: ['web-development'] },
        summary: { 'en-US': AMO_SUMMARY },
        version: { upload: uploadData.uuid, license: 'all-rights-reserved' },
      }),
    }, 'add-on create');
    if (!create.ok) {
      throw new Error(`firefox add-on create failed (HTTP ${create.status}): ${amoErrorDetail(create, await create.text().catch(() => ''))}.`);
    }
    console.log('Firefox add-on created (listed).');
  } else if (exists.ok) {
    const versionCreate = await amoFetch(amoVersionCreateUrl(), secret, issuer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload: uploadData.uuid }),
    }, 'version create');
    if (!versionCreate.ok) {
      throw new Error(`firefox version create failed (HTTP ${versionCreate.status}): ${amoErrorDetail(versionCreate, await versionCreate.text().catch(() => ''))}.`);
    }
  } else {
    throw new Error(`firefox add-on lookup failed (HTTP ${exists.status}).`);
  }

  // 4. AMO requires the source archive for bundled code: PATCH it onto the version.
  const detailRes = await amoFetch(amoVersionDetailUrl(version), secret, issuer, { method: 'GET' }, 'version detail');
  const versionData = await detailRes.json().catch(() => null);
  if (!detailRes.ok || !versionData?.id) {
    throw new Error(`firefox version detail failed (HTTP ${detailRes.status}).`);
  }
  const sourceForm = new FormData();
  sourceForm.append('source', new Blob([readFileSync(sourceZipPath)], { type: 'application/zip' }), basename(sourceZipPath));
  const sourceRes = await amoFetch(amoVersionSourceUrl(versionData.id), secret, issuer, { method: 'PATCH', body: sourceForm }, 'source upload');
  if (!sourceRes.ok) {
    throw new Error(`firefox source upload failed (HTTP ${sourceRes.status}): ${amoErrorDetail(sourceRes, await sourceRes.text().catch(() => ''))}.`);
  }
  // 5. The version's review state.
  const sourceData = await sourceRes.json().catch(() => null);
  const fileStatus = sourceData?.file?.status ?? sourceData?.files?.[0]?.status ?? 'unknown';
  return { reviewState: `file.status ${fileStatus}` };
}

function edgeHeaders(apiKey, clientId) {
  return { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
}

async function edgeFetch(url, apiKey, clientId, options, label) {
  return fetch(url, {
    ...options,
    headers: { ...edgeHeaders(apiKey, clientId), ...options.headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((e) => {
    throw new Error(`edge ${label} failed: ${e && e.message ? e.message : 'network error'}.`);
  });
}

async function edgePoll(url, apiKey, clientId, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await edgeFetch(url, apiKey, clientId, { method: 'GET' }, label);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.status) throw new Error(`edge ${label} failed (HTTP ${res.status}).`);
    if (data.status === 'Failed') {
      throw new Error(`edge ${label} failed: ${data.message ?? 'no message from Microsoft'}.`);
    }
    if (data.status === 'Succeeded') return data;
  }
  throw new Error(`edge ${label} still not done after ${POLL_TIMEOUT_MS / 60_000} minutes — check Partner Center.`);
}

async function publishEdge(zipPaths, version, submit, dryRun) {
  if (dryRun) return { reviewState: 'dry run OK' };
  const clientId = await keychainGet('pinsay-edge', 'client-id');
  const apiKey = await keychainGet('pinsay-edge', 'api-key');
  const productId = await keychainGet('pinsay-edge', 'product-id');

  // Upload the package into the draft submission → 202 + Location = operation; poll it.
  const upload = await edgeFetch(edgePackageUploadUrl(productId), apiKey, clientId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: readFileSync(zipPaths[0]),
  }, 'package upload');
  if (upload.status !== 202 || !upload.headers.get('location')) {
    throw new Error(`edge package upload failed (HTTP ${upload.status}): ${(await upload.text().catch(() => '')) || 'no error message from Microsoft'}.`);
  }
  const opId = edgeOperationIdFromLocation(upload.headers.get('location'));
  console.log(`Edge package upload accepted (operation ${opId}) — polling…`);
  const packaged = await edgePoll(edgePackageOperationUrl(productId, opId), apiKey, clientId, 'package operation');
  if (!submit) return { reviewState: `draft package ${packaged.status.toLowerCase()} (not submitted)` };

  // Publish the draft submission → 202 + Location = operation; poll and print the status.
  const submitRes = await edgeFetch(edgeSubmitUrl(productId), apiKey, clientId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: `PinSay ${version}` }),
  }, 'submission');
  if (submitRes.status !== 202 || !submitRes.headers.get('location')) {
    throw new Error(`edge submission failed (HTTP ${submitRes.status}): ${(await submitRes.text().catch(() => '')) || 'no error message from Microsoft'}.`);
  }
  const submitOpId = edgeOperationIdFromLocation(submitRes.headers.get('location'));
  const published = await edgePoll(edgeSubmitOperationUrl(productId, submitOpId), apiKey, clientId, 'submission operation');
  return { reviewState: `submission ${published.status.toLowerCase()}` };
}

const PUBLISHERS = {
  chrome: publishChrome,
  firefox: publishFirefox,
  edge: publishEdge,
};

async function main() {
  const args = process.argv.slice(2);
  const submit = args.includes('--submit');
  const dryRun = args.includes('--dry-run');
  const targetIndex = args.indexOf('--target');
  const targetArg = targetIndex !== -1 ? args[targetIndex + 1] : undefined;
  if (!targetArg || ![...ORDER, 'all'].includes(targetArg)) {
    console.error('Usage: npm run publish -- --target chrome|edge|firefox|all [--submit] [--dry-run]');
    process.exit(targetArg === undefined ? 2 : 1);
  }
  const plan = targetArg === 'all' ? ORDER : [targetArg];

  let version;
  try {
    version = JSON.parse(readFileSync(resolve(extRoot, 'manifest.json'), 'utf8')).version;
  } catch {
    die('error: cannot read manifest.json next to scripts/ — run from extension/.');
  }
  if (typeof version !== 'string' || version.length === 0) {
    die('error: manifest.json has no valid version.');
  }
  const published = readPublished();

  const done = [];
  const failed = [];
  for (const target of plan) {
    const label = `${target}${dryRun ? ' (dry run)' : ''}`;
    try {
      // Local checks every mode shares: zips exist with the right manifest version, the version
      // is not already live per scripts/published.json, and the Keychain entries are there.
      const zipPaths = checkZips(target, version);
      const guard = liveGuard(published[target], version);
      if (!guard.ok) throw new Error(guard.reason);
      await checkKeychain(target);
      const { reviewState } = await PUBLISHERS[target](zipPaths, version, submit, dryRun);
      console.log(`${label}: OK — ${reviewState}.`);
      done.push(target);
      if (submit && !dryRun) recordPublished(target, version);
    } catch (e) {
      const reason = e && e.message ? e.message : 'unexpected failure';
      if (dryRun) {
        console.log(`${label}: ${reason}`);
        failed.push(target);
        continue;
      }
      die(
        `error: ${label}: ${reason}\n` +
          (done.length > 0
            ? `Targets completed before the failure: ${done.join(', ')}.`
            : 'No target completed before the failure.'),
      );
    }
  }

  if (dryRun) {
    if (failed.length > 0) {
      die(`dry run: ${failed.length} of ${plan.length} target(s) not ready (see above). No remote calls were made.`, 1);
    }
    console.log(`Dry run OK for all ${plan.length} target(s) — no remote calls made.`);
  }
}

main().catch((e) => die(e && e.message ? e.message : 'Unexpected failure.'));
