import type { FastifyInstance } from "fastify";
import { AppError, ValidationError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { getTokens } from "../db/repos/token-vault.js";

const GOOGLE_GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function parseScopeString(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function deriveInitials(email: string | null): string {
  if (!email) return "EC";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (
      `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase() || "EC"
    );
  }
  return local.slice(0, 2).toUpperCase() || "EC";
}

export async function googleStatusRoutes(app: FastifyInstance) {
  app.get("/v1/google/status", async (request) => {
    const query = request.query as { workspaceId?: string } | undefined;
    const requestedWorkspaceId = query?.workspaceId?.trim() ?? "";
    if (!requestedWorkspaceId) {
      throw new ValidationError("workspaceId is required");
    }

    const authRequest = request as AuthenticatedRequest;
    const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(
      authRequest.userId,
      requestedWorkspaceId,
    );
    if (!authorizedWorkspaceId) {
      throw new AppError("workspace_not_accessible", 403, "workspace_not_accessible");
    }

    const tokens = await getTokens(authorizedWorkspaceId);
    const scopes = parseScopeString(tokens?.scopes);
    const connected = Boolean(tokens?.refreshToken);

    return {
      ok: true,
      user: {
        id: authRequest.userId,
        email: tokens?.accountEmail ?? null,
        avatarUrl: null,
        initials: deriveInitials(tokens?.accountEmail ?? null),
      },
      workspace: {
        id: authorizedWorkspaceId,
        name: authorizedWorkspaceId,
        slug: authorizedWorkspaceId,
      },
      google: {
        connected,
        scopes,
        accountEmail: tokens?.accountEmail ?? null,
        hasGmailRead: scopes.includes(GOOGLE_GMAIL_READONLY_SCOPE),
        hasCalendarRead: scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE),
        hasCalendarWrite: scopes.includes(GOOGLE_CALENDAR_EVENTS_SCOPE),
        config: {
          ready: true,
          issues: [],
        },
        error: null,
      },
    };
  });
}
