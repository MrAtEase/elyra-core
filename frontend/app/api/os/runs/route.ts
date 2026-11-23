import { NextRequest, NextResponse } from "next/server";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader } from "@/lib/auth/workerSessionHeaders";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  try {
    const payload = await forwardToWorkerOs({
      path: `/v1/os/runs${query ? `?${query}` : ""}`,
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

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const payload = await forwardToWorkerOs({
      path: "/v1/os/runs",
      method: "POST",
      cookieHeader: resolveWorkerCookieHeader(request),
      authorizationHeader: resolveWorkerAuthorizationHeader(request),
      body: body ?? {},
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof WorkerProxyError) {
      return NextResponse.json(error.payload ?? { ok: false, error_code: "BACKBONE_UNAVAILABLE" }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error_code: "BACKBONE_UNAVAILABLE" }, { status: 503 });
  }
}
