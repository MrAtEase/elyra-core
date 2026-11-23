"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { getWhoamiEndpoint } from "@/utils/auth-guard";
import { ASSISTANT_BASE_ENV_KEYS, getAssistantApiBase } from "@/lib/env";
import { createWhoamiFetchOptions } from "@/lib/auth/whoamiFetch";
import { ensureSupabaseToken } from "@/lib/supabase/browser";
import type { WhoamiResponse } from "@/types/whoami";

export type AuthRequiredPayload = {
  loginUrl: string;
  authUrl: string;
  message: string | null;
  code: string;
  ok: boolean;
};

export type AuthState = "checking" | "authenticated" | "unauthenticated" | "error";

type WhoamiResult =
  | { data: WhoamiResponse }
  | { authRequired: AuthRequiredPayload }
  | { error: string };

const FALLBACK_AUTH_REQUIRED_LOGIN_URL = "/signin";
const E2E_AUTH_QUERY_PARAM = "e2e";
const E2E_AUTH_QUERY_VALUE = "1";
const PUBLIC_AUTH_ROUTES = ["/signin", "/auth/callback"];
const MISSING_ASSISTANT_BASE_MESSAGE = `API base not configured. Set ${ASSISTANT_BASE_ENV_KEYS.join(
  " / "
)}.`;

const isPublicAuthRoute = (pathname?: string | null) => {
  if (!pathname) return false;
  return PUBLIC_AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
};

async function parseJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type AuthRequiredOptions = {
  defaultCode?: string;
};

export function buildAuthRequiredPayload(
  payload: Record<string, unknown> | null,
  options?: AuthRequiredOptions
): AuthRequiredPayload {
  const loginUrlCandidate =
    typeof payload?.loginUrl === "string" && payload.loginUrl.trim() ? payload.loginUrl.trim() : "";
  const authUrlCandidate =
    typeof payload?.authUrl === "string" && payload.authUrl.trim() ? payload.authUrl.trim() : "";
  const messageCandidate =
    typeof payload?.message === "string" && payload.message.trim() ? payload.message.trim() : "";
  const codeCandidate = typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : "";
  const fallbackCode = options?.defaultCode?.trim() || "AUTH_REQUIRED";
  const codeCandidateResolved = codeCandidate || fallbackCode;

  const loginUrl = loginUrlCandidate || authUrlCandidate || FALLBACK_AUTH_REQUIRED_LOGIN_URL;
  const authUrl = authUrlCandidate || loginUrlCandidate || FALLBACK_AUTH_REQUIRED_LOGIN_URL;

  return {
    loginUrl,
    authUrl,
    message: messageCandidate || null,
    code: codeCandidateResolved,
    ok: payload?.ok === true,
  };
}

function buildMissingApiBasePayload(): AuthRequiredPayload {
  return buildAuthRequiredPayload({
    loginUrl: FALLBACK_AUTH_REQUIRED_LOGIN_URL,
    authUrl: FALLBACK_AUTH_REQUIRED_LOGIN_URL,
    message: MISSING_ASSISTANT_BASE_MESSAGE,
    code: "API_BASE_MISSING",
    ok: false,
  });
}

function buildApiUnavailablePayload(endpoint: string): AuthRequiredPayload {
  return buildAuthRequiredPayload({
    loginUrl: FALLBACK_AUTH_REQUIRED_LOGIN_URL,
    authUrl: FALLBACK_AUTH_REQUIRED_LOGIN_URL,
    message: `Assistant API unreachable at ${endpoint}. Start local worker: npm run dev:worker`,
    code: "ASSISTANT_API_UNREACHABLE",
    ok: false,
  });
}

function normalizeLoginUrlForRuntime(loginUrl: string): string {
  const trimmed = loginUrl.trim();
  if (!trimmed) return FALLBACK_AUTH_REQUIRED_LOGIN_URL;
  if (typeof window === "undefined") return trimmed;
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const isLocalRuntime =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const isPlaygroundPort = window.location.port === "3100";
    const isExternalHost = parsed.origin !== window.location.origin;
    if (isLocalRuntime && isPlaygroundPort) {
      const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      return `/signin?reason=worker_auth_required&return_to=${encodeURIComponent(returnTo || `${window.location.origin}/os`)}`;
    }
    if (isLocalRuntime && isExternalHost) {
      const next = `${window.location.pathname}${window.location.search}`;
      return `/signin?reason=worker_auth_required&next=${encodeURIComponent(next || "/os")}`;
    }
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return trimmed;
  } catch {
    return FALLBACK_AUTH_REQUIRED_LOGIN_URL;
  }
}

