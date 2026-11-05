// Builds all three targets and zips them, plus the AMO source archive. Needs the `zip` CLI and git.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const version = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')).version;
const outputs = [];
const report = (zip) => {
  outputs.push(zip);
  console.log(`  ${zip} (${(statSync(resolve(root, zip)).size / 1024).toFixed(1)} KB)`);
};

for (const [target, { dir }] of Object.entries(TARGETS)) {
  run('node', ['build.mjs', '--target', target]);
  const zip = `pinsay-ext-${target}-${version}.zip`;
  rmSync(resolve(root, zip), { force: true });
  run('zip', ['-qr', `../${zip}`, '.', '-x', '.DS_Store'], { cwd: resolve(root, dir) });
  report(zip);
}

// Source archive: tracked files of this folder (minus store-assets and zips) + vendored snapdom + build notes.
const sourceZip = `pinsay-ext-source-${version}.zip`;
const tmp = mkdtempSync(resolve(tmpdir(), 'pinsay-ext-src-'));
try {
  const tarPath = resolve(tmp, 'src.zip');
  run('git', ['archive', '--format=zip', '-o', tarPath, 'HEAD', '--', '.', ':!store-assets', ':!*.zip']);
  const extra = resolve(tmp, 'extra');
  mkdirSync(resolve(extra, 'vendor-src'), { recursive: true });
  copyFileSync(resolve(root, '..', 'API', 'wwwroot', 'vendor', 'snapdom.js'), resolve(extra, 'vendor-src', 'snapdom.js'));
  writeFileSync(resolve(extra, 'SOURCE-BUILD.md'), `# Building PinSay ${version} from source

Requirements: Node >= 22 and npm.

\`\`\`bash
npm ci
node build.mjs --target firefox   # → dist-firefox/ (the submitted add-on)
\`\`\`

\`vendor-src/snapdom.js\` is the bundled snapdom screenshot library (copied unchanged into
\`dist-firefox/vendor/snapdom.js\`). Other targets: \`--target chrome\` → dist/, \`--target edge\` → dist-edge/.
`);
  // git archive paths are relative to the cwd subfolder, so this zip's root is the extension folder.
  const finalZip = resolve(root, sourceZip);
  rmSync(finalZip, { force: true });
  copyFileSync(tarPath, finalZip);
  run('zip', ['-qr', finalZip, 'vendor-src', 'SOURCE-BUILD.md', '-x', '.DS_Store'], { cwd: extra });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
report(sourceZip);
console.log(`✓ packaged ${outputs.length} zips`);
