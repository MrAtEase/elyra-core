import type { NextRequest } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse, WhoamiWorkspace } from "@/types/whoami";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

const WHOAMI_TIMEOUT_MS = 8_000;
const WHOAMI_CACHE_TTL_MS = 5_000;

type CachedWhoamiResult = {
  expiresAt: number;
  status: number;
  ok: boolean;
  payload: WhoamiResponse | null;
  rawPayload: Record<string, unknown> | null;
};

const whoamiCache = new Map<string, CachedWhoamiResult>();
const whoamiInflight = new Map<string, Promise<CachedWhoamiResult>>();

export type GoogleAuthContext = {
  whoami: WhoamiResponse;
  userId: string;
  email: string | null;
  workspaceId: string;
  workspaces: WhoamiWorkspace[];
  activeWorkspaceId: string | null;
};

export type GoogleAuthFailure = {
  ok: false;
  status: number;
  message: string;
  loginUrl?: string | null;
};

export type GoogleAuthSuccess = {
  ok: true;
  context: GoogleAuthContext;
};

export type GoogleAuthResult = GoogleAuthSuccess | GoogleAuthFailure;

function parseUserId(payload: WhoamiResponse | null): string | null {
  if (!payload) return null;
  const userRecord = (payload.user as Record<string, unknown> | undefined) ?? {};
  return (
    payload.user?.id?.trim() ||
    (typeof userRecord.user_id === "string" ? userRecord.user_id.trim() : null) ||
    (typeof userRecord.sub === "string" ? userRecord.sub.trim() : null) ||
    payload.userId?.trim() ||
    payload.userKey?.trim() ||
    null
  );
}

function parseWorkspaceList(payload: WhoamiResponse): WhoamiWorkspace[] {
  const value = (payload as Record<string, unknown>)["workspaces"];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is WhoamiWorkspace =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as { id?: unknown }).id === "string" &&
        (entry as { id: string }).id.trim().length > 0
    )
    .map((workspace) => ({
      ...workspace,
      id: workspace.id.trim(),
    }));
}

const OS_CANONICAL_WORKSPACE_IDS = new Set([
  "ws-personal",
  "ws-fish-delish",
  "ws-elyra-core",
  "personal",
  "fish-delish",
  "elyra-core",
]);

function normalizeWorkspaceToken(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/^\/+/, "") : "";
}

function resolveWorkspaceId(
  payload: WhoamiResponse,
  requestedWorkspaceId: string | null
): string | null {
  const available = parseWorkspaceList(payload);
  const normalizedRequestedWorkspaceId = normalizeWorkspaceId(requestedWorkspaceId);
  if (normalizedRequestedWorkspaceId) {
    const requested = normalizedRequestedWorkspaceId.trim();
    if (requested.length > 0) {
      if (available.some((workspace) => workspace.id === requested)) {
        return requested;
      }

      const normalizedRequested = normalizeWorkspaceToken(requested);
      const byAlias = available.find((workspace) => {
        const candidateTokens = [
          normalizeWorkspaceToken(workspace.id),
          normalizeWorkspaceToken(workspace.slug),
          normalizeWorkspaceToken(workspace.name),
        ];
        return candidateTokens.includes(normalizedRequested);
      });
      if (byAlias) {
        return byAlias.id;
      }

      if (OS_CANONICAL_WORKSPACE_IDS.has(normalizedRequested)) {
        // Never return synthetic canonical IDs for persistence paths.
        // Prefer an actual workspace ID from whoami to avoid FK violations.
        const canonicalAlias = normalizedRequested.replace(/^ws-/, "");
        const canonicalMatch = available.find((workspace) => {
          const tokens = [
            normalizeWorkspaceToken(workspace.id),
            normalizeWorkspaceToken(workspace.slug),
            normalizeWorkspaceToken(workspace.name),
          ];
          return tokens.includes(canonicalAlias);
        });
        if (canonicalMatch) {
          return canonicalMatch.id;
        }
        // Fallback: match canonical IDs by workspace type
        const CANONICAL_TYPE_MAP: Record<string, string> = {
          "ws-personal": "personal",
          "personal": "personal",
          "ws-elyra-core": "system_platform",
          "elyra-core": "system_platform",
        };
        const targetType = CANONICAL_TYPE_MAP[normalizedRequested];
        if (targetType) {
          const byType = available.find((ws) => ws.type === targetType);
          if (byType) return byType.id;
        }
      }
    }
  }

  if (payload.activeWorkspace?.id && available.some((workspace) => workspace.id === payload.activeWorkspace?.id)) {
    return payload.activeWorkspace.id;
  }

  return available[0]?.id ?? null;
}

