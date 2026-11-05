import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyKey, siteName, keyCandidates, defaultEnvironmentName, pickEnvironment, randomTail, generatedKeyBase } from '../src/slug.ts';

test('slugifyKey turns a display name into a key', () => {
  assert.equal(slugifyKey('My Shop!'), 'my-shop');
});

test('slugifyKey transliterates Arabic', () => {
  assert.equal(slugifyKey('متجر'), 'mtjr');
});

test('slugifyKey returns "" when nothing usable is left', () => {
  assert.equal(slugifyKey('***'), '');
});

test('slugifyKey caps the key at 64 characters', () => {
  assert.equal(slugifyKey('a'.repeat(80)).length, 64);
});

test('siteName drops www and the TLD', () => {
  assert.equal(siteName('www.bassitedu.com'), 'bassitedu');
});

test('siteName keeps the middle label of a multi-part host', () => {
  assert.equal(siteName('app.acme.io'), 'app.acme');
});

test('siteName keeps a bare localhost', () => {
  assert.equal(siteName('localhost'), 'localhost');
});

test('siteName names an IP host "local-app"', () => {
  assert.equal(siteName('192.168.1.5'), 'local-app');
});

test('keyCandidates skips taken keys', () => {
  assert.deepEqual(keyCandidates('bassitedu', ['bassitedu'], 3), ['bassitedu-2', 'bassitedu-3', 'bassitedu-4']);
});

test('keyCandidates starts at the base when nothing is taken', () => {
  assert.deepEqual(keyCandidates('x', [], 2), ['x', 'x-2']);
});

test('keyCandidates keeps every candidate within 64 characters', () => {
  for (const key of keyCandidates('a'.repeat(64), [], 3)) {
    assert.ok(key.length <= 64);
  }
});

test('defaultEnvironmentName picks local for local hosts', () => {
  assert.equal(defaultEnvironmentName('localhost'), 'local');
  assert.equal(defaultEnvironmentName('myapp.test'), 'local');
  assert.equal(defaultEnvironmentName('10.0.0.2'), 'local');
});

test('defaultEnvironmentName picks production otherwise', () => {
  assert.equal(defaultEnvironmentName('bassitedu.com'), 'production');
});

test('pickEnvironment preselects the seeded prod environment for a public site', () => {
  const seeded = [{ name: 'local' }, { name: 'prod' }, { name: 'staging' }, { name: 'testing' }];
  assert.equal(pickEnvironment(seeded, 'bassitedu.com')?.name, 'prod');
});

test('pickEnvironment preselects local for a local host', () => {
  const seeded = [{ name: 'local' }, { name: 'prod' }, { name: 'staging' }, { name: 'testing' }];
  assert.equal(pickEnvironment(seeded, 'localhost')?.name, 'local');
});

test('pickEnvironment matches the API aliases case-insensitively', () => {
  assert.equal(pickEnvironment([{ name: 'Live' }, { name: 'dev' }], 'shop.example.com')?.name, 'Live');
  assert.equal(pickEnvironment([{ name: 'Development' }, { name: 'Production' }], '127.0.0.1')?.name, 'Development');
});

test('pickEnvironment falls back to the first environment', () => {
  assert.equal(pickEnvironment([{ name: 'qa' }], 'shop.example.com')?.name, 'qa');
});

test('pickEnvironment returns null for an empty list', () => {
  assert.equal(pickEnvironment([], 'x.com'), null);
});

test('randomTail is four base-36 characters driven by rand', () => {
  assert.equal(randomTail(() => 0), '0000');
  assert.equal(randomTail(() => 0.999999), 'zzzz');
  assert.ok(/^[0-9a-z]{4}$/.test(randomTail()));
});

test('generatedKeyBase slugs the name and appends the tail', () => {
  assert.equal(generatedKeyBase('Bassit Edu', 'bassitedu.com', () => 0), 'bassit-edu-0000');
});

test('generatedKeyBase falls back to the site name', () => {
  assert.equal(generatedKeyBase('', 'www.bassitedu.com', () => 0), 'bassitedu-0000');
});

test('generatedKeyBase falls back to "project" when nothing is usable', () => {
  assert.equal(generatedKeyBase('***', '', () => 0), 'project-0000');
});

test('generatedKeyBase keeps a long name within KEY_MAX_LENGTH with room for the tail', () => {
  const key = generatedKeyBase('a'.repeat(80), '', () => 0);
  assert.equal(key.length, 64);
  assert.ok(/^[a-z0-9-]+$/.test(key));
});
