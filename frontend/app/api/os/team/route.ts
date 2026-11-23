import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/api/requireAuth";
import { forwardToWorker } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

/** Members, open invitations and recent team activity of a workspace. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspace(request, request.nextUrl.searchParams.get("workspaceId"));
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(request, `/assistant/workspaces/${encodeURIComponent(auth.workspaceId)}/team`, { method: "GET" });
}
