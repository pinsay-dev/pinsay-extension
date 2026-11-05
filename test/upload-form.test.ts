import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadForm } from '../src/upload-form.ts';

const base = { source: 'pinsay-ext', kind: 'upload', id: 1, url: 'u', base64: Buffer.from('abc').toString('base64'),
  filename: 'screenshot.webp', contentType: 'image/webp', project: 'p' } as const;

test('payload + screenshot', () => {
  const fd = uploadForm({ ...base, fields: { payload: '{"a":1}' }, fileField: 'screenshot' });
  assert.deepEqual([...fd.keys()], ['payload', 'screenshot']);
  assert.equal(fd.get('payload'), '{"a":1}');
  const f = fd.get('screenshot') as File;
  assert.equal(f.size, 3); assert.equal(f.type, 'image/webp'); assert.equal(f.name, 'screenshot.webp');
  assert.equal(fd.has('file'), false); assert.equal(fd.has('project'), false);
});
test('no file', () => {
  const fd = uploadForm({ ...base, base64: '', fields: { payload: '{"a":1}' }, fileField: 'screenshot' });
  assert.deepEqual([...fd.keys()], ['payload']);
});
test('old shape', () => {
  const fd = uploadForm({ ...base });
  assert.deepEqual([...fd.keys()], ['file', 'project']);
  assert.equal(fd.get('project'), 'p');
});
test('fields + file', () => {
  const fd = uploadForm({ ...base, fields: { project: 'p', kind: 'audio' }, fileField: 'file' });
  assert.deepEqual([...fd.keys()], ['project', 'kind', 'file']);
});
