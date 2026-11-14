import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGuideStart, guideActive, guideProgress, GUIDE_TTL_MS } from '../src/guide.ts';

const ok = { source: 'pinsay-dashboard', kind: 'guide-start', projectKey: 'my-proj_1', projectName: ' My Project ', siteOrigin: 'https://example.com/some/path?q=1' };
const NOW = 1_700_000_000_000;

test('parseGuideStart accepts a valid message and normalizes the origin', () => {
  assert.deepEqual(parseGuideStart(ok, NOW), { projectKey: 'my-proj_1', projectName: 'My Project', siteOrigin: 'https://example.com', startedAt: NOW });
});

test('parseGuideStart rejects wrong source, kind and non-objects', () => {
  assert.equal(parseGuideStart({ ...ok, source: 'x' }, NOW), null);
  assert.equal(parseGuideStart({ ...ok, kind: 'other' }, NOW), null);
  assert.equal(parseGuideStart(null, NOW), null);
  assert.equal(parseGuideStart('guide-start', NOW), null);
});

test('parseGuideStart rejects bad keys and empty names', () => {
  assert.equal(parseGuideStart({ ...ok, projectKey: 'a b' }, NOW), null);
  assert.equal(parseGuideStart({ ...ok, projectKey: 'a'.repeat(65) }, NOW), null);
  assert.equal(parseGuideStart({ ...ok, projectName: '   ' }, NOW), null);
});

test('parseGuideStart drops a non-http siteOrigin', () => {
  assert.equal(parseGuideStart({ ...ok, siteOrigin: 'javascript:alert(1)' }, NOW)?.siteOrigin, null);
  assert.equal(parseGuideStart({ ...ok, siteOrigin: undefined }, NOW)?.siteOrigin, null);
});

test('guideActive honours the 24 h window', () => {
  const g = parseGuideStart(ok, NOW)!;
  assert.equal(guideActive(g, NOW + 23 * 3600_000), true);
  assert.equal(guideActive(g, NOW + 25 * 3600_000), false);
  assert.equal(guideActive(null, NOW), false);
  assert.equal(GUIDE_TTL_MS, 24 * 3600_000);
});

const gp = { projectKey: 'my-proj_1', projectName: 'My Project', siteOrigin: null, startedAt: NOW };

test('guideProgress: a preselected but unpicked project does not complete Choose', () => {
  const r = guideProgress(gp, '', null);
  assert.equal(r.choose, 'current');
  assert.equal(r.activate, 'todo');
});

test('guideProgress: picking the guide project completes Choose', () => {
  const r = guideProgress(gp, gp.projectKey, null);
  assert.equal(r.choose, 'done');
  assert.equal(r.activate, 'current');
});

test('guideProgress: a wrong project active on the tab does not count', () => {
  const r = guideProgress(gp, 'other', 'other');
  assert.equal(r.choose, 'current');
  assert.equal(r.activate, 'todo');
});

test('guideProgress: a tab already running the project is done through Activate', () => {
  const r = guideProgress(gp, '', gp.projectKey);
  assert.equal(r.choose, 'done');
  assert.equal(r.activate, 'done');
  assert.equal(r.comment, true);
});
