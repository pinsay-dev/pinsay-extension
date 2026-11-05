// Shared constants + message contracts used across background / content / popup.

// The one PinSay server this extension talks to (no server choice since 0.4.0, same rule as the
// CLI). To bring a choice back, read it here — every caller uses this constant.
export const SERVER = 'https://app.pinsay.dev';

// storage.session holds the JWT (cleared when the browser closes / SW restarts
// keeps it for the session). storage.local holds non-secret prefs.
export const SESSION_KEYS = {
  token: 'token',
  pendingChoice: 'pendingChoice', // { workspaces, selectionToken, email, at } a code sign-in that ended in "choose a workspace" (10 min)
  authOutcome: 'authOutcome', // { status, email, at } a code sign-in that ended without a session; shown once by the popup
} as const;
export const LOCAL_KEYS = {
  user: 'user',
  projectByDomain: 'projectByDomain', // { [hostname]: projectKey }
  pendingSignup: 'pendingSignup', // { pendingToken, email, sentAt, flow: 'sign-in' | 'sign-up' } while a magic-link sign-in / sign-up waits for its confirmation
  postSignup: 'postSignup', // { at } after a fresh sign-up, until the first activation
  visitorByDomain: 'visitorByDomain', // { [hostname]: { project } } sites activated in visitor mode (no team session)
} as const;
/** Where versions before 0.4.0 stored a user-chosen server; deleted on update (see background.ts). */
export const LEGACY_SERVER_KEY = 'server';

// Placeholder token injected into the PAGE so the widget runs authenticated
// without ever seeing the real JWT — the background swaps in the real token on
// every proxied request. Must be truthy.
export const PROXY_TOKEN = '__pinsay_via_proxy__';

export type WorkspaceChoice = {
  workspaceId: string;
  name: string;
  roleName?: string;
  isAdmin?: boolean;
  isHome?: boolean;
};

export type StoredUser = {
  /** Opaque account id — lets the widget recognise the viewer's own comments (verify buttons). */
  id?: string;
  displayName?: string;
  email?: string;
  roleName?: string;
  tenantName?: string;
  workspaceId?: string;
  workspaces?: WorkspaceChoice[];
  /** True for workspace admins (Role.GrantsAdmin) — gates the popup's "+ Add project" affordance. */
  isAdmin?: boolean;
  /**
   * True for platform super admins, who own no tenant/workspace of their own. GET /api/admin/projects
   * returns a cross-tenant, platform-wide list for them (by design, for platform management) — so the
   * project picker must never be shown to them: it would list every tenant's projects side by side
   * (looking like duplicates) and activation always 404s regardless of which one is picked, since
   * ProjectService.EnsureAsync explicitly refuses to resolve any project by key for a super admin.
   */
  isSuperAdmin?: boolean;
  /**
   * True for quick-access (Client) accounts. They're barred from GET /api/admin/projects (a
   * browse/manage operation) so the popup must resolve their project by matching the current tab's
   * origin against their tenant's Project.AppUrl instead of listing — see 'projectForOrigin'.
   */
  isQuickAccess?: boolean;
};

/** A project the signed-in user can target, from GET /api/admin/projects. */
export type ExtProject = {
  key: string;
  name: string;
  isActive: boolean;
  /**
   * Every URL the project is registered under: its active environment URLs (`appUrls`) plus the legacy
   * `appUrl`. The popup matches the tab against these to preselect a project (see match.ts).
    */
  urls: string[];
};

/** A workspace environment a new project's site URL can be filed under (GET /api/admin/environments). */
export type ExtEnvironment = { id: number; name: string };

// popup/options -> background
export type BgRequest =
  | { type: 'getState' }
  | { type: 'getTabState'; tabId: number; hostname: string }
  | { type: 'login'; email: string; password: string }
  | { type: 'switchWorkspace'; workspaceId: string; selectionToken?: string }
  | { type: 'logout' }
  | { type: 'setProjectForDomain'; hostname: string; project: string }
  | { type: 'listProjects' }
  | { type: 'projectForOrigin'; origin: string }
  | { type: 'createProject'; name: string; appUrl: string; appEnvironmentId: number | null; takenKeys: string[] }
  | { type: 'listEnvironments' }
  | { type: 'activate'; tabId: number; hostname: string; origin: string; project: string; environment: string }
  | { type: 'stageActivation'; tabId: number; hostname: string; origin: string; project: string; environment: string }
  | { type: 'redeemInvite'; token: string; url: string; tabId: number }
  | { type: 'deactivate'; tabId: number }
  | { type: 'visitorProjectForOrigin'; origin: string }
  | { type: 'activateVisitor'; tabId: number; hostname: string; origin: string; project: string; entry: 'leave' | 'track' }
  | { type: 'activateUnclaimed'; tabId: number; origin: string }
  | { type: 'signupEnabled' }
  | { type: 'extMagicSignIn'; email: string }
  | { type: 'extSignup'; displayName: string; email: string }
  | { type: 'extVerifyCode'; code: string }
  | { type: 'extResendCode' }
  | { type: 'extPollSession' }
  | { type: 'extForgetSignup' }
  | { type: 'clearAuthOutcome' }
  | { type: 'extFirstWorkspace'; name?: string }
  | { type: 'clearPostSignup' };

// page (MAIN world, via content bridge) -> background: proxied API traffic
export type ProxyRequest =
  | { source: 'pinsay-ext'; kind: 'fetch'; id: number; url: string; method: string; headers: Record<string, string>; body: string | null; auth: boolean }
  | { source: 'pinsay-ext'; kind: 'upload'; id: number; url: string; base64: string; filename: string; contentType: string; project: string; fields?: Record<string, string>; fileField?: string; auth?: string | null }
  | { source: 'pinsay-ext'; kind: 'capture'; id: number };

export type ProxyResponse = {
  ok: boolean;
  status: number;
  body: string;
  contentType: string | null;
};

export function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}
