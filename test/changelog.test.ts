import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
// The public changelog page lives in PinSay's main repo (pinsay-landing); the public extension mirror has no copy.
const pageUrl = new URL('../../../pinsay-landing/docs/extension-changelog.html', import.meta.url);
const page = existsSync(pageUrl) ? readFileSync(pageUrl, 'utf8') : null;
const skipPage = page === null && 'pinsay-landing is not in this checkout (public mirror)';
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('the changelog page has an entry for the manifest version', { skip: skipPage }, () => {
  assert.ok(
    page!.includes(`<h2 id="v${manifest.version}">`),
    `pinsay-landing/docs/extension-changelog.html has no <h2 id="v${manifest.version}"> — add this release's notes`,
  );
});

test('the newest entry on the page is the manifest version', { skip: skipPage }, () => {
  const first = page!.match(/<h2 id="v([0-9.]+)">/);
  assert.equal(first?.[1], manifest.version);
});

test('the README changelog has an entry for the manifest version', () => {
  assert.ok(
    readme.includes(`- **${manifest.version}** — `),
    `README.md § Changelog has no "- **${manifest.version}** — " entry — add this release's notes`,
  );
});

test('the newest entry in the README changelog is the manifest version', () => {
  const first = readme.match(/^- \*\*([0-9.]+)\*\* — /m);
  assert.equal(first?.[1], manifest.version);
});
