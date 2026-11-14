// Bundles the extension's TS entry points into dist/ and copies static assets.
// Mirrors web-component/build.mjs (esbuild, no runtime deps).
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, manifestFor } from './scripts/manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const STATIC = ['popup.html'];
const ICONS = ['16.png', '32.png', '48.png', '128.png'];
// Which browser/store this build is for (the store is reported on activation, see src/env.ts).
const targetArgIdx = process.argv.indexOf('--target');
const TARGET = targetArgIdx > -1 ? process.argv[targetArgIdx + 1] : 'chrome';
if (!Object.hasOwn(TARGETS, TARGET)) {
  console.error(`✗ --target must be one of ${Object.keys(TARGETS).join(', ')} (got ${TARGET})`);
  process.exit(1);
}
const { dir: OUT_DIR, store: STORE, esbuildTarget } = TARGETS[TARGET];
const OUT = resolve(here, OUT_DIR);
// widget.js/widget.css load LIVE from the server (see src/inject-main.ts) — a plain page-context
// <script src>/<link>, same as the non-extension embed, not extension-privileged code. Only snapdom
// (screenshot capture, changes rarely) stays bundled from the API's wwwroot.
const WWWROOT = resolve(here, '..', 'API', 'wwwroot');
// The source archive (AMO review) and the public repo have no API folder: they use vendor-src/snapdom.js
// (in the public repo, fetched once from the server; see README § Build from source).
const SNAPDOM = [resolve(WWWROOT, 'vendor', 'snapdom.js'), resolve(here, 'vendor-src', 'snapdom.js')].find(existsSync);
if (!SNAPDOM) {
  console.error(
    '✗ vendor-src/snapdom.js is missing (the screenshot library). Fetch it once:\n' +
      '  mkdir -p vendor-src && curl -fsSL -o vendor-src/snapdom.js https://app.pinsay.dev/vendor/snapdom.js',
  );
  process.exit(1);
}

function copyStatic() {
  for (const f of STATIC) copyFileSync(resolve(here, f), resolve(OUT, f));
  const base = JSON.parse(readFileSync(resolve(here, 'manifest.json'), 'utf8'));
  writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifestFor(TARGET, base), null, 2) + '\n');
  mkdirSync(resolve(OUT, 'vendor'), { recursive: true });
  copyFileSync(SNAPDOM, resolve(OUT, 'vendor', 'snapdom.js'));
  mkdirSync(resolve(OUT, 'icons'), { recursive: true });
  for (const i of ICONS) copyFileSync(resolve(here, 'icons', i), resolve(OUT, 'icons', i));
}

const options = {
  entryPoints: {
    background: resolve(here, 'src/background.ts'),
    'content-bridge': resolve(here, 'src/content-bridge.ts'),
    'early-capture': resolve(here, 'src/early-capture.ts'),
    popup: resolve(here, 'src/popup.ts'),
    presence: resolve(here, 'src/presence.ts'),
  },
  outdir: OUT,
  bundle: true,
  format: 'iife',
  target: [esbuildTarget],
  legalComments: 'none',
  logLevel: 'info',
  define: { __PINSAY_STORE__: JSON.stringify(STORE) },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  console.log(`✓ watching extension/src → ${OUT_DIR}/ (${STORE}, static copied once)`);
} else {
  await esbuild.build(options);
  copyStatic();
  console.log(`✓ extension → ${OUT_DIR}/ (${STORE})`);
}
