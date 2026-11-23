import { NextResponse, type NextRequest } from "next/server";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";

/**
 * Prüft Anmeldung und Workspace-Zugriff.
 * Liefert userId und die echte Workspace-ID des Nutzers (nie einen Alias wie "ws-personal"),
 * damit Daten immer unter dem Workspace des angemeldeten Nutzers landen.
 */
export async function authorizeTasks(
  request: NextRequest,
  requestedWorkspaceId: string,
): Promise<{ userId: string | null; workspaceId: string } | NextResponse> {
  if (!requestedWorkspaceId) return NextResponse.json({ ok: false, error: "workspaceId ist erforderlich." }, { status: 400 });
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok || !who.payload) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  const workspaces = (who.payload.workspaces ?? []) as Array<{ id: string; slug?: string; type?: string }>;
  const workspaceId = resolveCanonicalWorkspaceId(requestedWorkspaceId, workspaces);
  if (!workspaceId || !workspaces.some((w) => w.id === workspaceId) || !hasWorkspaceAccess(who.payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "Kein Zugriff auf diesen Workspace." }, { status: 403 });
  }
  return { userId: getWhoamiUserId(who.payload), workspaceId };
}
