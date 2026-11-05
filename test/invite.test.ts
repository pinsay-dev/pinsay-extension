import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteTokenFromUrl, stripInviteParam, widgetEnvironmentFor } from '../src/invite.ts';

test('inviteTokenFromUrl reads the token when present', () => {
  assert.equal(inviteTokenFromUrl('https://example.com/?pinsay_invite=abc123'), 'abc123');
});

test('inviteTokenFromUrl returns null when the param is absent', () => {
  assert.equal(inviteTokenFromUrl('https://example.com/?other=x'), null);
});

test('inviteTokenFromUrl returns null for a garbage URL', () => {
  assert.equal(inviteTokenFromUrl('not a url'), null);
});

test('stripInviteParam removes only the invite param, keeping others and the hash', () => {
  assert.equal(stripInviteParam('https://example.com/path?a=1&pinsay_invite=tok&b=2#frag'), 'https://example.com/path?a=1&b=2#frag');
});

test('stripInviteParam leaves a URL unchanged when the param is absent', () => {
  const url = 'https://example.com/path?a=1#frag';
  assert.equal(stripInviteParam(url), url);
});

test('stripInviteParam returns a garbage URL unchanged', () => {
  assert.equal(stripInviteParam('not a url'), 'not a url');
});

test("widgetEnvironmentFor maps 'prod' to 'production'", () => {
  assert.equal(widgetEnvironmentFor('prod'), 'production');
});

test("widgetEnvironmentFor maps 'Production' to 'production'", () => {
  assert.equal(widgetEnvironmentFor('Production'), 'production');
});

test("widgetEnvironmentFor maps 'staging' to 'staging'", () => {
  assert.equal(widgetEnvironmentFor('staging'), 'staging');
});

test("widgetEnvironmentFor maps 'local' to 'local'", () => {
  assert.equal(widgetEnvironmentFor('local'), 'local');
});

test("widgetEnvironmentFor maps 'testing' to 'unknown'", () => {
  assert.equal(widgetEnvironmentFor('testing'), 'unknown');
});

test("widgetEnvironmentFor maps null to 'staging'", () => {
  assert.equal(widgetEnvironmentFor(null), 'staging');
});

test("widgetEnvironmentFor maps undefined to 'staging'", () => {
  assert.equal(widgetEnvironmentFor(undefined), 'staging');
});

test("widgetEnvironmentFor maps '' to 'staging'", () => {
  assert.equal(widgetEnvironmentFor(''), 'staging');
});
