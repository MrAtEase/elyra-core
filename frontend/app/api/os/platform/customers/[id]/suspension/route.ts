import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOwner } from "@/lib/api/requireAuth";
import { forwardToWorker, readJson } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

const ID_RE = /^[a-f0-9-]{36}$/;

/** Suspend or reactivate a company workspace (platform owner only). */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!ID_RE.test(id)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const auth = await requirePlatformOwner(request);
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(request);
  return forwardToWorker(request, `/assistant/platform/customers/${id}/suspension`, {
    method: "PUT",
    body: { suspended: body.suspended === true, reason: typeof body.reason === "string" ? body.reason : "" },
  });
}