function resolveCookieHeader(request: NextRequest): string | null {
  const direct = request.headers.get("cookie");
  if (direct && direct.trim()) {
    return direct;
  }
  const sessionCookie = request.cookies.get("mf-s");
  if (sessionCookie?.value) {
    return `mf-s=${sessionCookie.value}`;
  }
  return null;
}

async function fetchWhoami(
  request: NextRequest,
  accessTokenOverride?: string
): Promise<{
  response: Response;
  payload: WhoamiResponse | null;
  rawPayload: Record<string, unknown> | null;
}> {
  const cookieHeader = resolveCookieHeader(request);
  const incomingAuthHeader = request.headers.get("authorization");
  const headers = new Headers();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  if (incomingAuthHeader?.trim()) {
    headers.set("authorization", incomingAuthHeader);
  } else if (accessTokenOverride?.trim()) {
    headers.set("authorization", `Bearer ${accessTokenOverride.trim()}`);
  }
  const cacheKey = [
    cookieHeader ?? "",
    incomingAuthHeader?.trim() ?? "",
    accessTokenOverride?.trim() ?? "",
  ].join("::");
  const cached = whoamiCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      response: new Response(null, {
        status: cached.status,
        statusText: cached.ok ? "OK" : "Cached",
      }),
      payload: cached.payload,
      rawPayload: cached.rawPayload,
    };
  }

  const inflight = whoamiInflight.get(cacheKey);
  if (inflight) {
    const resolved = await inflight;
    return {
      response: new Response(null, {
        status: resolved.status,
        statusText: resolved.ok ? "OK" : "Cached",
      }),
      payload: resolved.payload,
      rawPayload: resolved.rawPayload,
    };
  }

  const requestPromise = (async (): Promise<CachedWhoamiResult> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WHOAMI_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(getWhoamiEndpoint(), {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort =
        error instanceof DOMException
          ? error.name === "AbortError"
          : typeof error === "object" &&
            error !== null &&
            "name" in error &&
            (error as { name?: unknown }).name === "AbortError";
      if (isAbort) {
        throw new Error(`Auth service request timed out after ${WHOAMI_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const rawPayload = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const result = {
      expiresAt: Date.now() + WHOAMI_CACHE_TTL_MS,
      status: response.status,
      ok: response.ok,
      payload: response.ok ? (rawPayload as WhoamiResponse | null) : null,
      rawPayload,
    };
    whoamiCache.set(cacheKey, result);
    return result;
  })();

  whoamiInflight.set(cacheKey, requestPromise);
  const resolved = await requestPromise.finally(() => {
    whoamiInflight.delete(cacheKey);
  });

  return {
    response: new Response(null, {
      status: resolved.status,
      statusText: resolved.ok ? "OK" : "Cached",
    }),
    payload: resolved.payload,
    rawPayload: resolved.rawPayload,
  };
}

export async function getGoogleAuthContext(
  request: NextRequest,
  requestedWorkspaceId: string | null,
  options?: { accessToken?: string }
): Promise<GoogleAuthResult> {
  let whoamiResult:
    | {
        response: Response;
        payload: WhoamiResponse | null;
        rawPayload: Record<string, unknown> | null;
      }
    | null = null;

  try {
    whoamiResult = await fetchWhoami(request, options?.accessToken);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      message:
        error instanceof Error
          ? `Unable to reach auth service: ${error.message}`
          : "Unable to reach auth service.",
      loginUrl: "/signin",
    };
  }

  const { response, payload, rawPayload } = whoamiResult;

  if (!response.ok || !payload) {
    const loginUrl =
      typeof rawPayload?.loginUrl === "string" ? rawPayload.loginUrl : null;
    const message =
      (typeof rawPayload?.message === "string" && rawPayload.message) ||
      (response.status === 401 || response.status === 403
        ? "Authentication required."
        : "Unable to validate session.");
    return {
      ok: false,
      status: response.status || 401,
      message,
      loginUrl,
    };
  }

  const userId = parseUserId(payload);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      message:
        "Unable to resolve authenticated user id from whoami payload. Check NEXT_PUBLIC_ASSISTANT_API_BASE points to the worker service.",
    };
  }

  const workspaceId = resolveWorkspaceId(payload, requestedWorkspaceId);
  if (!workspaceId) {
    return {
      ok: false,
      status: 403,
      message: "No accessible workspace found for this session.",
    };
  }

  return {
    ok: true,
    context: {
      whoami: payload,
      userId,
      email: payload.user?.email ?? null,
      workspaceId,
      workspaces: parseWorkspaceList(payload),
      activeWorkspaceId: payload.activeWorkspace?.id ?? null,
    },
  };
}
