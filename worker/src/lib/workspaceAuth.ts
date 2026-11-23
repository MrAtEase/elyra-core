/**
 * Workspace authorization for /assistant/workspaces/:workspaceId/*
 * IMPORTANT:
 * - Do NOT require requestedWorkspaceId === session.activeWorkspaceId
 * - Allow if workspaceId is in memberships (or session workspaces fallbacks)
 * - No secrets in logs
 */

export function isWorkspaceMember(
  session: any,
  memberships: any[] | undefined,
  workspaceId: string
): boolean {
  if (!session || !workspaceId) return false;

  // 1) Primary: memberships array (DB/session derived; entries may have workspace.id)
  if (Array.isArray(memberships)) {
    const ok = memberships.some((entry: any) => {
      if (!entry) return false;
      if (typeof entry === "string") return entry === workspaceId;
      if (entry?.workspace?.id === workspaceId) return true;
      if (entry?.id === workspaceId) return true;
      return false;
    });
    if (ok) return true;
  }

  // 2) Fallback: session.workspaces (ids OR objects with id)
  const s1 = Array.isArray(session.workspaces) ? session.workspaces : [];
  if (s1.some((w: any) => (typeof w === "string" ? w === workspaceId : w?.id === workspaceId))) {
    return true;
  }

  // 3) Fallbacks: session.user?.workspaces / session.session?.workspaces
  const s2 = Array.isArray(session?.user?.workspaces) ? session.user.workspaces : [];
  if (s2.some((w: any) => (typeof w === "string" ? w === workspaceId : w?.id === workspaceId))) {
    return true;
  }

  const s3 = Array.isArray(session?.session?.workspaces) ? session.session.workspaces : [];
  if (s3.some((w: any) => (typeof w === "string" ? w === workspaceId : w?.id === workspaceId))) {
    return true;
  }

  return false;
}

export function unauthorizedWorkspaceResponse(args: {
  workspaceId: string;
  sessionActiveWorkspaceId: string | null;
  sessionWorkspaceCount: number;
}): Response {
  console.warn("[worker-auth] workspace unauthorized", {
    workspaceId: args.workspaceId,
    sessionActiveWorkspaceId: args.sessionActiveWorkspaceId,
    sessionWorkspaceCount: args.sessionWorkspaceCount,
  });

  return new Response(
    JSON.stringify({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Worker session missing or not authorized",
    }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
}
