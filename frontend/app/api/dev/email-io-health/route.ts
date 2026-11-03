import { NextRequest, NextResponse } from "next/server";
import type { EmailIoHealthStatus } from "@/lib/emailIoHealth";
import { runEmailIoHealthCheck } from "@/lib/emailIoHealth";

const EMAIL_IO_HEALTH_TIMEOUT_MS = 5000;

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_IO_HEALTH_TIMEOUT_MS);
  let status: EmailIoHealthStatus | null = null;
  try {
    status = await runEmailIoHealthCheck({ force, signal: controller.signal });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Health check failed";
    status = {
      ok: false,
      status: null,
      detail: message,
      timestamp: Date.now(),
      url: null,
    };
  } finally {
    clearTimeout(timer);
  }
  const payload: EmailIoHealthStatus =
    status ??
    ({
      ok: false,
      status: null,
      detail: "health check not run",
      url: null,
      timestamp: Date.now(),
    });
  return NextResponse.json({
    ok: payload.ok,
    status: payload.status ?? null,
    detail: payload.detail,
    url: payload.url,
    timestamp: payload.timestamp,
  });
}
