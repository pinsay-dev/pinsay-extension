import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectLabels, projectOptionsHtml } from '../src/project-options.ts';

const projects = [
  { key: 'pk_live_abc', name: 'Marketing site', urls: ['https://acme.com'] },
  { key: 'pk_live_def', name: 'Dashboard', urls: [] },
  { key: 'pk_live_ghi', name: 'Docs <beta>', urls: [] },
];

test('option text is the name, option value is the key, key never shown', () => {
  const html = projectOptionsHtml(projects, 'pk_live_def');
  assert.match(html, /<option value="pk_live_abc">Marketing site<\/option>/);
  assert.match(html, /<option value="pk_live_def" selected>Dashboard<\/option>/);
  assert.match(html, /Docs &lt;beta&gt;/);
  assert.equal(html.replace(/value="[^"]*"/g, '').includes('pk_live'), false);
});

test('order is kept and only the selected key is preselected', () => {
  const html = projectOptionsHtml(projects, 'pk_live_ghi');
  assert.equal((html.match(/selected/g) || []).length, 1);
  assert.ok(html.indexOf('Marketing') < html.indexOf('Dashboard'));
});

test('nothing selected: a blank option is preselected, no placeholder text', () => {
  const html = projectOptionsHtml(projects, '');
  assert.ok(html.startsWith('<option value="" selected></option>'));
  assert.equal((html.match(/selected/g) || []).length, 1);
});

test('same names are told apart by site host, then a counter, never the key', () => {
  const labels = projectLabels([
    { key: 'k1', name: 'App', urls: ['https://a.example.com/x'] },
    { key: 'k2', name: 'App', urls: ['https://b.example.com'] },
    { key: 'k3', name: 'Solo', urls: [] },
    { key: 'k4', name: 'Same', urls: [] },
    { key: 'k5', name: 'Same', urls: [] },
  ]);
  assert.deepEqual(labels, ['App · a.example.com', 'App · b.example.com', 'Solo', 'Same (1)', 'Same (2)']);
});
