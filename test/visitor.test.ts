import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyAuthorization } from '../src/visitor.ts';

test('the extension token wins and the page header is dropped', () => {
  assert.equal(proxyAuthorization('ext', 'Bearer abcdefghijkl'), 'Bearer ext');
});

test('with no extension token the page visitor token is forwarded', () => {
  assert.equal(proxyAuthorization(null, 'Bearer abcdefghijkl'), 'Bearer abcdefghijkl');
});

test('no extension token and no page header gives null', () => {
  assert.equal(proxyAuthorization(null, undefined), null);
});

test('a non-Bearer page header is refused', () => {
  assert.equal(proxyAuthorization(null, 'Basic x'), null);
});

test('a page header with a line break is refused', () => {
  assert.equal(proxyAuthorization(null, 'Bearer abcde\nfghijkl'), null);
});