export function useWhoamiLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const envE2eMode = (process.env.NEXT_PUBLIC_E2E_AUTH_MODE ?? "").trim().toLowerCase();
  const searchParamsString = searchParams.toString();
  const isPublicRoute = useMemo(() => isPublicAuthRoute(pathname), [pathname]);

  const shouldForceUnauthenticated = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    const queryEnabled = params.get(E2E_AUTH_QUERY_PARAM) === E2E_AUTH_QUERY_VALUE;
    const envEnabled = envE2eMode === "unauthenticated";
    return queryEnabled || envEnabled;
  }, [searchParamsString, envE2eMode]);

  const [data, setData] = useState<WhoamiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<AuthRequiredPayload | null>(null);
  const [authRequiredFromWhoami, setAuthRequiredFromWhoami] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>("checking");

  const handleWhoamiResponse = useCallback(async (response: Response): Promise<WhoamiResult> => {
    if (response.ok) {
      const payload = (await response.json()) as WhoamiResponse;
      setData(payload);
      setAuthRequired(null);
      setAuthRequiredFromWhoami(false);
      setLoginUrl(null);
      setAuthState("authenticated");
      setError(null);
      return { data: payload };
    }

    const payload = await parseJsonBody(response);

    if (response.status === 401 || response.status === 403) {
      const authPayload = buildAuthRequiredPayload(payload);
      setData(null);
      setAuthRequired(authPayload);
      setAuthRequiredFromWhoami(true);
      setLoginUrl(normalizeLoginUrlForRuntime(authPayload.loginUrl));
      setError(null);
      setAuthState("unauthenticated");
      return { authRequired: authPayload };
    }

    const messageCandidate = typeof payload?.message === "string" ? payload.message.trim() : "";
    const message = messageCandidate || `Unexpected response ${response.status}`;
    setData(null);
    setAuthRequired(null);
    setAuthRequiredFromWhoami(false);
    setLoginUrl(null);
    setAuthState("error");
    setError(message);
    return { error: message };
  }, []);

  const refresh = useCallback(
    async (): Promise<WhoamiResult> => {
      setLoading(true);
      setError(null);
      setAuthRequired(null);
      setLoginUrl(null);
      setAuthState("checking");
      try {
        if (isPublicRoute || shouldForceUnauthenticated) {
          const fallbackPayload = buildAuthRequiredPayload(null, {
            defaultCode: "AUTH_REQUIRED_FALLBACK",
          });
          setData(null);
          setAuthRequired(fallbackPayload);
          setAuthRequiredFromWhoami(false);
          setLoginUrl(normalizeLoginUrlForRuntime(fallbackPayload.loginUrl));
          setError(null);
          setAuthState("unauthenticated");
          return { authRequired: fallbackPayload };
        }

        const apiBase = getAssistantApiBase();
        if (!apiBase) {
          const fallbackPayload = buildMissingApiBasePayload();
          setData(null);
          setAuthRequired(fallbackPayload);
          setAuthRequiredFromWhoami(false);
          setLoginUrl(normalizeLoginUrlForRuntime(fallbackPayload.loginUrl));
          setError(null);
          setAuthState("unauthenticated");
          return { authRequired: fallbackPayload };
        }

        const whoamiEndpoint = getWhoamiEndpoint();
        const options = createWhoamiFetchOptions();
        const headers = new Headers(options.headers);
        try {
          const token = await ensureSupabaseToken();
          headers.set("Authorization", `Bearer ${token}`);
        } catch (tokenError) {
          if (process.env.NODE_ENV !== "production") {
            console.info("[auth] proceeding without supabase bearer token", {
              reason: tokenError instanceof Error ? tokenError.message : String(tokenError),
            });
          }
        }
        options.headers = headers;
        const response = await fetch(whoamiEndpoint, options);
        if (process.env.NODE_ENV !== "production") {
          console.log(`[auth] whoami ${response.status} ${whoamiEndpoint}`);
        }
        const result = await handleWhoamiResponse(response);
        if ("error" in result && result.error) {
          setError(result.error);
        }
        return result;
      } catch (err) {
        if (!(err instanceof TypeError)) {
          console.error("Workspace: failed to load whoami", err);
        }
        const fallbackPayload =
          err instanceof TypeError
            ? buildApiUnavailablePayload(getWhoamiEndpoint())
            : buildAuthRequiredPayload(null, {
                defaultCode: "AUTH_REQUIRED_FALLBACK",
              });
        setData(null);
        setAuthRequired(fallbackPayload);
        setAuthRequiredFromWhoami(false);
        setLoginUrl(normalizeLoginUrlForRuntime(fallbackPayload.loginUrl));
        setError(fallbackPayload.message ?? null);
        setAuthState("unauthenticated");
        return { authRequired: fallbackPayload };
      } finally {
        setLoading(false);
      }
    },
    [handleWhoamiResponse, isPublicRoute, shouldForceUnauthenticated]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    loading,
    error,
    authRequired,
    authRequiredFromWhoami,
    loginUrl,
    authState,
    refresh,
    handleWhoamiResponse,
    setLoading,
    setError,
    setAuthRequired,
    setAuthRequiredFromWhoami,
    setLoginUrl,
    setData,
    setAuthState,
  };
}
