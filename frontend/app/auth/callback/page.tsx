"use client";

import { useEffect, useRef, useState } from "react";
import { isLocalAuthMode } from "@/lib/auth/authMode";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { buildAssistantEndpoint } from "@/utils/auth-guard";
import { exchangeSupabaseSession } from "@/lib/auth/exchangeSupabaseSession";

const WORKSPACE_ROUTE = "/os";
const SIGNIN_ROUTE = "/signin";
const DEFAULT_ERROR_MESSAGE = "Authentication failed.";

function toErrorMessage(value: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function toErrorDebug(error: unknown): {
  name: string | null;
  status: number | null;
  code: string | null;
  message: string | null;
  responseText: string | null;
} {
  if (!error || typeof error !== "object") {
    return {
      name: null,
      status: null,
      code: null,
      message:
        typeof error === "string" && error.trim()
          ? error.trim()
          : null,
      responseText: null,
    };
  }

  const record = error as Record<string, unknown>;
  const details = [record.error_description, record.details, record.hint]
    .find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;

  return {
    name: typeof record.name === "string" ? record.name : null,
    status: typeof record.status === "number" ? record.status : null,
    code: typeof record.code === "string" ? record.code : null,
    message: typeof record.message === "string" ? record.message : null,
    responseText: details ?? null,
  };
}

function hasImplicitFlowPayload(hashParams: URLSearchParams): boolean {
  return (
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    hashParams.has("id_token") ||
    hashParams.has("provider_token") ||
    hashParams.has("error")
  );
}

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

async function clearWorkerSession(): Promise<void> {
  const endpoint = buildAssistantEndpoint("/assistant/auth/logout");
  if (!isAbsoluteUrl(endpoint)) {
    return;
  }

  await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  }).catch((error) => {
    console.warn("[auth/callback] worker logout before exchange failed", error);
  });
}

async function verifyWorkerIdentity(accessToken: string, expectedUserId: string): Promise<void> {
  const endpoint = buildAssistantEndpoint("/assistant/auth/whoami");
  if (!isAbsoluteUrl(endpoint)) {
    throw new Error("Assistant API base missing during auth verification.");
  }

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { user?: { id?: string | null } | null; message?: string | null }
    | null;

  if (!response.ok) {
    throw new Error(payload?.message || `Worker identity check failed (${response.status}).`);
  }

  const resolvedUserId = payload?.user?.id ?? null;
  if (!resolvedUserId) {
    throw new Error("Worker identity check returned no user id.");
  }
  if (resolvedUserId !== expectedUserId) {
    throw new Error(
      `Authenticated worker user mismatch. Expected ${expectedUserId}, got ${resolvedUserId}.`
    );
  }
}

function resolvePostCallbackRedirect(currentUrl: URL): string {
  const returnTo = currentUrl.searchParams.get("return_to")?.trim() ?? "";
  if (!returnTo) return WORKSPACE_ROUTE;
  try {
    const target = new URL(returnTo);
    const isLocalTarget =
      target.hostname === "localhost" || target.hostname === "127.0.0.1";
    if (isLocalTarget) {
      return `${target.origin}${target.pathname}${target.search}${target.hash}`;
    }
    return WORKSPACE_ROUTE;
  } catch {
    return WORKSPACE_ROUTE;
  }
}

