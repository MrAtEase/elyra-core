import { NextResponse, type NextRequest } from "next/server";
import { buildAssistantEndpoint } from "@/utils/auth-guard";
import { resolveWorkerCookieHeader } from "@/lib/api/whoamiClient";

/**
 * Forwards an already-authorised request to the worker with the caller's own session.
 * The worker checks membership and roles again; this proxy never adds privileges.
 */
export async function forwardToWorker(
  request: NextRequest,
  path: string,
  init: { method: string; body?: unknown },
): Promise<NextResponse> {
  const headers = new Headers({ accept: "application/json" });
  const cookie = resolveWorkerCookieHeader(request);
  if (cookie) headers.set("cookie", cookie);
  const authorization = request.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  if (init.body !== undefined) headers.set("content-type", "application/json");

  try {
    const response = await fetch(buildAssistantEndpoint(path), {
      method: init.method,
      headers,
      cache: "no-store",
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return NextResponse.json(payload ?? { ok: false, error: "UPSTREAM_INVALID" }, { status: response.status });
  } catch {
    return NextResponse.json(
      { ok: false, error: "UPSTREAM_UNAVAILABLE", message: "Der Dienst ist gerade nicht erreichbar." },
      { status: 502 },
    );
  }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
