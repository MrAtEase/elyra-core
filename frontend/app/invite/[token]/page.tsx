"use client";

import { use, useEffect, useState } from "react";
import { Crown, Eye, Shield, User, Users } from "lucide-react";

type Role = "owner" | "admin" | "member" | "viewer";
type Preview = { workspaceName: string; role: Role; invitedBy: string | null; expiresAt: number };

const ROLE_LABEL: Record<Role, { label: string; icon: typeof Crown }> = {
  owner: { label: "Owner", icon: Crown },
  admin: { label: "Admin", icon: Shield },
  member: { label: "Mitglied", icon: User },
  viewer: { label: "Gast", icon: Eye },
};

type View =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "error"; message: string }
  | { kind: "ready"; invite: Preview }
  | { kind: "joining"; invite: Preview };

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, { credentials: "include", cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { invite?: Preview; message?: string };
      if (cancelled) return;
      if (response.status === 401) setView({ kind: "signin" });
      else if (response.ok && data.invite) setView({ kind: "ready", invite: data.invite });
      else setView({ kind: "error", message: data.message ?? "Diese Einladung ist ungültig oder abgelaufen." });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function join(invite: Preview) {
    setView({ kind: "joining", invite });
    const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, { method: "POST", credentials: "include" });
    const data = (await response.json().catch(() => ({}))) as { workspaceId?: string; message?: string };
    if (!response.ok || !data.workspaceId) {
      setView({ kind: "error", message: data.message ?? "Beitreten fehlgeschlagen." });
      return;
    }
    window.location.assign(`/os?workspaceId=${encodeURIComponent(data.workspaceId)}`);
  }

  const signinHref = `/signin?return_to=${encodeURIComponent(
    typeof window === "undefined" ? `/invite/${token}` : `${window.location.origin}/invite/${token}`,
  )}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0d14] px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Elyra Core</p>

        {view.kind === "loading" && <p className="mt-6 text-sm text-white/60">Einladung wird geprüft …</p>}

        {view.kind === "signin" && (
          <>
            <h1 className="mt-4 text-2xl font-semibold">Du wurdest eingeladen</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Melde dich mit der E-Mail-Adresse an, an die die Einladung ging. Danach kannst du beitreten.
            </p>
            <a
              href={signinHref}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold transition hover:bg-violet-400"
            >
              Anmelden
            </a>
          </>
        )}

        {view.kind === "error" && (
          <>
            <h1 className="mt-4 text-2xl font-semibold">Einladung nicht verfügbar</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{view.message}</p>
            <a href="/os" className="mt-6 inline-flex text-sm text-violet-300 hover:text-violet-200">
              Zu Elyra Core
            </a>
          </>
        )}

        {(view.kind === "ready" || view.kind === "joining") && (() => {
          const role = ROLE_LABEL[view.invite.role];
          return (
            <>
              <div className="mt-6 grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-300">
                <Users size={22} />
              </div>
              <h1 className="mt-4 text-2xl font-semibold">{view.invite.workspaceName}</h1>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                {view.invite.invitedBy ? `${view.invite.invitedBy} lädt dich ein,` : "Du bist eingeladen,"} dem Workspace beizutreten.
              </p>
              <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 px-4 py-3 text-sm">
                <span className="text-white/50">Deine Rolle</span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <role.icon size={14} /> {role.label}
                </span>
              </div>
              <p className="mt-3 text-xs text-white/40">
                Dein persönlicher Workspace bleibt davon getrennt und privat.
              </p>
              <button
                type="button"
                disabled={view.kind === "joining"}
                onClick={() => void join(view.invite)}
                className="mt-6 w-full rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold transition hover:bg-violet-400 disabled:opacity-50"
              >
                {view.kind === "joining" ? "Trete bei …" : "Einladung annehmen"}
              </button>
            </>
          );
        })()}
      </div>
    </main>
  );
}
