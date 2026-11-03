import { getApiOrigin } from "@/lib/env";

const DEFAULT_WORKSPACE_PATH = "/os";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function startGoogleOAuth(next: string = DEFAULT_WORKSPACE_PATH) {
  // Guard 1: must run in browser
  if (typeof window === "undefined") {
    throw new Error("startGoogleOAuth must be called in the browser");
  }

  // Guard 2: next must be a path-only value
  if (!next.startsWith("/")) {
    console.warn("[OAuth] Invalid next, falling back:", next);
    next = DEFAULT_WORKSPACE_PATH;
  }

  const currentOrigin = window.location.origin;
  const currentHost = window.location.hostname;
  // Keep local preview/dev auth flows on the same host (3000/3100) so users never jump to production.
  const url = isLocalHost(currentHost)
    ? `${currentOrigin}/api/google/connect?next=${encodeURIComponent(next)}&return_origin=${encodeURIComponent(currentOrigin)}`
    : `${getApiOrigin()}/assistant/oauth/google/start?next=${encodeURIComponent(next)}`;

  // Guard 3: enforce full redirect (no SPA router.push)
  window.location.href = url;
}
