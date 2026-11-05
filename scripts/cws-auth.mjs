#!/usr/bin/env node
// One-time interactive sign-in (run by the CEO): stores the Chrome Web Store refresh token in
// the macOS Keychain. `npm run cws:auth` from extension/.
//
// API this pairs with: Chrome Web Store API v2 (current as of 2026-10; v1 archived October 2025).
//   https://developer.chrome.com/docs/webstore/using-api
//   https://developer.chrome.com/docs/webstore/api
// OAuth flow: installed-app loopback (127.0.0.1, random port) + PKCE, offline access:
//   https://developers.google.com/identity/protocols/oauth2/native-app
//
// Secrets never pass through a shell string, a log line or a file: the client id/secret are read
// from the Keychain (service "pinsay-cws") and the only write is the refresh token back into the
// Keychain via `security add-generic-password` (execFile with argv, never a shell string).

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SERVICE = 'pinsay-cws';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALLBACK_WAIT_MS = 5 * 60 * 1000;

const die = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

async function keychainGet(account) {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function main() {
  const clientId = await keychainGet('client_id');
  const clientSecret = await keychainGet('client_secret');
  if (!clientId || !clientSecret) {
    console.error(`The OAuth client credentials are not in the Keychain (service "${SERVICE}").`);
    console.error('Add them once with these commands, replacing the placeholders (never commit real values):');
    console.error('');
    console.error(`  security add-generic-password -U -s ${SERVICE} -a client_id -w '<YOUR_OAUTH_CLIENT_ID>'`);
    console.error(`  security add-generic-password -U -s ${SERVICE} -a client_secret -w '<YOUR_OAUTH_CLIENT_SECRET>'`);
    process.exit(2);
  }

  // PKCE (S256) + state for the consent page.
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  let settleCallback;
  const authorizationCode = new Promise((resolve, reject) => {
    settleCallback = { resolve, reject };
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    server.close();
    server.unref();
    const respond = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>PinSay</title><p>${message}</p>`);
    };
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (error) {
      respond(400, 'Sign-in failed — check the terminal for the reason.');
      settleCallback.reject(new Error(`Google returned "${error}" on the consent page.`));
    } else if (!code) {
      respond(400, 'Sign-in failed — no authorization code came back; check the terminal.');
      settleCallback.reject(new Error('No authorization code in the browser callback.'));
    } else if (url.searchParams.get('state') !== state) {
      respond(400, 'Sign-in failed — state mismatch (possible CSRF); check the terminal.');
      settleCallback.reject(new Error('state mismatch in the browser callback — possible CSRF; aborting.'));
    } else {
      respond(200, 'Sign-in handled — you can close this tab.');
      settleCallback.resolve(code);
    }
  });

  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const consentUrl = new URL(AUTH_ENDPOINT);
  consentUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  }).toString();

  try {
    await run('open', [consentUrl.toString()]);
  } catch {
    console.error('Could not open the browser. Open this URL manually to continue:');
    console.error(consentUrl.toString());
  }

  const timeout = setTimeout(
    () => settleCallback.reject(new Error('Timed out waiting for the browser callback (5 minutes).')),
    CALLBACK_WAIT_MS,
  );
  timeout.unref();

  const code = await authorizationCode;
  clearTimeout(timeout);

  let data;
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    data = await res.json();
    if (!res.ok) {
      const reason = data && (data.error_description || data.error);
      die(`Token exchange failed (HTTP ${res.status})${reason ? `: ${reason}` : ''}.`);
    }
  } catch (e) {
    die(`Token exchange failed: ${e && e.message ? e.message : 'network error'}.`);
  }
  if (!data || !data.refresh_token) {
    die('Google did not return a refresh token. Re-run this command (it always asks with consent + offline access).');
  }

  try {
    await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', 'refresh_token', '-w', data.refresh_token]);
  } catch {
    die('Could not store the refresh token in the Keychain.');
  }
  console.log('Saved the Chrome Web Store sign-in to the Keychain (pinsay-cws).');
}

main().catch((e) => die(e && e.message ? e.message : 'Unexpected failure.'));
