import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/api/requireAuth";
import { forwardToWorker, readJson } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ userId: string }> };

/** Change a member's role. */
export async function PATCH(request: NextRequest, context: Context) {
  const { userId } = await context.params;
  const body = await readJson(request);
  const auth = await requireWorkspace(request, typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(
    request,
    `/assistant/workspaces/${encodeURIComponent(auth.workspaceId)}/team/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: { role: body.role } },
  );
}

/** Remove a member (or leave the workspace yourself). */
export async function DELETE(request: NextRequest, context: Context) {
  const { userId } = await context.params;
  const auth = await requireWorkspace(request, request.nextUrl.searchParams.get("workspaceId"));
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(
    request,
    `/assistant/workspaces/${encodeURIComponent(auth.workspaceId)}/team/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}
