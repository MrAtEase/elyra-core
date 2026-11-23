"use client";

import { useEffect, useState } from "react";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Password reset landing page (target of supabase.auth.resetPasswordForEmail → redirectTo /auth/reset).
 * Handles both PKCE (?code=) and implicit (#access_token=) links, then lets the user set a new password.
 */

type Phase = "checking" | "ready" | "saving" | "done" | "error";

function readLinkError(): string | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = search.get("error_code") ?? hash.get("error_code");
  const description = search.get("error_description") ?? hash.get("error_description");
  if (!code && !description) return null;
  if (code === "otp_expired") {
    return "Der Link ist abgelaufen oder wurde schon benutzt. Fordere auf der Anmeldeseite einen neuen an und öffne nur den neuesten Link – einmal.";
  }
  return description ?? "Der Link ist ungültig.";
}

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const linkError = readLinkError();
      if (linkError) {
        setMessage(linkError);
        setPhase("error");
        return;
      }
      try {
        const search = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const code = search.get("code");
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (code) {
          const { error } = await supabaseBrowserClient.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabaseBrowserClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        const { data } = await supabaseBrowserClient.auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          setMessage("Keine gültige Reset-Sitzung gefunden. Fordere bitte einen neuen Link an.");
          setPhase("error");
          return;
        }
        window.history.replaceState(null, "", "/auth/reset");
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setMessage(err instanceof Error ? err.message : "Der Link konnte nicht verarbeitet werden.");
        setPhase("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (password.length < 8) {
      setMessage("Das Passwort muss mindestens 8 Zeichen haben.");
      return;
    }
    if (password !== confirm) {
      setMessage("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setPhase("saving");
    const { error } = await supabaseBrowserClient.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setPhase("ready");
      return;
    }
    await supabaseBrowserClient.auth.signOut();
    setPhase("done");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0d1a] p-6 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Workspace</p>
        <h1 className="mt-1 text-xl font-semibold">Neues Passwort</h1>

        {phase === "checking" ? <p className="mt-4 text-sm text-white/60">Link wird geprüft…</p> : null}

        {phase === "error" ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-red-300">{message}</p>
            <a href="/signin" className="inline-block rounded-full bg-white px-4 py-2 text-sm font-medium text-black">
              Zur Anmeldung
            </a>
          </div>
        ) : null}

        {phase === "ready" || phase === "saving" ? (
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <label className="block text-sm">
              Neues Passwort
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 outline-none"
              />
            </label>
            <label className="block text-sm">
              Passwort wiederholen
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 outline-none"
              />
            </label>
            {message ? <p className="text-sm text-red-300">{message}</p> : null}
            <button
              type="submit"
              disabled={phase === "saving"}
              className="w-full rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
            >
              {phase === "saving" ? "Speichere…" : "Passwort speichern"}
            </button>
          </form>
        ) : null}

        {phase === "done" ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-emerald-300">Passwort gespeichert. Melde dich jetzt mit E-Mail und neuem Passwort an.</p>
            <a href="/signin" className="inline-block rounded-full bg-white px-4 py-2 text-sm font-medium text-black">
              Zur Anmeldung
            </a>
          </div>
        ) : null}
      </div>
    </main>
  );
}
