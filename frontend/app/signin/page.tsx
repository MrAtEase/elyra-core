"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/browser";
import { exchangeSupabaseSession } from "@/lib/auth/exchangeSupabaseSession";
import { ASSISTANT_BASE_ENV_KEYS, getAssistantApiBase } from "@/lib/env";
import { isLocalAuthMode } from "@/lib/auth/authMode";
import { buildAssistantEndpoint } from "@/utils/auth-guard";
import { getSupabaseCredentials } from "@/lib/supabase/client";

export default function SignInPage() {
  const localAuthMode = isLocalAuthMode();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsWorkerAuth, setNeedsWorkerAuth] = useState(false);
  const [hasWorkerAuthReason, setHasWorkerAuthReason] = useState(false);

  const [assistantApiBase, setAssistantApiBase] = useState<string | null>(null);
  const hasRecoveredOAuthReturn = useRef(false);
  const isApiBaseMissing = assistantApiBase === "";
  const isApiBaseResolved = assistantApiBase !== null;
  const assistantBaseKeys = ASSISTANT_BASE_ENV_KEYS.join(" / ");
  const postLoginReturn = searchParams.get("return_to")?.trim() || null;
  const RETURN_TO_STORAGE_KEY = "elyra_return_to";
  const workerAccessNotice = "Supabase Login ok. Workspace wird verbunden …";
  const workerAuthReasonNotice =
    "Workspace-Zugriff erfordert Worker/Google. Bitte \"Mit Google fortfahren\".";
  const workerExchangeFailedNotice =
    "Workspace-Session konnte nicht erstellt werden. Bitte erneut versuchen.";
  const noticeClassName = hasWorkerAuthReason
    ? "mt-4 rounded-2xl border border-amber-400/50 bg-amber-400/15 px-4 py-3 text-sm text-amber-100"
    : "mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100";
  const workerGoogleButtonClassName = hasWorkerAuthReason
    ? "mt-4 w-full rounded-xl border border-amber-300/70 bg-amber-400/25 px-4 py-3 text-sm font-semibold text-amber-50 shadow-lg shadow-amber-400/20 transition hover:border-amber-200/80 disabled:cursor-not-allowed disabled:opacity-70"
    : "mt-4 w-full rounded-xl border border-emerald-400/40 bg-emerald-400/20 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:border-emerald-300/80 disabled:cursor-not-allowed disabled:opacity-70";
  const googleButtonClassName = hasWorkerAuthReason
    ? "rounded-xl border border-amber-300/70 bg-amber-400/20 px-4 py-3 text-sm font-semibold text-amber-50 shadow-lg shadow-amber-400/20 transition hover:border-amber-200/80 disabled:cursor-not-allowed disabled:opacity-70"
    : "rounded-xl border border-white/20 bg-slate-900/40 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-70";

  const resolveAuthError = (err: unknown, fallback = "Login failed.") =>
    err instanceof Error ? err.message : fallback;
  const isAlreadyRegisteredError = (err: unknown) => {
    if (!(err instanceof Error)) return false;
    return err.message.toLowerCase().includes("already registered");
  };

  const clearWorkerSession = async () => {
    const endpoint = buildAssistantEndpoint("/assistant/auth/logout");
    if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
      return;
    }
    try {
      await fetch(endpoint, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.warn("[signin] failed to clear worker session before oauth", error);
    }
  };

  const clearSupabaseBrowserState = () => {
    if (typeof window === "undefined") {
      return;
    }

    let projectRef = "";
    try {
      const { supabaseUrl } = getSupabaseCredentials();
      projectRef = new URL(supabaseUrl).hostname.split(".")[0] ?? "";
    } catch {
      // ignore; best-effort cleanup below still runs
    }

    const shouldRemoveKey = (key: string) => {
      const normalized = key.toLowerCase();
      if (projectRef && normalized.includes(projectRef.toLowerCase())) return true;
      return (
        normalized.includes("supabase") ||
        normalized.includes("sb-") ||
        normalized.includes("auth-token") ||
        normalized.includes("code-verifier")
      );
    };

    const clearStorage = (storage: Storage) => {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
      for (const key of keys) {
        if (shouldRemoveKey(key)) {
          storage.removeItem(key);
        }
      }
    };

    try {
      clearStorage(window.localStorage);
    } catch (error) {
      console.warn("[signin] failed to clear supabase localStorage state", error);
    }

    try {
      clearStorage(window.sessionStorage);
    } catch (error) {
      console.warn("[signin] failed to clear supabase sessionStorage state", error);
    }
  };

  const hasImplicitOAuthPayload = (params: URLSearchParams) =>
    params.has("access_token") ||
    params.has("refresh_token") ||
    params.has("id_token") ||
    params.has("provider_token") ||
    params.has("error");

  const sanitizeOAuthUrl = (url: URL, hashParams: URLSearchParams) => {
    if (typeof window === "undefined") {
      return;
    }
    const sensitiveKeys = [
      "code",
      "access_token",
      "refresh_token",
      "id_token",
      "provider_token",
      "token_type",
      "expires_in",
      "expires_at",
      "error",
      "error_code",
      "error_description",
    ];

    let changed = false;
    for (const key of sensitiveKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
      if (hashParams.has(key)) {
        hashParams.delete(key);
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const nextUrl = `${url.pathname}${url.search}${hashParams.toString() ? `#${hashParams}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  };

  useEffect(() => {
    setAssistantApiBase(getAssistantApiBase());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isPreviewHost =
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
      window.location.port === "3100";
    if (!isPreviewHost) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("force_signin") === "1") return;
    window.location.replace("/os?os_e2e=1");
  }, []);

  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "worker_auth_required") {
      setNotice(workerAuthReasonNotice);
      setNeedsWorkerAuth(true);
      setHasWorkerAuthReason(true);
    }
  }, [searchParams, workerAuthReasonNotice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromQuery = searchParams.get("return_to")?.trim() ?? "";
    if (fromQuery.startsWith("http://localhost:") || fromQuery.startsWith("http://127.0.0.1:")) {
      window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, fromQuery);
    }
    const stickyReturn = window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY) ?? "";
    const isRemoteHost =
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1";
    if (
      isRemoteHost &&
      (stickyReturn.startsWith("http://localhost:") || stickyReturn.startsWith("http://127.0.0.1:"))
    ) {
      const stickyUrl = new URL(stickyReturn);
      const returnTo = `${stickyUrl.origin}/os`;
      window.location.replace(
        `${stickyUrl.origin}/signin?reason=worker_auth_required&return_to=${encodeURIComponent(returnTo)}`
      );
    }
  }, [searchParams]);

  const resolvePostLoginRedirect = () => {
    if (typeof window !== "undefined" && !postLoginReturn) {
      const stickyReturn = window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY) ?? "";
      if (stickyReturn.startsWith("http://localhost:") || stickyReturn.startsWith("http://127.0.0.1:")) {
        try {
          const stickyUrl = new URL(stickyReturn);
          const currentOrigin = window.location.origin;
          // Avoid cross-port OAuth loops (e.g. sticky localhost:3100 while user is on localhost:3000).
          if (stickyUrl.origin === currentOrigin) {
            return stickyReturn;
          }
        } catch {
          // ignore malformed sticky return
        }
      }
    }
    if (!postLoginReturn) return "/os";
    try {
      const target = new URL(postLoginReturn);
      const isLocalTarget =
        target.hostname === "localhost" || target.hostname === "127.0.0.1";
      if (isLocalTarget) {
        return `${target.origin}${target.pathname}${target.search}${target.hash}`;
      }
      return "/os";
    } catch {
      return "/os";
    }
  };

  const resolveCallbackOrigin = () => {
    const target = resolvePostLoginRedirect();
    try {
      const parsed = new URL(target);
      const isLocalTarget =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (isLocalTarget) {
        return parsed.origin;
      }
    } catch {
      // target may be a relative path
    }
    return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  };

  const exchangeWorkerSession = async () => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setNotice(workerAuthReasonNotice);
      setNeedsWorkerAuth(true);
      setHasWorkerAuthReason(true);
      return false;
    }

    setNotice(workerAccessNotice);
    const exchange = await exchangeSupabaseSession(accessToken);
    if (exchange.ok) {
      if (typeof window !== "undefined") {
        window.location.assign(resolvePostLoginRedirect());
      }
      return true;
    }

    if (exchange.error === "api_base_missing") {
      setError(`API base not configured. Set ${assistantBaseKeys}.`);
      setNotice(null);
      setNeedsWorkerAuth(false);
      setHasWorkerAuthReason(false);
      return false;
    }

    if (exchange.status === 403 && exchange.error === "not_authorized") {
      setError("Zugang nur auf Einladung. / Access by invitation only.");
      setNotice(null);
      setNeedsWorkerAuth(false);
      setHasWorkerAuthReason(false);
      return false;
    }

    if (exchange.status === 401 || exchange.status === 403) {
      setNotice(workerAuthReasonNotice);
      setNeedsWorkerAuth(true);
      setHasWorkerAuthReason(true);
      return false;
    }

    setError(exchange.message || workerExchangeFailedNotice);
    setNotice(null);
    setNeedsWorkerAuth(false);
    setHasWorkerAuthReason(false);
    return false;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const recoverReturnedOAuthSession = async () => {
      if (hasRecoveredOAuthReturn.current) {
        return false;
      }
      hasRecoveredOAuthReturn.current = true;

      const currentUrl = new URL(window.location.href);
      const code = currentUrl.searchParams.get("code")?.trim() ?? "";
      const rawHash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(rawHash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const implicitError = hashParams.get("error") || currentUrl.searchParams.get("error");
      const implicitErrorDescription =
        hashParams.get("error_description") || currentUrl.searchParams.get("error_description");
      const hasOAuthPayload = Boolean(code) || rawHash.trim().length > 0;

      if (!hasOAuthPayload) {
        return false;
      }

      setError(null);
      setNotice("Google-Anmeldung wird übernommen …");
      setNeedsWorkerAuth(false);
      setHasWorkerAuthReason(false);
      setLoading(true);

      try {
        if (implicitError) {
          throw new Error(implicitErrorDescription || implicitError);
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        } else if (hasImplicitOAuthPayload(hashParams)) {
          if (!accessToken || !refreshToken) {
            throw new Error("OAuth callback payload missing access or refresh token.");
          }
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) {
            throw setSessionError;
          }
        }

        sanitizeOAuthUrl(currentUrl, hashParams);
        const recovered = await exchangeWorkerSession();
        if (!recovered && !cancelled) {
          setLoading(false);
        }
        return recovered;
      } catch (error) {
        if (!cancelled) {
          setError(resolveAuthError(error, "Google Login konnte nicht abgeschlossen werden."));
          setNotice(null);
          setNeedsWorkerAuth(false);
          setHasWorkerAuthReason(false);
          setLoading(false);
        }
        return true;
      }
    };

    const recoverExistingSession = async () => {
      try {
        const recoveredFromCallback = await recoverReturnedOAuthSession();
        if (cancelled || recoveredFromCallback) {
          return;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (cancelled || sessionError || !data.session?.access_token) {
          return;
        }

        setNotice(workerAccessNotice);
        setNeedsWorkerAuth(false);
        setHasWorkerAuthReason(false);
        setLoading(true);

        const recovered = await exchangeWorkerSession();
        if (!recovered && !cancelled) {
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[signin] failed to recover existing supabase session", error);
          setLoading(false);
        }
      }
    };

    void recoverExistingSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const onEmailPasswordSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const preserveWorkerNotice = hasWorkerAuthReason;
    setError(null);
    setNotice(preserveWorkerNotice ? workerAuthReasonNotice : null);
    setNeedsWorkerAuth(preserveWorkerNotice);
    setLoading(true);
    try {
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const actionValue =
        submitter?.value === "signup" || submitter?.value === "signin" ? submitter.value : mode;
      const action = actionValue === "signup" ? "signup" : "signin";
      setMode(action);
      const trimmedEmail = email.trim();
      if (action === "signup") {
        const signUpResponse = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (signUpResponse.error) {
          if (isAlreadyRegisteredError(signUpResponse.error)) {
            const signInResponse = await supabase.auth.signInWithPassword({
              email: trimmedEmail,
              password,
            });
            if (signInResponse.error) {
              throw signInResponse.error;
            }
            await exchangeWorkerSession();
            return;
          }
          throw signUpResponse.error;
        }
        if (!signUpResponse.data.session) {
          setNotice("Bitte bestätige deine E-Mail, um fortzufahren.");
        } else {
          await exchangeWorkerSession();
        }
        return;
      }
      const signInResponse = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (signInResponse.error) {
        throw signInResponse.error;
      }
      await exchangeWorkerSession();
    } catch (err) {
      setError(resolveAuthError(err));
      if (!preserveWorkerNotice) {
        setNotice(null);
        setNeedsWorkerAuth(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    setError(null);
    if (!hasWorkerAuthReason) {
      setNotice(null);
      setNeedsWorkerAuth(false);
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Bitte gib deine E-Mail-Adresse ein.");
      return;
    }
    setLoading(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${origin}/auth/reset`,
      });
      if (error) {
        throw error;
      }
      setNotice("Passwort-Reset gesendet. Prüfe dein Postfach für den Link.");
    } catch (err) {
      setError(resolveAuthError(err, "Passwort-Reset fehlgeschlagen."));
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      // Hard reset both auth layers so a new Google account cannot inherit the
      // previous Supabase or worker session.
      await supabase.auth.signOut({ scope: "global" }).catch((error) => {
        console.warn("[signin] failed to clear supabase session before oauth", error);
      });
      clearSupabaseBrowserState();
      await clearWorkerSession();

      const localRuntime =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

      const origin = resolveCallbackOrigin();
      const redirectTo = (() => {
        const target = resolvePostLoginRedirect();
        return `${origin}/auth/callback/?return_to=${encodeURIComponent(target)}`;
      })();
      const { data: oauthData, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            prompt: "select_account",
          },
          ...(localRuntime ? { skipBrowserRedirect: true } : {}),
        },
      });

      if (oauthError) {
        throw oauthError;
      }

      if (localRuntime) {
        const oauthUrl = oauthData?.url;
        if (!oauthUrl) {
          throw new Error("Supabase OAuth URL missing.");
        }

        let redirectToInUrl = "";
        let oauthHref = oauthUrl;
        try {
          const parsed = new URL(oauthUrl);
          redirectToInUrl = parsed.searchParams.get("redirect_to")?.trim() ?? "";

          // Hard-pin local callback to avoid redirect loops to app.elyra-core.app in local dev.
          const localCallback = `${window.location.origin}/auth/callback/?return_to=${encodeURIComponent(
            resolvePostLoginRedirect()
          )}`;
          const isLocalRedirect =
            redirectToInUrl.startsWith("http://localhost:") ||
            redirectToInUrl.startsWith("http://127.0.0.1:");
          if (!isLocalRedirect) {
            parsed.searchParams.set("redirect_to", localCallback);
          }
          parsed.searchParams.set("app_domain", window.location.origin);
          oauthHref = parsed.toString();
        } catch {
          redirectToInUrl = "";
        }

        if (redirectToInUrl && !redirectToInUrl.startsWith("http://localhost:")) {
          setNotice(
            `Supabase redirect mismatch detected (${redirectToInUrl}). Overriding to local callback.`
          );
        }

        window.location.assign(oauthHref);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Login fehlgeschlagen.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div
          className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-slate-950/50 backdrop-blur"
          data-e2e-signin-panel="true"
        >
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Workspace</p>
            <h1 className="text-2xl font-semibold tracking-tight">Anmelden</h1>
            <p className="text-sm text-slate-300">
              {localAuthMode
                ? "Lokaler Modus: Anmeldung läuft direkt über Worker/Google."
                : "E-Mail/Passwort meldet dich an. Workspace-Zugriff wird anschließend verbunden."}
            </p>
          </div>

          {isApiBaseResolved && isApiBaseMissing ? (
            <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold">API base not configured</p>
              <p className="mt-1 text-xs text-amber-100/80">
                Set {assistantBaseKeys} to enable the worker login flow.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}
          {notice ? <div className={noticeClassName}>{notice}</div> : null}
          {(needsWorkerAuth || hasWorkerAuthReason) ? (
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={loading}
              className={workerGoogleButtonClassName}
            >
              Weiter mit Google (Workspace)
            </button>
          ) : null}

          {!localAuthMode ? (
            <form className="mt-6 grid gap-4" onSubmit={onEmailPasswordSignIn}>
              <label className="grid gap-2 text-sm text-slate-200">
                <span>E-Mail</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@icloud.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="grid gap-2 text-sm text-slate-200">
                <span>Passwort</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                />
                <button
                  type="button"
                  onClick={onResetPassword}
                  disabled={loading}
                  className="text-left text-xs text-slate-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Passwort vergessen?
                </button>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="submit"
                  value="signin"
                  onClick={() => setMode("signin")}
                  disabled={loading}
                  className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Einloggen
                </button>
                <button
                  type="submit"
                  value="signup"
                  onClick={() => setMode("signup")}
                  disabled={loading}
                  className="rounded-xl border border-white/20 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Account erstellen
                </button>
              </div>
            </form>
          ) : null}

          <div className="mt-6 grid gap-4">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-slate-500">
              <span className="h-px w-full bg-white/10" />
              <span>oder</span>
              <span className="h-px w-full bg-white/10" />
            </div>
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={loading}
              className={googleButtonClassName}
              data-e2e-signin-button="true"
            >
              Mit Google
            </button>
            <button
              type="button"
              disabled
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-400"
            >
              Mit Apple (später)
            </button>
            <button
              type="button"
              disabled
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-400"
            >
              Mit Microsoft (später)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
