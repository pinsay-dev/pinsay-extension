/** The Authorization header a proxied request carries. The extension's own token always wins and the page's header
 *  is dropped (the real JWT never meets page-supplied auth). With no extension token — a signed-out visitor on a
 *  visitor-enabled site — the page's own header (the widget's visitor token) is forwarded unchanged, which is no
 *  more than the page could send by itself. */
export function proxyAuthorization(extToken: string | null, pageAuth: string | null | undefined): string | null {
  if (extToken) return `Bearer ${extToken}`;
  const v = (pageAuth || '').trim();
  return /^Bearer [A-Za-z0-9._~+/=-]{10,4096}$/.test(v) ? v : null;
}
