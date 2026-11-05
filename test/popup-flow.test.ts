import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../src/i18n.ts';

const popup = readFileSync(new URL('../src/popup.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf('\nfunction ', start + 1);
  const nextAsync = src.indexOf('\nasync function ', start + 1);
  const ends = [next, nextAsync].filter((i) => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
};

test('Verify & continue never waits on a site-access prompt (root cause A)', () => {
  assert.ok(!fnBody(popup, 'renderCheckEmail').includes('permissions.request'));
});

test('render() reopens the workspace picker and the kept message (root cause B)', () => {
  const r = fnBody(popup, 'render');
  assert.ok(r.includes('state.pendingChoice'));
  assert.ok(r.includes('state.authOutcome'));
});

test('finishMagic keeps choose-workspace and session-less outcomes (root cause B)', () => {
  const f = fnBody(background, 'finishMagic');
  assert.ok(f.includes('SESSION_KEYS.pendingChoice'));
  assert.ok(f.includes('SESSION_KEYS.authOutcome'));
});

test('the throttle message no longer reads like an outage (root cause C)', () => {
  assert.ok(!/too many requests/i.test(STRINGS.throttled.en));
  assert.ok(STRINGS.throttled.en.includes('{wait}'));
  assert.ok(STRINGS.throttled.ar.includes('{wait}'));
});

test('render() poll shows a session-less outcome with its message and clears the kept copy (review finding 1)', () => {
  const r = fnBody(popup, 'render');
  assert.ok(r.includes('authOutcomeMessageKey(r.status)'));
  assert.equal((r.match(/clearAuthOutcome/g) || []).length, 2);
});

test('universal feedback card flow (T12)', () => {
  const so = fnBody(popup, 'renderSignedOut');
  assert.ok(so.includes('unclaimedEligible') && so.includes('renderUnclaimedCard'));
  const su = fnBody(popup, 'startUnclaimed');
  assert.ok(su.includes('permissions.request') && su.includes('activateUnclaimed'));
  const rc = fnBody(popup, 'renderUnclaimedCard');
  assert.ok(rc.includes('startUnclaimed') && rc.includes('v-team'));
  assert.ok(rc.includes('getTabState') && rc.includes('u-off') && rc.includes("type: 'deactivate'"));
});

test('unclaimed card copy does not claim the site has no PinSay and says the page reloads', () => {
  assert.ok(!STRINGS.unclaimedNote.en.includes("doesn't use"));
  assert.ok(STRINGS.unclaimedNote.en.includes('The page reloads once.'));
  assert.ok(STRINGS.unclaimedNote.ar.includes('سيُعاد تحميل الصفحة'));
});

test('background: unclaimed tabs stay armed through same-origin reloads; the CSP strip stays one-shot', () => {
  const bg = background;
  assert.ok(!bg.includes('takeUnclaimedTab'));
  assert.ok(bg.includes('unclaimedLoad(arm, url, Date.now())'));
  assert.ok(bg.includes('armUnclaimed(m.origin, Date.now())'));
  const inj = fnBody(bg, 'injectInto');
  assert.ok(inj.includes('if (unclaimed) {') && inj.includes('removeCspBypass(tabId)'));
});
