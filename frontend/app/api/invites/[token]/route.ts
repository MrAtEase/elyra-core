import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { forwardToWorker } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** What an invitation is for (only shown to the invited account). */
export async function GET(request: NextRequest, context: Context) {
  const { token } = await context.params;
  if (!TOKEN_RE.test(token)) return NextResponse.json({ ok: false, error: "invite_invalid" }, { status: 404 });
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(request, `/assistant/invites/${token}`, { method: "GET" });
}

/** Accept the invitation and join the workspace. */
export async function POST(request: NextRequest, context: Context) {
  const { token } = await context.params;
  if (!TOKEN_RE.test(token)) return NextResponse.json({ ok: false, error: "invite_invalid" }, { status: 404 });
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(request, `/assistant/invites/${token}/accept`, { method: "POST" });
}
