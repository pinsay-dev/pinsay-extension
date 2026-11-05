// Which browser, store build and version this copy of the extension is — sent with every activation so the
// server can count extension use per browser/store/version (SPEC 2026-10-10 criteria 28, 33). No page data.

export type ExtBrowser = 'chrome' | 'edge' | 'firefox' | 'other-chromium';
export type ExtStore = 'chrome-web-store' | 'edge-addons' | 'firefox-addons' | 'unpacked';
export const EXT_STORES: readonly ExtStore[] = ['chrome-web-store', 'edge-addons', 'firefox-addons', 'unpacked'];

// Replaced at build time by esbuild `define` (build.mjs --target). Absent in unit tests → Chrome Web Store.
declare const __PINSAY_STORE__: ExtStore | undefined;
export const BUILD_STORE: ExtStore =
  typeof __PINSAY_STORE__ !== 'undefined' && __PINSAY_STORE__ ? __PINSAY_STORE__ : 'chrome-web-store';

/**
 * The browser, from User-Agent Client Hints brands when the browser has them (Chromium), else the UA string.
 * A Chrome-store build running in Edge reports `edge` (criterion 28).
 */
export function detectBrowser(brands: readonly string[] | null | undefined, ua: string): ExtBrowser {
  const b = (brands ?? []).map((x) => x.toLowerCase());
  if (b.length > 0) {
    if (b.includes('microsoft edge')) return 'edge';
    if (b.includes('google chrome')) return 'chrome';
    return 'other-chromium';
  }
  if (/\bEdg\//.test(ua)) return 'edge';
  if (/\bFirefox\//.test(ua)) return 'firefox';
  if (/\b(OPR|Brave|Vivaldi|YaBrowser|SamsungBrowser)\//.test(ua)) return 'other-chromium';
  if (/\bChrome\//.test(ua)) return 'chrome';
  return 'other-chromium';
}

/** `unpacked` for a developer-loaded copy, else the store this build was made for. */
export function detectStore(build: ExtStore, installType: string | undefined): ExtStore {
  return installType === 'development' ? 'unpacked' : build;
}

export type ExtEnv = { browser: ExtBrowser; store: ExtStore; version: string };

/** Runtime facts for the activation report. Never throws: unknown parts fall back to safe values. */
export async function extensionEnv(): Promise<ExtEnv> {
  const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  const brands = nav.userAgentData?.brands?.map((x) => x.brand) ?? null;
  let installType: string | undefined;
  try { installType = (await chrome.management.getSelf()).installType; } catch { installType = undefined; }
  let version = '';
  try { version = chrome.runtime.getManifest().version; } catch { version = ''; }
  return { browser: detectBrowser(brands, navigator.userAgent || ''), store: detectStore(BUILD_STORE, installType), version };
}
