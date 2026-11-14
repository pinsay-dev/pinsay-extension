import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manifestFor, TARGETS } from '../scripts/manifest.mjs';

const base = {
  manifest_version: 3,
  name: 'PinSay',
  version: '1.2.3',
  background: { service_worker: 'background.js' },
  permissions: ['storage', 'scripting'],
};

test('chrome and edge manifests equal the base', () => {
  assert.deepEqual(manifestFor('chrome', base), base);
  assert.deepEqual(manifestFor('edge', base), base);
});

test('firefox manifest uses background scripts and declares gecko settings', () => {
  const m = manifestFor('firefox', base);
  assert.deepEqual(m.background, { scripts: ['background.js'] });
  assert.equal('service_worker' in m.background, false);
  assert.equal(m.browser_specific_settings.gecko.id, 'pinsay@pinsay.dev');
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions.required, [
    'authenticationInfo', 'personallyIdentifyingInfo', 'websiteActivity', 'websiteContent',
  ]);
  assert.equal(m.version, base.version);
  assert.deepEqual(m.permissions, base.permissions);
});

test('manifestFor does not mutate the base', () => {
  const copy = structuredClone(base);
  manifestFor('firefox', base);
  assert.deepEqual(base, copy);
});

test('every target ships the presence content script on the dashboard only, host permissions unchanged', () => {
  const real = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const target of Object.keys(TARGETS)) {
    const m = manifestFor(target, real);
    assert.deepEqual(m.content_scripts, [
      { matches: ['https://app.pinsay.dev/*'], js: ['presence.js'], run_at: 'document_start' },
    ]);
    assert.deepEqual(m.host_permissions, ['https://app.pinsay.dev/*', 'https://api.pinsay.dev/*']);
  }
});
