import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupStatusFromResponse, magicStatusFromResponse, resendSecondsLeft, freshPendingChoice, freshAuthOutcome, authOutcomeMessageKey, throttledBackToCode, AUTH_OUTCOME_TTL_MS } from '../src/signup.ts';
import { waitText } from '../src/i18n.ts';

test('the server status wins', () => {
  assert.equal(signupStatusFromResponse(200, { status: 'code_sent' }), 'code_sent');
  assert.equal(signupStatusFromResponse(400, { status: 'wrong_code' }), 'wrong_code');
  assert.equal(signupStatusFromResponse(429, { status: 'throttled' }), 'throttled');
});

test('without a status the HTTP code decides', () => {
  assert.equal(signupStatusFromResponse(409, null), 'account_exists');
  assert.equal(signupStatusFromResponse(403, null), 'signup_closed');
  assert.equal(signupStatusFromResponse(429, undefined), 'rate_limited');
  assert.equal(signupStatusFromResponse(400, {}), 'invalid');
  assert.equal(signupStatusFromResponse(0, null), 'network');
});

test('resendSecondsLeft counts down to 0', () => {
  assert.equal(resendSecondsLeft(1000, 1000), 60);
  assert.equal(resendSecondsLeft(1000, 1000 + 59_500), 1);
  assert.equal(resendSecondsLeft(1000, 1000 + 60_000), 0);
  assert.equal(resendSecondsLeft(1000, 1000 + 90_000), 0);
});

test('waitText says seconds under a minute, minutes above (EN + AR plurals)', () => {
  assert.equal(waitText(45, 'en'), '45 seconds');
  assert.equal(waitText(60, 'en'), '1 minute');
  assert.equal(waitText(3600, 'en'), '60 minutes');
  assert.equal(waitText(120, 'ar'), 'دقيقتين');
  assert.equal(waitText(300, 'ar'), '5 دقائق');
});

test('magicStatusFromResponse maps the magic-link answers', () => {
  assert.equal(magicStatusFromResponse(200, { status: 'sent' }), 'code_sent');
  assert.equal(magicStatusFromResponse(200, { status: 'waiting' }), 'pending_confirmation');
  assert.equal(magicStatusFromResponse(200, { status: 'done', login: { status: 'ok' } }), 'ok');
  assert.equal(magicStatusFromResponse(200, { status: 'done', login: { status: 'choose-workspace' } }), 'choose-workspace');
  assert.equal(magicStatusFromResponse(200, { status: 'done', login: { status: 'pending' } }), 'pending_approval');
  assert.equal(magicStatusFromResponse(200, { status: 'done', login: { status: 'mfa_required' } }), 'mfa_required');
  assert.equal(magicStatusFromResponse(200, { status: 'done', login: { status: 'no-workspace' } }), 'no_workspace');
  assert.equal(magicStatusFromResponse(400, { status: 'wrong_code' }), 'wrong_code');
  assert.equal(magicStatusFromResponse(403, null), 'signup_closed');
  assert.equal(magicStatusFromResponse(429, null), 'rate_limited');
  assert.equal(magicStatusFromResponse(0, null), 'network');
});

const ws = [{ workspaceId: 'w1', name: 'Acme' }];

test('freshPendingChoice keeps a well-formed choice younger than 10 minutes', () => {
  const c = { workspaces: ws, selectionToken: 'sel', email: 'a@b.c', at: 1000 };
  assert.deepEqual(freshPendingChoice(c, 1000 + AUTH_OUTCOME_TTL_MS - 1), c);
});

test('freshPendingChoice drops expired, future, junk and incomplete values', () => {
  assert.equal(freshPendingChoice({ workspaces: ws, selectionToken: 'sel', email: '', at: 1000 }, 1000 + AUTH_OUTCOME_TTL_MS), null);
  assert.equal(freshPendingChoice({ workspaces: ws, selectionToken: 'sel', email: '', at: 5000 }, 1000), null);
  assert.equal(freshPendingChoice({ workspaces: [], selectionToken: 'sel', at: 1000 }, 1000), null);
  assert.equal(freshPendingChoice({ workspaces: ws, selectionToken: '', at: 1000 }, 1000), null);
  assert.equal(freshPendingChoice('junk', 1000), null);
  assert.equal(freshPendingChoice(undefined, 1000), null);
});

test('authOutcomeMessageKey maps the session-less outcomes and nothing else', () => {
  assert.equal(authOutcomeMessageKey('mfa_required'), 'mfaOnDashboard');
  assert.equal(authOutcomeMessageKey('no_workspace'), 'noWorkspace');
  assert.equal(authOutcomeMessageKey('rejected'), 'accountRejected');
  assert.equal(authOutcomeMessageKey('disabled'), 'accountDisabled');
  assert.equal(authOutcomeMessageKey('pending_approval'), 'accountPending');
  assert.equal(authOutcomeMessageKey('ok'), null);
  assert.equal(authOutcomeMessageKey('choose-workspace'), null);
  assert.equal(authOutcomeMessageKey('wrong_code'), null);
});

test('freshAuthOutcome keeps a known outcome once and drops the rest', () => {
  assert.deepEqual(freshAuthOutcome({ status: 'mfa_required', email: 'a@b.c', at: 1000 }, 2000), { status: 'mfa_required', email: 'a@b.c' });
  assert.equal(freshAuthOutcome({ status: 'mfa_required', email: 'a@b.c', at: 1000 }, 1000 + AUTH_OUTCOME_TTL_MS), null);
  assert.equal(freshAuthOutcome({ status: 'ok', email: 'a@b.c', at: 1000 }, 2000), null);
  assert.equal(freshAuthOutcome(null, 2000), null);
});

test('throttledBackToCode matches the pending address, ignoring case and spaces', () => {
  assert.equal(throttledBackToCode({ email: 'Moamen@Example.com' }, ' moamen@example.com '), true);
  assert.equal(throttledBackToCode({ email: 'a@example.com' }, 'b@example.com'), false);
  assert.equal(throttledBackToCode(null, 'a@example.com'), false);
});
