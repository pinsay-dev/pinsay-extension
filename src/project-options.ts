// The popup's project <select>: option text is the project NAME only, never its key. No chrome APIs
// and no imports, so it is unit-tested with node:test (see test/project-options.test.ts).

export type OptionProject = { key: string; name: string; urls?: string[] };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function hostOf(url: string | undefined): string {
  if (!url) return '';
  try { return new URL(url).host; } catch { return ''; }
}

/** The text shown for each project. Two projects with the same name get their site host appended
 * (the API's project payload carries no workspace or environment name), a counter if that is not enough. */
export function projectLabels(projects: OptionProject[]): string[] {
  const count = new Map<string, number>();
  for (const p of projects) count.set(p.name, (count.get(p.name) || 0) + 1);
  const labels = projects.map((p) => {
    if ((count.get(p.name) || 0) < 2) return p.name;
    const host = hostOf(p.urls?.[0]);
    return host ? `${p.name} · ${host}` : p.name;
  });
  const seen = new Map<string, number>();
  for (const l of labels) seen.set(l, (seen.get(l) || 0) + 1);
  const used = new Map<string, number>();
  return labels.map((l) => {
    if ((seen.get(l) || 0) < 2) return l;
    const n = (used.get(l) || 0) + 1;
    used.set(l, n);
    return `${l} (${n})`;
  });
}

/** The <option> list in the given order. Nothing is preselected unless `selectedKey` is a listed
 * project; then a blank option stands in, so the box never silently shows a wrong project. */
export function projectOptionsHtml(ordered: OptionProject[], selectedKey: string): string {
  const labels = projectLabels(ordered);
  const hasSelected = ordered.some((p) => p.key === selectedKey);
  const blank = hasSelected ? '' : '<option value="" selected></option>';
  return blank + ordered
    .map((p, i) => `<option value="${esc(p.key)}"${hasSelected && p.key === selectedKey ? ' selected' : ''}>${esc(labels[i])}</option>`)
    .join('');
}
