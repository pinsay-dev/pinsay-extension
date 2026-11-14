// Tells the PinSay dashboard this extension is installed, and relays its guide-start message. No token,
// key or password crosses this bridge: only a project key, a project name and a site origin.
import { parseGuideStart } from './guide';

document.documentElement.setAttribute('data-pinsay-extension', chrome.runtime.getManifest().version);
window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const guide = parseGuideStart(e.data, Date.now());
  if (guide) void chrome.runtime.sendMessage({ type: 'guideStart', guide });
});
