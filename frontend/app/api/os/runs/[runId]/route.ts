import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const params = await context.params;
  try {
    const payload = await forwardToWorkerOs({
      path: `/v1/os/runs/${encodeURIComponent(params.runId)}`,
      method: "GET",
      cookieHeader: resolveWorkerCookieHeader(request),
      authorizationHeader: resolveWorkerAuthorizationHeader(request),
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof WorkerProxyError) {
      return NextResponse.json(error.payload ?? { ok: false, error_code: "BACKBONE_UNAVAILABLE" }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error_code: "BACKBONE_UNAVAILABLE" }, { status: 503 });
  }
}
