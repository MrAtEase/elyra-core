import type { NextRequest } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

const WHOAMI_CACHE_TTL_MS = 5_000;

type WhoamiCacheEntry = {
  expiresAt: number;
  responseMeta: {
    ok: boolean;
    status: number;
  };
  payload: WhoamiResponse | null;
};

const whoamiCache = new Map<string, WhoamiCacheEntry>();
const whoamiInflight = new Map<string, Promise<WhoamiCacheEntry>>();

export function resolveWorkerCookieHeader(request: NextRequest): string | null {
  const provided = request.headers.get("cookie");
  if (provided && provided.trim()) {
    return provided;
  }
  const sessionCookie = request.cookies.get("mf-s");
  if (sessionCookie?.value) {
    return `mf-s=${sessionCookie.value}`;
  }
  return null;
}

export async function fetchWhoamiPayload(request: NextRequest) {
  const headers = new Headers();
  const cookieHeader = resolveWorkerCookieHeader(request);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  const authHeader =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (authHeader && authHeader.trim()) {
    headers.set("authorization", authHeader.trim());
  }
  const workspaceId = request.headers.get("x-workspace-id");
  if (workspaceId && workspaceId.trim()) {
    headers.set("x-workspace-id", workspaceId.trim());
  }
  const cacheKey = [
    cookieHeader ?? "",
    authHeader?.trim() ?? "",
    workspaceId?.trim() ?? "",
  ].join("::");
  const cached = whoamiCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      response: new Response(null, {
        status: cached.responseMeta.status,
        statusText: cached.responseMeta.ok ? "OK" : "Cached",
      }),
      payload: cached.payload,
    };
  }

  const inflight = whoamiInflight.get(cacheKey);
  if (inflight) {
    const resolved = await inflight;
    return {
      response: new Response(null, {
        status: resolved.responseMeta.status,
        statusText: resolved.responseMeta.ok ? "OK" : "Cached",
      }),
      payload: resolved.payload,
    };
  }

  const requestPromise = (async (): Promise<WhoamiCacheEntry> => {
    const response = await fetch(getWhoamiEndpoint(), {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    const entry = {
      expiresAt: Date.now() + WHOAMI_CACHE_TTL_MS,
      responseMeta: {
        ok: response.ok,
        status: response.status,
      },
      payload,
    };
    whoamiCache.set(cacheKey, entry);
    return entry;
  })();

  whoamiInflight.set(cacheKey, requestPromise);
  const resolved = await requestPromise.finally(() => {
    whoamiInflight.delete(cacheKey);
  });
  return {
    response: new Response(null, {
      status: resolved.responseMeta.status,
      statusText: resolved.responseMeta.ok ? "OK" : "Cached",
    }),
    payload: resolved.payload,
  };
}

export const getWhoamiUserId = (payload: WhoamiResponse | null): string | null => {
  if (!payload) return null;
  return payload.user?.id || payload.userId || payload.userKey || null;
};

export function hasWorkspaceAccess(payload: WhoamiResponse | null, workspaceId: string): boolean {
  if (!payload) return false;
  if (process.env.NODE_ENV !== "production") {
    // Dev-mode fallback: whoami workspace scopes can be inconsistent across worker/frontend routes.
    return Boolean(getWhoamiUserId(payload));
  }
  const normalizedTarget = normalizeWorkspaceId(workspaceId) ?? workspaceId;
  const allowed = new Set<string>();
  (payload.workspaces ?? []).forEach((workspace) => {
    if (workspace?.id) {
      allowed.add(workspace.id);
      const normalizedId = normalizeWorkspaceId(workspace.id);
      if (normalizedId) {
        allowed.add(normalizedId);
      }
    }
    if (workspace?.slug) {
      allowed.add(workspace.slug);
      const normalizedSlug = normalizeWorkspaceId(workspace.slug);
      if (normalizedSlug) {
        allowed.add(normalizedSlug);
      }
    }
  });
  const activeId = payload.activeWorkspace?.id ?? null;
  if (activeId) {
    allowed.add(activeId);
    const normalizedActive = normalizeWorkspaceId(activeId);
    if (normalizedActive) {
      allowed.add(normalizedActive);
    }
  }
  const additionalWorkspaceHints = [
    payload.workspaceId,
    payload.session?.activeWorkspaceId,
    payload.userSettings?.defaultWorkspaceId,
  ];
  additionalWorkspaceHints.forEach((candidate) => {
    if (!candidate) return;
    allowed.add(candidate);
    const normalizedCandidate = normalizeWorkspaceId(candidate);
    if (normalizedCandidate) {
      allowed.add(normalizedCandidate);
    }
  });
  if (allowed.size === 0) {
    // Some lightweight whoami responses do not include workspace membership lists.
    // In that case treat authenticated identity as workspace-capable for downstream checks.
    return Boolean(getWhoamiUserId(payload));
  }
  if (allowed.has(normalizedTarget)) {
    return true;
  }
  return false;
}
