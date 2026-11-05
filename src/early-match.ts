/** Match patterns for the early-capture script: both schemes for every set-up hostname (patterns carry no port,
 *  so `localhost` covers every local port). Invalid or empty hostnames are skipped; output is sorted, no repeats. */
export function earlyCaptureMatches(hosts: string[]): string[] {
  const out = new Set<string>();
  for (const h of hosts) {
    const host = String(h || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) continue;
    out.add(`https://${host}/*`);
    out.add(`http://${host}/*`);
  }
  return [...out].sort();
}

/** True when the registered script's patterns equal the wanted ones (order ignored), so no re-registration is needed. */
export function sameMatches(registered: string[] | undefined, wanted: string[]): boolean {
  const a = [...(registered ?? [])].sort();
  const b = [...wanted].sort();
  return a.length === b.length && a.every((m, i) => m === b[i]);
}
