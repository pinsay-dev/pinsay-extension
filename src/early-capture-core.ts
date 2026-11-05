// The extension's early error buffer. Runs in the PAGE's MAIN world at document_start on the sites set up in the
// extension (registered by background.ts syncEarlyCapture), so a bug report can include errors from page load on,
// long before the widget is injected (at tab 'complete') and starts its own capture.
//
// Passive by design: it only LISTENS for uncaught errors and unhandled promise rejections and keeps ≤ 50 in page
// memory. It never patches console, fetch or XHR, so on a page where no widget runs nothing the page or DevTools
// sees changes, and nothing ever leaves the page from here. The widget (pinsay-widget pagecontext.ts drainEarly)
// takes the entries when its capture starts, applies its redaction, look-back window and caps, and sets `done`.
// Failed resource loads are not recorded here: their error events carry no status; the widget reads those from the
// Performance API.
export type EarlyEntry = {
  level: 'error';
  message: string;
  stack?: string;
  occurredAt: string;
  source: 'error' | 'unhandledrejection';
};
export type EarlyState = { done: boolean; console: EarlyEntry[] };

const MAX_EARLY = 50;

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function installEarlyCapture(w: {
  __PINSAY_EARLY__?: EarlyState;
  addEventListener(type: string, fn: (e: any) => void): void;
  removeEventListener(type: string, fn: (e: any) => void): void;
}): void {
  if (w.__PINSAY_EARLY__) return;
  const state: EarlyState = { done: false, console: [] };
  w.__PINSAY_EARLY__ = state;
  const push = (message: string, stack: unknown, source: EarlyEntry['source']): void => {
    if (state.console.length >= MAX_EARLY) return;
    const entry: EarlyEntry = { level: 'error', message: message.slice(0, 2000), occurredAt: new Date().toISOString(), source };
    if (typeof stack === 'string' && stack) entry.stack = stack.slice(0, 4000);
    state.console.push(entry);
  };
  const onError = (e: any): void => {
    try {
      if (state.done) { w.removeEventListener('error', onError); return; }
      if (!e || typeof e.message !== 'string') return; // a resource load error event: no message, no status
      const err = e.error instanceof Error ? e.error : undefined;
      const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
      push(`${/^Uncaught/.test(e.message) ? '' : 'Uncaught '}${e.message || (err && err.message) || 'error'}${where}`, err?.stack, 'error');
    } catch {
      /* never let capture break the page */
    }
  };
  const onRejection = (e: any): void => {
    try {
      if (state.done) { w.removeEventListener('unhandledrejection', onRejection); return; }
      const reason = e ? e.reason : undefined;
      const err = reason instanceof Error ? reason : undefined;
      push(`Unhandled promise rejection: ${err ? err.message : str(reason)}`, err?.stack, 'unhandledrejection');
    } catch {
      /* never let capture break the page */
    }
  };
  w.addEventListener('error', onError);
  w.addEventListener('unhandledrejection', onRejection);
}
