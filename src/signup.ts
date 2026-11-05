// Pure helpers for the extension signup flow (status mapping, resend countdown).
import type { WorkspaceChoice } from './shared';

export type SignupStatus =
  | 'code_sent' | 'ok' | 'pending_approval' | 'pending_confirmation' | 'wrong_code' | 'code_dead'
  | 'throttled' | 'rate_limited' | 'invalid_token' | 'account_exists' | 'signup_closed' | 'already_owns' | 'email_not_verified'
  | 'invalid' | 'network'
  | 'choose-workspace' | 'mfa_required' | 'no_workspace' | 'rejected' | 'disabled';

export const RESEND_AFTER_MS = 60_000;

/** The status of an extension-signup answer: the server's `data.status`, else one derived from the HTTP status. */
export function signupStatusFromResponse(httpStatus: number, data: { status?: unknown } | null | undefined): SignupStatus {
  if (data && typeof data.status === 'string' && data.status) return data.status as SignupStatus;
  if (httpStatus === 0) return 'network';
  if (httpStatus === 409) return 'account_exists';
  if (httpStatus === 403) return 'signup_closed';
  if (httpStatus === 429) return 'rate_limited';
  return 'invalid';
}

/** Status of a /api/auth/magic/* answer, in the popup's vocabulary. */
export function magicStatusFromResponse(httpStatus: number, data: { status?: unknown; login?: { status?: unknown } | null } | null | undefined): SignupStatus {
  const s = data && typeof data.status === 'string' ? data.status : '';
  if (s === 'sent') return 'code_sent';
  if (s === 'waiting') return 'pending_confirmation';
  if (s === 'done') {
    const l = data?.login && typeof data.login.status === 'string' ? data.login.status : '';
    if (l === 'ok') return 'ok';
    if (l === 'choose-workspace') return 'choose-workspace';
    if (l === 'mfa_required') return 'mfa_required';
    if (l === 'pending') return 'pending_approval';
    if (l === 'no-workspace') return 'no_workspace';
    if (l === 'rejected') return 'rejected';
    if (l === 'disabled') return 'disabled';
    return 'invalid';
  }
  if (s === 'wrong_code' || s === 'code_dead' || s === 'invalid_token' || s === 'throttled') return s;
  if (httpStatus === 0) return 'network';
  if (httpStatus === 403) return 'signup_closed';
  if (httpStatus === 429) return 'rate_limited';
  return 'invalid';
}

/** Whole seconds left before a new code may be requested (0 when allowed). */
export function resendSecondsLeft(sentAt: number, now: number): number {
  return Math.max(0, Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000));
}

/** How long a kept sign-in outcome (workspace choice or message) is still shown when the popup reopens. */
export const AUTH_OUTCOME_TTL_MS = 10 * 60_000;

export type PendingChoice = { workspaces: WorkspaceChoice[]; selectionToken: string; email: string; at: number };

const fresh = (at: unknown, now: number): boolean =>
  typeof at === 'number' && now >= at && now - at < AUTH_OUTCOME_TTL_MS;

/** A kept "choose a workspace" outcome that is well-formed and younger than AUTH_OUTCOME_TTL_MS, else null. */
export function freshPendingChoice(v: unknown, now: number): PendingChoice | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as { workspaces?: unknown; selectionToken?: unknown; email?: unknown; at?: unknown };
  if (typeof c.selectionToken !== 'string' || !c.selectionToken) return null;
  if (!Array.isArray(c.workspaces) || c.workspaces.length === 0) return null;
  if (!fresh(c.at, now)) return null;
  return {
    workspaces: c.workspaces as WorkspaceChoice[],
    selectionToken: c.selectionToken,
    email: typeof c.email === 'string' ? c.email : '',
    at: c.at as number,
  };
}

export type AuthOutcomeKey = 'mfaOnDashboard' | 'noWorkspace' | 'accountRejected' | 'accountDisabled' | 'accountPending';

/** The popup message for a code sign-in that ended without a session; null for every other status. */
export function authOutcomeMessageKey(status: string): AuthOutcomeKey | null {
  switch (status) {
    case 'mfa_required': return 'mfaOnDashboard';
    case 'no_workspace': return 'noWorkspace';
    case 'rejected': return 'accountRejected';
    case 'disabled': return 'accountDisabled';
    case 'pending_approval': return 'accountPending';
    default: return null;
  }
}

/** A kept outcome with a message (see authOutcomeMessageKey) younger than AUTH_OUTCOME_TTL_MS, else null. */
export function freshAuthOutcome(v: unknown, now: number): { status: string; email: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { status?: unknown; email?: unknown; at?: unknown };
  if (typeof o.status !== 'string' || !authOutcomeMessageKey(o.status)) return null;
  if (!fresh(o.at, now)) return null;
  return { status: o.status, email: typeof o.email === 'string' ? o.email : '' };
}

/** "Send sign-in code" answered throttled: back to the code screen when that address still has a pending sign-in. */
export function throttledBackToCode(pending: { email: string } | null | undefined, email: string): boolean {
  return !!pending && pending.email.trim().toLowerCase() === email.trim().toLowerCase();
}
