import type { ProxyRequest } from './shared';
type Upload = Extract<ProxyRequest, { kind: 'upload' }>;
/** The multipart body the background sends for a proxied upload. With `fields` (current bridge): every string
 *  field, then the file (when any) under its own field name. Without (older shape): `file` + `project`. */
export function uploadForm(msg: Upload): FormData {
  const fd = new FormData();
  const file = () => new Blob([Uint8Array.from(atob(msg.base64), (c) => c.charCodeAt(0))], { type: msg.contentType });
  if (msg.fields) {
    for (const [k, v] of Object.entries(msg.fields)) fd.append(k, v);
    if (msg.base64) fd.append(msg.fileField || 'file', file(), msg.filename);
    return fd;
  }
  fd.append('file', file(), msg.filename);
  fd.append('project', msg.project);
  return fd;
}
