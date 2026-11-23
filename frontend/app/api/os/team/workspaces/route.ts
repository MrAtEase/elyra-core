import { NextResponse, type NextRequest } from "next/server";
import { requireUser, requireWorkspace } from "@/lib/api/requireAuth";
import { forwardToWorker, readJson } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

/** Create a company workspace. The creator becomes its owner. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (name.length < 2) {
    return NextResponse.json({ ok: false, error: "invalid_name", message: "Bitte einen Namen angeben." }, { status: 400 });
  }
  return forwardToWorker(request, "/assistant/workspaces/create", { method: "POST", body: { name, type: "company" } });
}

/** Delete a company workspace (owner only, confirmed by typing its name). */
export async function DELETE(request: NextRequest) {
  const body = await readJson(request);
  const auth = await requireWorkspace(request, typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(request, `/assistant/workspaces/${encodeURIComponent(auth.workspaceId)}/team/workspace`, {
    method: "DELETE",
    body: { confirmName: body.confirmName },
  });
}
