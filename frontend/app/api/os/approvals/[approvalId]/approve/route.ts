import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";

export async function POST(request: NextRequest, context: { params: Promise<{ approvalId: string }> }) {
  const params = await context.params;
  const approvalId = params.approvalId;
  if (!approvalId) {
    return NextResponse.json({ ok: false, error: "approvalId is required." }, { status: 400 });
  }
  // Forward request body (may contain approval notes, vote details, etc.)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const payload = await forwardToWorkerOs({
      path: `/v1/os/approvals/${encodeURIComponent(approvalId)}/approve`,
      method: "POST",
      cookieHeader: resolveWorkerCookieHeader(request),
      authorizationHeader: resolveWorkerAuthorizationHeader(request),
      ...(body ? { body } : {}),
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof WorkerProxyError) {
      return NextResponse.json(error.payload ?? { ok: false, error_code: "BACKBONE_UNAVAILABLE" }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error_code: "BACKBONE_UNAVAILABLE" }, { status: 503 });
  }
}
