import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footerHtml, CHANGELOG_URL } from '../src/footer.ts';

test('footer shows the version and the changelog link', () => {
  const html = footerHtml('0.7.2', "What's new");
  assert.ok(html.includes('<span dir="ltr">v0.7.2</span>'), html);
  assert.ok(html.includes(`<a id="whats-new" href="${CHANGELOG_URL}">What&#39;s new</a>`), html);
  assert.equal(CHANGELOG_URL, 'https://pinsay.dev/docs/extension-changelog.html');
});

test('footer without a version shows only the link', () => {
  const html = footerHtml('', 'ما الجديد');
  assert.equal(html, `<a id="whats-new" href="${CHANGELOG_URL}">ما الجديد</a>`);
});

test('footer escapes its inputs', () => {
  const html = footerHtml('<b>1</b>', '<i>x</i>');
  assert.ok(!html.includes('<b>') && !html.includes('<i>'), html);
});
