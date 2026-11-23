import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/api/requireAuth";
import { forwardToWorker } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

/** Withdraw an open invitation. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await context.params;
  const auth = await requireWorkspace(request, request.nextUrl.searchParams.get("workspaceId"));
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(
    request,
    `/assistant/workspaces/${encodeURIComponent(auth.workspaceId)}/team/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE" },
  );
}
