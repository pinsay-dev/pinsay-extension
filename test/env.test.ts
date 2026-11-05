import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowser, detectStore, BUILD_STORE } from '../src/env.ts';

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_UA = CHROME_UA + ' Edg/141.0.0.0';
const OPERA_UA = CHROME_UA + ' OPR/120.0.0.0';
const FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0';

test('brands: Edge wins even with a Chrome-store build (criterion 28)', () => {
  assert.equal(detectBrowser(['Not)A;Brand', 'Chromium', 'Microsoft Edge'], EDGE_UA), 'edge');
});
test('brands: Google Chrome', () => {
  assert.equal(detectBrowser(['Chromium', 'Google Chrome', 'Not.A/Brand'], CHROME_UA), 'chrome');
});
test('brands: other Chromium (Brave, Opera, plain Chromium)', () => {
  assert.equal(detectBrowser(['Chromium', 'Brave', 'Not=A?Brand'], CHROME_UA), 'other-chromium');
  assert.equal(detectBrowser(['Chromium', 'Not=A?Brand'], CHROME_UA), 'other-chromium');
});
test('no brands: UA fallback', () => {
  assert.equal(detectBrowser(null, EDGE_UA), 'edge');
  assert.equal(detectBrowser(undefined, FIREFOX_UA), 'firefox');
  assert.equal(detectBrowser([], OPERA_UA), 'other-chromium');
  assert.equal(detectBrowser([], CHROME_UA), 'chrome');
  assert.equal(detectBrowser([], ''), 'other-chromium');
});
test('store: development install is unpacked, else the build store', () => {
  assert.equal(detectStore('chrome-web-store', 'development'), 'unpacked');
  assert.equal(detectStore('chrome-web-store', 'normal'), 'chrome-web-store');
  assert.equal(detectStore('edge-addons', undefined), 'edge-addons');
});
test('build store defaults to the Chrome Web Store outside a build', () => {
  assert.equal(BUILD_STORE, 'chrome-web-store');
});
