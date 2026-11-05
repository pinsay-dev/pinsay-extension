import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProjects, chooseProject, type MatchableProject } from '../src/match.ts';

const p = (key: string, ...urls: string[]): MatchableProject => ({ key, urls });

test('exact origin match selects the project', () => {
  const projects = [p('a', 'https://a.example.com'), p('b', 'https://b.example.com')];
  assert.deepEqual(chooseProject(projects, 'https://b.example.com/some/page?x=1#h'), { key: 'b', source: 'matched' });
});

test('origin comparison ignores case, trailing slash and an explicit default port', () => {
  const projects = [p('a', 'HTTPS://App.Example.com:443/')];
  assert.equal(chooseProject(projects, 'https://app.example.com/dash').key, 'a');
});

test('any of a project\'s URLs can match (environment URLs)', () => {
  const projects = [p('a', 'https://prod.acme.com', 'https://staging.acme.com')];
  assert.equal(chooseProject(projects, 'https://staging.acme.com/').key, 'a');
});

test('ports must agree, including on localhost', () => {
  const projects = [p('web', 'http://localhost:3000'), p('docs', 'http://localhost:5173')];
  assert.equal(chooseProject(projects, 'http://localhost:5173/guide').key, 'docs');
  assert.deepEqual(chooseProject(projects, 'http://localhost:8080/'), { key: '', source: 'none' });
});

test('loopback aliases match each other at the lower tier', () => {
  const projects = [p('web', 'http://localhost:3000')];
  assert.deepEqual(matchProjects(projects, 'http://127.0.0.1:3000/'), [{ key: 'web', tier: 1, pathScore: 0 }]);
});

test('www and http/https differences match at the lower tier; an exact origin wins over them', () => {
  const projects = [p('loose', 'http://acme.com'), p('exact', 'https://www.acme.com')];
  assert.equal(chooseProject(projects, 'https://www.acme.com/').key, 'exact');
  assert.equal(chooseProject([p('loose', 'http://acme.com')], 'https://www.acme.com/').key, 'loose');
});

test('a different subdomain is not the same site', () => {
  assert.deepEqual(chooseProject([p('a', 'https://acme.com')], 'https://admin.acme.com/'), { key: '', source: 'none' });
});

test('wildcard patterns match one leftmost label', () => {
  const projects = [p('preview', 'https://myapp-*.vercel.app')];
  assert.deepEqual(matchProjects(projects, 'https://myapp-git-feat-x.vercel.app/a'), [{ key: 'preview', tier: 2, pathScore: 0 }]);
  assert.deepEqual(matchProjects(projects, 'https://other.vercel.app/'), []);
  assert.deepEqual(matchProjects(projects, 'https://a.myapp-1.vercel.app/'), []);
});

test('an exact origin beats a wildcard pattern', () => {
  const projects = [p('preview', 'https://*.staging.acme.com'), p('pr7', 'https://pr7.staging.acme.com')];
  assert.equal(chooseProject(projects, 'https://pr7.staging.acme.com/').key, 'pr7');
});

test('the most specific path wins on the same origin', () => {
  const projects = [p('site', 'https://acme.com'), p('admin', 'https://acme.com/admin')];
  assert.equal(chooseProject(projects, 'https://acme.com/admin/users').key, 'admin');
  assert.equal(chooseProject(projects, 'https://acme.com/shop').key, 'site');
  assert.equal(chooseProject(projects, 'https://acme.com/administrator').key, 'site');
});

test('equally good matches select nothing and list the candidates', () => {
  const projects = [p('a', 'https://acme.com'), p('b', 'https://acme.com/'), p('c', 'https://other.com')];
  assert.deepEqual(chooseProject(projects, 'https://acme.com/x'), { key: '', source: 'ambiguous', candidates: ['a', 'b'] });
});

test('a remembered choice that is still listed wins over a URL match', () => {
  const projects = [p('a', 'https://acme.com'), p('b')];
  assert.deepEqual(chooseProject(projects, 'https://acme.com/', 'b'), { key: 'b', source: 'remembered' });
});

test('a remembered key missing from the list (another workspace) falls back to matching', () => {
  const projects = [p('a', 'https://acme.com')];
  assert.deepEqual(chooseProject(projects, 'https://acme.com/', 'gone'), { key: 'a', source: 'matched' });
});

test('non-http tabs, empty and invalid URLs never match', () => {
  const projects = [p('a', 'https://acme.com', '', 'not a url', 'ftp://acme.com')];
  assert.deepEqual(chooseProject(projects, 'chrome://extensions'), { key: '', source: 'none' });
  assert.deepEqual(chooseProject(projects, ''), { key: '', source: 'none' });
  assert.equal(matchProjects([p('x', '', 'not a url', 'ftp://acme.com')], 'https://acme.com/').length, 0);
});

test('projects without urls or with non-string entries are skipped safely', () => {
  const projects: MatchableProject[] = [{ key: 'a' }, { key: 'b', urls: null }, { key: 'c', urls: [42, 'https://app.example.com'] }];
  assert.deepEqual(matchProjects(projects, 'https://app.example.com/x'), [{ key: 'c', tier: 3, pathScore: 0 }]);
});
