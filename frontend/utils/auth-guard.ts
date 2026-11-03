import { safeNext } from '../lib/safeNext';
import { getApiOrigin } from "@/lib/env";

/* ------------------------------------------------------------------ */
/* Public API helpers */
/* ------------------------------------------------------------------ */

export function getAssistantBaseUrl() {
  return getApiOrigin().replace(/\/+$/, '');
}

/* ------------------------------------------------------------------ */
/* API endpoint builder (FETCH ONLY – NOT OAUTH) */
/* ------------------------------------------------------------------ */

export function buildAssistantEndpoint(path: string) {
  const origin = getAssistantBaseUrl();

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}

/* ------------------------------------------------------------------ */
/* OAuth – ABSOLUTE ONLY (NO FALLBACKS) */
/* ------------------------------------------------------------------ */
export function getOAuthStartEndpoint() {
  return `${getApiOrigin()}/assistant/oauth/google/start`;
}

export function buildOAuthStart(nextUrl?: string | null) {
  const nextPath = safeNext(nextUrl ?? null, '/os');
  return `${getOAuthStartEndpoint()}?next=${encodeURIComponent(nextPath)}`;
}

/* ------------------------------------------------------------------ */
/* Auth / session endpoints */
/* ------------------------------------------------------------------ */

export function getWhoamiEndpoint() {
  return buildAssistantEndpoint('/assistant/auth/whoami');
}

export function getLogoutEndpoint() {
  return buildAssistantEndpoint('/assistant/auth/logout');
}

/* ------------------------------------------------------------------ */
/* Workspace endpoints */
/* ------------------------------------------------------------------ */

export function getWorkspacesActiveEndpoint() {
  return buildAssistantEndpoint('/assistant/workspaces/active');
}

export function getWorkspacesCreateEndpoint() {
  return buildAssistantEndpoint('/assistant/workspaces/create');
}

export function getOnboardingCompleteEndpoint() {
  return buildAssistantEndpoint('/assistant/onboarding/complete');
}

export function getThemeUpdateEndpoint() {
  return buildAssistantEndpoint('/assistant/settings/theme');
}

export function getLanguageUpdateEndpoint() {
  return buildAssistantEndpoint('/assistant/settings/language');
}

export function getWorkspaceIdentityEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}`);
}

export function getWorkspaceProfileEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/profile`);
}

export function getWorkspaceThemeDefaultEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/settings/theme-default`);
}

export function getWorkspaceMembersEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/members`);
}

export function getWorkspaceInvitesEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/invites`);
}

export function getWorkspaceMemberRoleEndpoint(workspaceId: string, memberId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/members/${memberId}/role`);
}

export function getWorkspaceMemberDeactivateEndpoint(workspaceId: string, memberId: string) {
  return buildAssistantEndpoint(
    `/assistant/workspaces/${workspaceId}/members/${memberId}/deactivate`
  );
}

export function getWorkspaceInternalMemberEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/members/internal`);
}

export function getWorkspaceModulesEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/modules`);
}

export function getWorkspaceConnectionsEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/connections`);
}

export function getWorkspaceConnectionsConnectEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/connections/connect`);
}

export function getWorkspaceConnectionsDisconnectEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/connections/disconnect`);
}

export function getWorkspaceConnectionsSwitchEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/connections/switch`);
}

export function getAccessRequestsEndpoint() {
  return buildAssistantEndpoint('/assistant/access-requests');
}

export function getWorkspaceAccessRequestsEndpoint(workspaceId: string) {
  return buildAssistantEndpoint(`/assistant/workspaces/${workspaceId}/access-requests`);
}

export function getAccessRequestDecisionEndpoint(requestId: string) {
  return buildAssistantEndpoint(`/assistant/access-requests/${requestId}/decision`);
}

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

const OAUTH_SEGMENT = '/assistant/oauth/';

export function isOAuthPath(url?: string) {
  if (!url) return false;
  return url.includes(OAUTH_SEGMENT);
}

function appendNextQueryParam(loginUrl: string, nextUrl: string) {
  try {
    const parsed = new URL(loginUrl);
    parsed.searchParams.set('next', nextUrl);
    return parsed.toString();
  } catch {
    const separator = loginUrl.includes('?') ? '&' : '?';
    return `${loginUrl}${separator}next=${encodeURIComponent(nextUrl)}`;
  }
}

export function buildLoginRedirectUrl(loginUrl?: string | null, nextUrl?: string | null) {
  const trimmedNext = nextUrl?.trim();
  const trimmedLoginUrl = loginUrl?.trim();
  const fallbackLoginUrl = "/signin";

  if (!trimmedNext) {
    return trimmedLoginUrl || fallbackLoginUrl;
  }

  if (trimmedLoginUrl) {
    return appendNextQueryParam(trimmedLoginUrl, safeNext(trimmedNext, '/os'));
  }

  return appendNextQueryParam(fallbackLoginUrl, safeNext(trimmedNext, '/os'));
}
