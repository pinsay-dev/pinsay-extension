import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEarlyCapture, type EarlyState } from '../src/early-capture-core.ts';
import { earlyCaptureMatches, sameMatches } from '../src/early-match.ts';

function fakeWindow() {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const w: any = {
    addEventListener(t: string, fn: (e: any) => void) { (listeners[t] ||= []).push(fn); },
    removeEventListener(t: string, fn: (e: any) => void) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    fire(t: string, e: any) { for (const f of [...(listeners[t] || [])]) f(e); },
    count(t: string) { return (listeners[t] || []).length; },
  };
  return w;
}

test('records uncaught errors with their place and stack', () => {
  const w = fakeWindow();
  installEarlyCapture(w);
  const err = new TypeError('x is undefined');
  w.fire('error', { message: 'Uncaught TypeError: x is undefined', filename: 'https://a.test/app.js', lineno: 3, colno: 7, error: err });
  w.fire('error', { message: 'Script error.', filename: '', error: null });
  const s: EarlyState = w.__PINSAY_EARLY__;
  assert.equal(s.done, false);
  assert.equal(s.console.length, 2);
  assert.equal(s.console[0].message, 'Uncaught TypeError: x is undefined (https://a.test/app.js:3:7)');
  assert.equal(s.console[0].source, 'error');
  assert.equal(s.console[0].level, 'error');
  assert.ok(s.console[0].stack?.includes('x is undefined'));
  assert.ok(!Number.isNaN(Date.parse(s.console[0].occurredAt)));
  assert.equal(s.console[1].message, 'Uncaught Script error.');
});

test('ignores resource error events (no message)', () => {
  const w = fakeWindow();
  installEarlyCapture(w);
  w.fire('error', { target: {} });
  assert.equal(w.__PINSAY_EARLY__.console.length, 0);
});

test('records unhandled rejections (Error and plain values)', () => {
  const w = fakeWindow();
  installEarlyCapture(w);
  w.fire('unhandledrejection', { reason: new Error('boom') });
  w.fire('unhandledrejection', { reason: { code: 42 } });
  const c = w.__PINSAY_EARLY__.console;
  assert.deepEqual(c.map((e: any) => e.message), ['Unhandled promise rejection: boom', 'Unhandled promise rejection: {\"code\":42}']);
  assert.equal(c[0].source, 'unhandledrejection');
});

test('keeps at most 50 entries', () => {
  const w = fakeWindow();
  installEarlyCapture(w);
  for (let i = 0; i < 60; i++) w.fire('error', { message: `e${i}` });
  assert.equal(w.__PINSAY_EARLY__.console.length, 50);
});

test('stops and removes its listeners once the widget sets done', () => {
  const w = fakeWindow();
  installEarlyCapture(w);
  w.__PINSAY_EARLY__.done = true;
  w.fire('error', { message: 'late' });
  w.fire('unhandledrejection', { reason: 'late' });
  assert.equal(w.__PINSAY_EARLY__.console.length, 0);
  assert.equal(w.count('error'), 0);
  assert.equal(w.count('unhandledrejection'), 0);
});

test('installs once per page', () => {
  const w = fakeWindow();
  installEarlyCapture(w);
  const first = w.__PINSAY_EARLY__;
  installEarlyCapture(w);
  assert.equal(w.__PINSAY_EARLY__, first);
  assert.equal(w.count('error'), 1);
});

test('match patterns: both schemes, no port, invalid hosts skipped, sorted and unique', () => {
  assert.deepEqual(earlyCaptureMatches(['App.Fareeqy.com', 'localhost', 'app.fareeqy.com', '', 'bad host', '.x']), [
    'http://app.fareeqy.com/*', 'http://localhost/*', 'https://app.fareeqy.com/*', 'https://localhost/*',
  ]);
});

test('sameMatches ignores order and catches any difference', () => {
  assert.equal(sameMatches(['https://a.test/*', 'http://a.test/*'], ['http://a.test/*', 'https://a.test/*']), true);
  assert.equal(sameMatches(undefined, []), true);
  assert.equal(sameMatches(['https://a.test/*'], ['https://a.test/*', 'http://a.test/*']), false);
  assert.equal(sameMatches(['https://a.test/*'], ['https://b.test/*']), false);
});
