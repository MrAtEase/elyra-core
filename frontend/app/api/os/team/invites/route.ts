import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/api/requireAuth";
import { forwardToWorker, readJson } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

/** Invite a person by email. The response contains the one-time link token. */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const auth = await requireWorkspace(request, typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(request, `/assistant/workspaces/${encodeURIComponent(auth.workspaceId)}/team/invites`, {
    method: "POST",
    body: { email: body.email, role: body.role },
  });
}
