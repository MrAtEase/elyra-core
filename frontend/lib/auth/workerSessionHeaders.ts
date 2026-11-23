import type { NextRequest } from "next/server";

export function resolveWorkerCookieHeader(request: NextRequest): string | null {
  const provided = request.headers.get("cookie");
  if (provided && provided.trim()) return provided;
  const sessionCookie = request.cookies.get("mf-s");
  if (sessionCookie?.value) return `mf-s=${sessionCookie.value}`;
  return null;
}

export function resolveWorkerAuthorizationHeader(request: NextRequest): string | null {
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!auth) return null;
  const trimmed = auth.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveWorkerSessionHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const cookie = resolveWorkerCookieHeader(request);
  const authorization = resolveWorkerAuthorizationHeader(request);
  const workspaceId = request.headers.get("x-workspace-id");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  if (workspaceId && workspaceId.trim()) headers.set("x-workspace-id", workspaceId.trim());
  return headers;
}
