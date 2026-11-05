import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestFor } from '../scripts/manifest.mjs';

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
