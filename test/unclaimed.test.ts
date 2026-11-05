import test from 'node:test';
import assert from 'node:assert/strict';
import { unclaimedEligible, armUnclaimed, unclaimedLoad, UNCLAIMED_ARM_MS } from '../src/unclaimed.ts';

test('unclaimedEligible accepts public dotted http(s) hosts', () => {
  for (const u of ['https://example.com/a', 'http://shop.example.co.uk', 'https://foo.vercel.app']) assert.equal(unclaimedEligible(u), true, u);
});
test('unclaimedEligible refuses everything else', () => {
  for (const u of ['chrome://extensions', 'file:///x', 'https://localhost:3000', 'http://app.localhost', 'https://printer.local',
    'https://svc.internal', 'http://192.168.1.10', 'http://[::1]/', 'https://intranet', 'not a url']) assert.equal(unclaimedEligible(u), false, u);
});

const O = 'https://hiring.example.com';
test('unclaimedLoad: same origin inside the window injects and records the load', () => {
  const r = unclaimedLoad(armUnclaimed(O, 1000), `${O}/check-in`, 2000);
  assert.equal(r.inject, true);
  assert.deepEqual(r.arm, { origin: O, at: 1000, loads: [2000] });
  const r2 = unclaimedLoad(r.arm, `${O}/access-denied?x=1`, 9000);
  assert.equal(r2.inject, true);
  assert.deepEqual(r2.arm?.loads, [2000, 9000]);
});
test('unclaimedLoad: another origin, an expired arm or a malformed arm drops it', () => {
  for (const [arm, url, now] of [
    [armUnclaimed(O, 1000), 'https://other.example.com/', 2000],
    [armUnclaimed(O, 1000), 'http://hiring.example.com/', 2000],
    [armUnclaimed(O, 1000), `${O}/`, 1000 + UNCLAIMED_ARM_MS + 1],
    [true, `${O}/`, 2000],
    [{ origin: O }, `${O}/`, 2000],
    [armUnclaimed(O, 1000), 'not a url', 2000],
  ] as [unknown, string, number][]) assert.deepEqual(unclaimedLoad(arm, url, now), { inject: false, arm: null }, String(url));
});
test('unclaimedLoad: a reload loop (5 loads in 20 s) disarms the tab; older loads do not count', () => {
  let arm: unknown = armUnclaimed(O, 0);
  for (let i = 1; i <= 5; i++) {
    const r = unclaimedLoad(arm, `${O}/`, i * 1000);
    assert.equal(r.inject, true, `load ${i}`);
    arm = r.arm;
  }
  assert.deepEqual(unclaimedLoad(arm, `${O}/`, 6000), { inject: false, arm: null });
  assert.equal(unclaimedLoad(arm, `${O}/`, 30000).inject, true);
});