function sanitizeAuthTokensFromUrl(currentUrl: URL, hashParams: URLSearchParams) {
  if (typeof window === "undefined") return;
  const sensitiveKeys = [
    "access_token",
    "refresh_token",
    "id_token",
    "token_type",
    "expires_in",
    "expires_at",
  ];

  let changed = false;
  for (const key of sensitiveKeys) {
    if (currentUrl.searchParams.has(key)) {
      currentUrl.searchParams.delete(key);
      changed = true;
    }
    if (hashParams.has(key)) {
      hashParams.delete(key);
      changed = true;
    }
  }

  if (!changed) return;
  const cleanedHash = hashParams.toString();
  const nextUrl = `${currentUrl.pathname}${currentUrl.search}${cleanedHash ? `#${cleanedHash}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

async function logWorkerWhoamiDebug(reason: string): Promise<void> {
  const endpoint = buildAssistantEndpoint("/assistant/auth/whoami");
  if (!isAbsoluteUrl(endpoint)) {
    console.error("[auth/callback] debug whoami skipped: endpoint is not absolute", {
      reason,
      endpoint,
    });
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const responseText = await response.text();
    console.error("[auth/callback] debug whoami response", {
      reason,
      endpoint,
      status: response.status,
      responseText,
    });
  } catch (error) {
    console.error("[auth/callback] debug whoami request failed", {
      reason,
      endpoint,
      error: toErrorMessage(error, "debug whoami failed"),
    });
  }
}

function AuthCallbackContent() {
  const localAuthMode = isLocalAuthMode();
  const [error, setError] = useState<string | null>(null);
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    if (hasHandledCallback.current) {
      return;
    }
    hasHandledCallback.current = true;

    let active = true;

    const completeAuth = async () => {
      try {
        const postCallbackRedirect = resolvePostCallbackRedirect(new URL(window.location.href));
        if (localAuthMode) {
          window.location.replace(postCallbackRedirect);
          return;
        }

        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const oauthError = url.searchParams.get("error");
        const oauthErrorCode = url.searchParams.get("error_code");
        const oauthErrorDescription = url.searchParams.get("error_description");

        const rawHash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(rawHash);
        const hasImplicitPayload = hasImplicitFlowPayload(hashParams);
        const hasAnyHashPayload = rawHash.trim().length > 0;
        const implicitAccessToken = hashParams.get("access_token");
        const implicitRefreshToken = hashParams.get("refresh_token");
        const implicitError = hashParams.get("error");
        const implicitErrorDescription = hashParams.get("error_description");

        if (oauthError) {
          const details = {
            error: oauthError,
            errorCode: oauthErrorCode,
            errorDescription: oauthErrorDescription,
            href: window.location.href,
          };
          console.error("[auth/callback] OAuth query params returned an error", details);
          await logWorkerWhoamiDebug("oauth_query_error");
          throw new Error(
            oauthErrorDescription ||
              `OAuth error (${oauthErrorCode || "unknown_code"}): ${oauthError}`
          );
        }

        if (code && code.trim()) {
          console.info("[auth/callback] PKCE flow detected: exchangeCodeForSession");
          const { data, error: exchangeCodeError } =
            await supabaseBrowserClient.auth.exchangeCodeForSession(code);
          if (exchangeCodeError) {
            console.error("[auth/callback] exchangeCodeForSession failed", {
              codeLength: code.length,
              error: exchangeCodeError,
            });
            await logWorkerWhoamiDebug("pkce_exchange_failed");
            throw exchangeCodeError;
          }
          console.info("[auth/callback] PKCE exchange completed", {
            hasSession: Boolean(data?.session),
            userId: data?.session?.user?.id ?? null,
          });
        } else {
          if (hasAnyHashPayload) {
            if (implicitError) {
              console.error("[auth/callback] implicit OAuth hash returned an error", {
                error: implicitError,
                errorDescription: implicitErrorDescription,
                hash: rawHash,
              });
              await logWorkerWhoamiDebug("implicit_hash_error");
              throw new Error(
                implicitErrorDescription ||
                  `OAuth implicit error: ${implicitError}`
              );
            }

            const legacyGetSessionFromUrl = (
              supabaseBrowserClient.auth as unknown as {
                getSessionFromUrl?: (options: { storeSession: boolean }) => Promise<{
                  data: { session: { user?: { id?: string } } | null };
                  error: unknown;
                }>;
              }
            ).getSessionFromUrl;

            if (typeof legacyGetSessionFromUrl === "function") {
              console.info("[auth/callback] implicit flow detected: getSessionFromUrl");
              const { data, error: hashSessionError } =
                await legacyGetSessionFromUrl({ storeSession: true });
              if (hashSessionError) {
                console.error("[auth/callback] getSessionFromUrl failed", {
                  hash: rawHash,
                  error: hashSessionError,
                });
                await logWorkerWhoamiDebug("implicit_session_from_url_failed");
                throw hashSessionError;
              }
              console.info("[auth/callback] implicit session parsing completed", {
                hasSession: Boolean(data?.session),
                userId: data?.session?.user?.id ?? null,
              });
              if (!data?.session && implicitAccessToken && implicitRefreshToken) {
                console.warn(
                  "[auth/callback] getSessionFromUrl returned no session; retrying with setSession fallback"
                );
                const { data: retryData, error: retryError } =
                  await supabaseBrowserClient.auth.setSession({
                    access_token: implicitAccessToken,
                    refresh_token: implicitRefreshToken,
                  });
                if (retryError) {
                  console.error("[auth/callback] setSession retry failed", {
                    hash: rawHash,
                    error: retryError,
                  });
                  await logWorkerWhoamiDebug("implicit_set_session_retry_failed");
                  throw retryError;
                }
                console.info("[auth/callback] setSession retry completed", {
                  hasSession: Boolean(retryData?.session),
                  userId: retryData?.session?.user?.id ?? null,
                });
              }
            } else {
              const accessToken = implicitAccessToken;
              const refreshToken = implicitRefreshToken;
              if (!accessToken || !refreshToken) {
                console.error("[auth/callback] implicit hash missing required tokens", {
                  hash: rawHash,
                  hasAccessToken: Boolean(accessToken),
                  hasRefreshToken: Boolean(refreshToken),
                });
                await logWorkerWhoamiDebug("implicit_tokens_missing");
                throw new Error("Implicit callback payload missing access or refresh token.");
              }

              console.info(
                "[auth/callback] implicit flow detected: getSessionFromUrl unavailable, using setSession fallback"
              );
              const { data, error: setSessionError } =
                await supabaseBrowserClient.auth.setSession({
                  access_token: accessToken,
                  refresh_token: refreshToken,
                });
              if (setSessionError) {
                console.error("[auth/callback] setSession failed", {
                  hash: rawHash,
                  error: setSessionError,
                });
                await logWorkerWhoamiDebug("implicit_set_session_failed");
                throw setSessionError;
              }
              console.info("[auth/callback] implicit session set completed", {
                hasSession: Boolean(data?.session),
                userId: data?.session?.user?.id ?? null,
              });
            }
            sanitizeAuthTokensFromUrl(url, hashParams);
          } else {
            console.warn(
              "[auth/callback] no PKCE code or implicit token hash detected; checking existing session"
            );
          }
        }

        const { data: sessionData, error: sessionError } =
          await supabaseBrowserClient.auth.getSession();
        if (sessionError) {
          console.error("[auth/callback] getSession failed", sessionError);
          await logWorkerWhoamiDebug("get_session_failed");
          throw sessionError;
        }

        if (!sessionData.session) {
          if (implicitAccessToken && implicitRefreshToken) {
            console.warn(
              "[auth/callback] final session lookup empty; attempting last-resort setSession from hash tokens"
            );
            const { data: rescueData, error: rescueError } =
              await supabaseBrowserClient.auth.setSession({
                access_token: implicitAccessToken,
                refresh_token: implicitRefreshToken,
              });
            if (!rescueError && rescueData?.session) {
              console.info("[auth/callback] last-resort setSession succeeded", {
                userId: rescueData.session.user.id,
              });
              const exchange = await exchangeSupabaseSession(rescueData.session.access_token);
              if (!exchange.ok) {
                throw new Error(exchange.message || "Worker session exchange failed.");
              }
              await verifyWorkerIdentity(
                rescueData.session.access_token,
                rescueData.session.user.id
              );
              window.location.replace(postCallbackRedirect);
              return;
            }
            if (rescueError) {
              console.error("[auth/callback] last-resort setSession failed", rescueError);
            }
          }
          console.error("[auth/callback] no Supabase session after callback handling", {
            hasCode: Boolean(code),
            hasImplicitPayload,
            hash: rawHash,
          });
          await logWorkerWhoamiDebug("missing_supabase_session_after_callback");
          throw new Error(
            "Missing Supabase session. Verify Supabase redirect URL allowlist and project keys."
          );
        }

        if (!active) return;
        console.info("[auth/callback] session established, exchanging worker session", {
          userId: sessionData.session.user.id,
          expiresAt: sessionData.session.expires_at ?? null,
          destination: postCallbackRedirect,
        });

        await clearWorkerSession();
        const exchange = await exchangeSupabaseSession(sessionData.session.access_token);
        if (!exchange.ok) {
          console.error("[auth/callback] worker session exchange failed", exchange);
          await logWorkerWhoamiDebug("worker_exchange_failed");
          throw new Error(exchange.message || "Worker session exchange failed.");
        }
        await verifyWorkerIdentity(
          sessionData.session.access_token,
          sessionData.session.user.id
        );
        console.info("[auth/callback] worker session exchange ok", {
          workspaceId: exchange.workspaceId,
          userId: sessionData.session.user.id,
        });

        window.location.replace(postCallbackRedirect);
      } catch (err) {
        if (!active) return;
        console.error("[auth/callback] callback flow failed", toErrorDebug(err));
        const message = err instanceof Error ? err.message : DEFAULT_ERROR_MESSAGE;
        setError(message);
      }
    };

    completeAuth();

    return () => {
      active = false;
    };
  }, [localAuthMode]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Signing you in…</h1>
      <p className="text-sm text-slate-300">
        Bitte einen Moment, wir schließen deine Anmeldung ab.
      </p>
      {error ? (
        <div className="space-y-3 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-left">
          <p className="text-sm text-red-100">{error}</p>
          <a
            href={SIGNIN_ROUTE}
            className="inline-flex rounded-lg border border-red-300/60 px-3 py-2 text-xs font-semibold text-red-100 transition hover:border-red-100/80"
          >
            Back to sign in
          </a>
        </div>
      ) : null}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-lg items-center justify-center px-6 py-12 text-center">
        <AuthCallbackContent />
      </div>
    </div>
  );
}
