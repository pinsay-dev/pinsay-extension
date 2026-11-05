// Per-browser manifests, generated from the one manifest.json (source of truth for version, name, permissions).
export const TARGETS = {
  chrome: { dir: 'dist', store: 'chrome-web-store', esbuildTarget: 'chrome110' },
  edge: { dir: 'dist-edge', store: 'edge-addons', esbuildTarget: 'chrome110' },
  firefox: { dir: 'dist-firefox', store: 'firefox-addons', esbuildTarget: 'firefox140' },
};

export function manifestFor(target, base) {
  if (target !== 'firefox') return structuredClone(base);
  const { background, ...rest } = structuredClone(base);
  return {
    ...rest,
    // Firefox MV3 has no service worker: the background runs as an event page.
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'pinsay@pinsay.dev',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['authenticationInfo', 'personallyIdentifyingInfo', 'websiteActivity', 'websiteContent'],
        },
      },
    },
  };
}
