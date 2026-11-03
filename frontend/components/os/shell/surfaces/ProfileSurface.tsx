"use client";

import { useEffect, useState } from "react";
import { Download, Globe2, Keyboard, LogOut, RefreshCw, Shield, Trash2, UserCircle2 } from "lucide-react";
import type { ProfilePayload } from "@/lib/orb-os/profile/types";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type ProfileSurfaceProps = {
  workspaceId: string;
  onSignOut: () => void;
};

type ProfileState = {
  loading: boolean;
  error: string | null;
  payload: ProfilePayload | null;
};

function MutedError({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{body}</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)]">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="animate-pulse rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <div className="h-4 w-24 rounded bg-[var(--border)]" />
      <div className="mt-2 h-3 w-2/3 rounded bg-[var(--border)]" />
      <div className="mt-4 h-10 rounded bg-[var(--border-subtle)]" />
    </div>
  );
}

export default function ProfileSurface({ workspaceId, onSignOut }: ProfileSurfaceProps) {
  const [state, setState] = useState<ProfileState>({ loading: true, error: null, payload: null });

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/os/profile", {
        credentials: "include",
        cache: "no-store",
        headers: await withSupabaseAuthorization(),
      });
      const payload = (await response.json()) as { ok: boolean; profile?: ProfilePayload; error?: string };
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Unable to load profile surface");
      }
      if (payload.profile.workspace_id !== workspaceId) {
        throw new Error("Workspace mismatch while loading profile");
      }
      setState({ loading: false, error: null, payload: payload.profile });
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "Profile request failed",
        payload: null,
      });
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId]);

  const identity = state.payload?.sections.identity;
  const preferences = state.payload?.sections.preferences;
  const security = state.payload?.sections.security;
  const privacy = state.payload?.sections.privacy;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/85 p-4 backdrop-blur-xl">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Profile</p>
        <h3 className="mt-1 text-[18px] font-semibold text-[color:var(--text-primary)]">Account & Preferences</h3>
      </header>

      {state.error ? <MutedError title="Profile unavailable" body={state.error} onRetry={() => void load()} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/90 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <UserCircle2 size={15} className="text-[color:var(--text-muted)]" />
            <h4 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Account Identity</h4>
          </div>
          {state.loading ? <LoadingCard /> : null}
          {!state.loading && identity?.state === "error" ? <MutedError title="Identity unavailable" body={identity.error_message_safe ?? "Temporarily unavailable"} onRetry={() => void load()} /> : null}
          {!state.loading && identity?.state === "empty" ? <p className="text-[12px] text-[color:var(--text-muted)]">No account identity data available.</p> : null}
          {!state.loading && identity?.state === "ready" && identity.data ? (
            <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)] text-[13px] font-semibold text-[color:var(--text-secondary)]">
                  {identity.data.avatar_initials}
                </div>
                <div>
                  <p className="text-[13px] text-[color:var(--text-primary)]">{identity.data.email ?? "No email"}</p>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">{identity.data.workspace_role}</p>
                </div>
              </div>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/90 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Keyboard size={15} className="text-[color:var(--text-muted)]" />
            <h4 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Preferences</h4>
          </div>
          {state.loading ? <LoadingCard /> : null}
          {!state.loading && preferences?.state === "error" ? <MutedError title="Preferences unavailable" body={preferences.error_message_safe ?? "Temporarily unavailable"} onRetry={() => void load()} /> : null}
          {!state.loading && preferences?.state === "empty" ? <p className="text-[12px] text-[color:var(--text-muted)]">No preferences configured yet.</p> : null}
          {!state.loading && preferences?.state === "ready" && preferences.data ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-[12px] text-[color:var(--text-secondary)]">
                <Globe2 size={13} className="mr-1 inline" /> Language: {preferences.data.language ?? "System default"}
              </div>
              <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-[12px] text-[color:var(--text-secondary)]">
                Timezone: {preferences.data.timezone ?? "Not set"}
              </div>
              <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Keyboard Shortcuts</p>
                <ul className="mt-2 space-y-1">
                  {preferences.data.keyboard_shortcuts.map((shortcut) => (
                    <li key={shortcut.id} className="flex items-center justify-between text-[12px] text-[color:var(--text-secondary)]">
                      <span>{shortcut.label}</span>
                      <code className="rounded-md border border-[color:var(--os-border-soft)] px-1.5 py-0.5 text-[11px]">{shortcut.combo}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/90 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Shield size={15} className="text-[color:var(--text-muted)]" />
            <h4 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Security</h4>
          </div>
          {state.loading ? <LoadingCard /> : null}
          {!state.loading && security?.state === "error" ? <MutedError title="Security unavailable" body={security.error_message_safe ?? "Temporarily unavailable"} onRetry={() => void load()} /> : null}
          {!state.loading && security?.state === "empty" ? <p className="text-[12px] text-[color:var(--text-muted)]">No active sessions found.</p> : null}
          {!state.loading && security?.state === "ready" && security.data ? (
            <div className="space-y-2">
              {security.data.sessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
                  <p className="text-[12px] text-[color:var(--text-primary)]">{session.device}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{session.location} · {new Date(session.last_seen_at).toLocaleString()}</p>
                </div>
              ))}
              <button type="button" onClick={onSignOut} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)]">
                <LogOut size={12} /> Sign out
              </button>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/90 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Download size={15} className="text-[color:var(--text-muted)]" />
            <h4 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Privacy</h4>
          </div>
          {state.loading ? <LoadingCard /> : null}
          {!state.loading && privacy?.state === "error" ? <MutedError title="Privacy unavailable" body={privacy.error_message_safe ?? "Temporarily unavailable"} onRetry={() => void load()} /> : null}
          {!state.loading && privacy?.state === "empty" ? <p className="text-[12px] text-[color:var(--text-muted)]">No privacy controls available.</p> : null}
          {!state.loading && privacy?.state === "ready" && privacy.data ? (
            <div className="space-y-3">
              <p className="text-[12px] text-[color:var(--text-secondary)]">{privacy.data.retention_summary}</p>
              <div className="flex flex-wrap gap-2">
                {privacy.data.export_available ? (
                  <button type="button" className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)]">
                    <Download size={12} /> Export data
                  </button>
                ) : null}
                {privacy.data.delete_account_available ? (
                  <button type="button" className="inline-flex items-center gap-1 rounded-full border border-rose-300/50 bg-rose-500/10 px-3 py-1 text-[11px] text-rose-700">
                    <Trash2 size={12} /> Delete account
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
