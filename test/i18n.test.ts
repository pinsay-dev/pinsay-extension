import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, translate, langFor } from '../src/i18n.ts';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) || []).sort();

test('every key has non-empty en and ar', () => {
  for (const [key, v] of Object.entries(STRINGS)) {
    assert.ok(v.en.trim(), `${key} en`);
    assert.ok(v.ar.trim(), `${key} ar`);
  }
});

test('en and ar use the same placeholders', () => {
  for (const [key, v] of Object.entries(STRINGS)) {
    assert.deepEqual(placeholders(v.ar), placeholders(v.en), key);
  }
});

test('translate substitutes {vars}', () => {
  assert.equal(translate('en', 'wrongCode', { n: 3 }), 'That code is not right. 3 tries left.');
  assert.ok(translate('ar', 'codeSent', { email: 'a@b.co' }).includes('a@b.co'));
  assert.equal(translate('en', 'codeSent'), STRINGS.codeSent.en);
});

test('langFor picks Arabic for ar-*', () => {
  assert.equal(langFor('ar-SA'), 'ar');
  assert.equal(langFor('en-US'), 'en');
  assert.equal(langFor(undefined), 'en');
});
