"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, Check, Copy, Crown, Link2, Lock, LogOut, Mail, Shield, Trash2, UserPlus, Users, Eye, User,
} from "lucide-react";

type Role = "owner" | "admin" | "member" | "viewer";

type Member = {
  userId: string;
  email: string | null;
  name: string | null;
  role: Role;
  joinedAt: number | null;
  lastLoginAt: number | null;
  isMe: boolean;
};

type Invite = { id: string; email: string; role: Role; createdAt: number; expiresAt: number };
type Activity = { id: string; action: string; actor: string | null; meta: Record<string, unknown>; at: number };

type TeamState = {
  workspace: { id: string; name: string; type: string; teamEnabled: boolean };
  me: { userId: string; role: Role; canManage: boolean };
  members: Member[];
  invites: Invite[];
  activity: Activity[];
};

const ROLE_INFO: Record<Role, { label: string; text: string; icon: typeof Crown; tone: string }> = {
  owner: {
    label: "Owner",
    text: "Volle Verantwortung: verwaltet das Team, vergibt alle Rollen inklusive Owner.",
    icon: Crown,
    tone: "#a78bfa",
  },
  admin: {
    label: "Admin",
    text: "Lädt Personen ein, ändert Rollen bis Admin und entfernt Mitglieder. Owner bleiben unangetastet.",
    icon: Shield,
    tone: "#60a5fa",
  },
  member: {
    label: "Mitglied",
    text: "Arbeitet im Workspace mit Elly, Apps und geteilten Daten. Keine Team-Verwaltung.",
    icon: User,
    tone: "#34d399",
  },
  viewer: {
    label: "Gast",
    text: "Für Externe, z. B. Freelancer oder Kunden: Zugang zum Workspace, keine Team-Verwaltung.",
    icon: Eye,
    tone: "#94a3b8",
  },
};

const ROLE_ORDER: Role[] = ["owner", "admin", "member", "viewer"];

const ACTIVITY_LABEL: Record<string, string> = {
  invite_created: "hat eingeladen",
  invite_revoked: "hat eine Einladung zurückgezogen",
  invite_accepted: "ist beigetreten",
  role_changed: "hat eine Rolle geändert",
  member_removed: "hat ein Mitglied entfernt",
  member_left: "hat den Workspace verlassen",
  workspace_deleted: "hat den Workspace gelöscht",
};

const card = { borderColor: "var(--os-border-faint, rgba(255,255,255,0.08))", background: "var(--bg-elevated, rgba(255,255,255,0.03))" };

function initials(member: { name: string | null; email: string | null }): string {
  const source = (member.name || member.email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function relative(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
}

function describeActivity(entry: Activity): string {
  const label = ACTIVITY_LABEL[entry.action] ?? entry.action;
  const meta = entry.meta;
  const email = typeof meta.email === "string" ? meta.email : null;
  if (entry.action === "role_changed") {
    const from = ROLE_INFO[meta.from as Role]?.label ?? String(meta.from ?? "");
    const to = ROLE_INFO[meta.to as Role]?.label ?? String(meta.to ?? "");
    return `${label}: ${from} → ${to}`;
  }
  if (entry.action === "invite_created" && email) {
    return `${label}: ${email} als ${ROLE_INFO[meta.role as Role]?.label ?? meta.role}`;
  }
  return email ? `${label} (${email})` : label;
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { message?: string; error?: string } }> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string; ok?: boolean };
  return { ok: response.ok && data.ok !== false, data };
}

function RoleBadge({ role }: { role: Role }) {
  const info = ROLE_INFO[role];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ background: `color-mix(in srgb, ${info.tone} 14%, transparent)`, color: info.tone }}
    >
      <info.icon size={11} /> {info.label}
    </span>
  );
}

export default function TeamPanel({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const { ok, data } = await api<TeamState>(`/api/os/team?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (ok) {
      // A display name that is just the email adds nothing.
      setState({
        ...data,
        members: data.members.map((m) => ({ ...m, name: m.name && m.name !== m.email ? m.name : null })),
      });
      setError(null);
    } else {
      setError(data.message ?? "Team konnte nicht geladen werden.");
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const me = state?.me;
  const assignableRoles = useMemo<Role[]>(
    () => (me?.role === "owner" ? ROLE_ORDER : ROLE_ORDER.filter((r) => r !== "owner")),
    [me?.role],
  );

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  };

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!state || inviteBusy) return;
    setInviteBusy(true);
    setError(null);
    const { ok, data } = await api<{ token: string; invite: Invite }>("/api/os/team/invites", {
      method: "POST",
      body: JSON.stringify({ workspaceId, email: inviteEmail, role: inviteRole }),
    });
    setInviteBusy(false);
    if (!ok) {
      setError(data.message ?? "Einladung fehlgeschlagen.");
      return;
    }
    setInviteLink({ email: data.invite.email, url: `${window.location.origin}/invite/${data.token}` });
    setCopied(false);
    setInviteEmail("");
    await load();
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function changeRole(member: Member, role: Role) {
    const { ok, data } = await api(`/api/os/team/members/${encodeURIComponent(member.userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ workspaceId, role }),
    });
    if (!ok) setError(data.message ?? "Rolle konnte nicht geändert werden.");
    else flash(`${member.name || member.email} ist jetzt ${ROLE_INFO[role].label}.`);
    await load();
  }

  async function removeMember(member: Member) {
    setConfirmRemove(null);
    const { ok, data } = await api(
      `/api/os/team/members/${encodeURIComponent(member.userId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
    if (!ok) {
      setError(data.message ?? "Entfernen fehlgeschlagen.");
      return;
    }
    if (member.isMe) {
      window.location.assign("/os");
      return;
    }
    flash(`${member.name || member.email} wurde entfernt.`);
    await load();
  }

  async function revokeInvite(invite: Invite) {
    const { ok, data } = await api(
      `/api/os/team/invites/${encodeURIComponent(invite.id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    );
    if (!ok) setError(data.message ?? "Zurückziehen fehlgeschlagen.");
    else flash(`Einladung für ${invite.email} zurückgezogen.`);
    await load();
  }

  async function createCompany(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    const { ok, data } = await api<{ activeWorkspace?: { id?: string } }>("/api/os/team/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: companyName }),
    });
    setCreating(false);
    if (!ok) {
      setError(data.message ?? "Workspace konnte nicht angelegt werden.");
      return;
    }
    const id = data.activeWorkspace?.id;
    window.location.assign(id ? `/os?workspaceId=${encodeURIComponent(id)}` : "/os");
  }

  async function deleteWorkspace() {
    if (!state || deleting) return;
    setDeleting(true);
    setError(null);
    const { ok, data } = await api("/api/os/team/workspaces", {
      method: "DELETE",
      body: JSON.stringify({ workspaceId, confirmName: deleteName }),
    });
    setDeleting(false);
    if (!ok) {
      setError(data.message ?? "Löschen fehlgeschlagen.");
      return;
    }
    window.location.assign("/os?workspaceId=ws-personal");
  }

  if (loading && !state) {
    return <p className="p-6 text-sm" style={{ color: "var(--text-tertiary)" }}>Team wird geladen …</p>;
  }

  if (!state) {
    return (
      <div className="p-6">
        <p className="text-sm" style={{ color: "#f87171" }}>{error ?? "Team konnte nicht geladen werden."}</p>
      </div>
    );
  }

  const { workspace, members, invites, activity } = state;
  const canManage = Boolean(me?.canManage);
  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-tertiary)" }}>
            {workspace.type === "system_platform"
              ? "System-Workspace"
              : workspace.teamEnabled
                ? "Firmen-Workspace"
                : "Persönlicher Workspace"}
          </p>
          <h2 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{workspace.name}</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {workspace.teamEnabled
              ? `${members.length} ${members.length === 1 ? "Mitglied" : "Mitglieder"}${invites.length ? ` · ${invites.length} offene ${invites.length === 1 ? "Einladung" : "Einladungen"}` : ""}`
              : "Nur du hast Zugriff."}
          </p>
        </div>
        {me && <RoleBadge role={me.role} />}
      </div>

      {(error || notice) && (
        <div
          className="rounded-xl border px-4 py-2.5 text-xs"
          style={
            error
              ? { borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "#f87171" }
              : { borderColor: "rgba(52,211,153,0.35)", background: "rgba(52,211,153,0.08)", color: "#34d399" }
          }
        >
          {error ?? notice}
        </div>
      )}

      {/* Personal workspace: private by design */}
      {!workspace.teamEnabled && (
        <section className="rounded-2xl border p-5" style={card}>
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: "rgba(167,139,250,0.14)", color: "#a78bfa" }}>
              <Lock size={16} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Dieser Workspace bleibt privat</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Mails, Termine und Notizen in deinem persönlichen Workspace sieht niemand außer dir – auch kein Admin.
                Für die Zusammenarbeit legst du einen eigenen Firmen-Workspace an. Du wirst dort Owner und lädst dein Team ein.
              </p>
              <form onSubmit={createCompany} className="mt-4 flex flex-wrap gap-2">
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Name, z. B. Muster GmbH"
                  maxLength={80}
                  className="min-w-[220px] flex-1 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
                />
                <button
                  type="submit"
                  disabled={creating || companyName.trim().length < 2}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
                  style={{ background: "var(--os-accent)" }}
                >
                  <Building2 size={13} /> {creating ? "Wird angelegt …" : "Firmen-Workspace anlegen"}
                </button>
              </form>
            </div>
          </div>
        </section>
      )}

      {/* Invite */}
      {workspace.teamEnabled && canManage && (
        <section className="rounded-2xl border p-5" style={card}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <UserPlus size={15} /> Person einladen
          </p>
          <form onSubmit={sendInvite} className="mt-3 flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Mail size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@firma.de"
                className="w-full rounded-xl border bg-transparent py-2 pl-8 pr-3 text-sm outline-none"
                style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
              />
            </div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
              aria-label="Rolle"
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>{ROLE_INFO[role].label}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={inviteBusy}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
              style={{ background: "var(--os-accent)" }}
            >
              {inviteBusy ? "Wird erstellt …" : "Einladen"}
            </button>
          </form>

          {inviteLink && (
            <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "rgba(96,165,250,0.35)", background: "rgba(96,165,250,0.06)" }}>
              <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                <Link2 size={12} /> Einladungslink für {inviteLink.email}
              </p>
              <div className="mt-2 flex gap-2">
                <code className="flex-1 truncate rounded-lg px-2 py-1.5 text-[11px]" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                  {inviteLink.url}
                </code>
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 text-[11px]"
                  style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Kopiert" : "Kopieren"}
                </button>
              </div>
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Der Link wird nur jetzt angezeigt, gilt 7 Tage und funktioniert nur mit dieser E-Mail-Adresse.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Members */}
      {workspace.teamEnabled && (
        <section>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
            <Users size={12} /> Mitglieder
          </p>
          <div className="overflow-hidden rounded-2xl border" style={card}>
            {members.map((member, index) => {
              const info = ROLE_INFO[member.role];
              const lastOwner = member.role === "owner" && ownerCount <= 1;
              const canEditRole =
                canManage && !lastOwner && (me?.role === "owner" || member.role !== "owner");
              const canRemove = !lastOwner && (member.isMe || (canManage && (me?.role === "owner" || member.role !== "owner")));
              return (
                <div
                  key={member.userId}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                  style={{ borderTop: index ? "1px solid var(--os-border-faint)" : undefined }}
                >
                  <div
                    className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl text-xs font-bold"
                    style={{ background: `color-mix(in srgb, ${info.tone} 16%, transparent)`, color: info.tone }}
                  >
                    {initials(member)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {member.name || member.email}
                      {member.isMe && (
                        <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                          Du
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {member.name ? `${member.email} · ` : ""}dabei seit {formatDate(member.joinedAt)}
                    </p>
                  </div>

                  {canEditRole && !member.isMe ? (
                    <select
                      value={member.role}
                      onChange={(e) => void changeRole(member, e.target.value as Role)}
                      className="rounded-lg border bg-transparent px-2 py-1 text-xs outline-none"
                      style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
                      aria-label={`Rolle von ${member.email}`}
                    >
                      {assignableRoles.map((role) => (
                        <option key={role} value={role}>{ROLE_INFO[role].label}</option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

                  {canRemove &&
                    (confirmRemove === member.userId ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void removeMember(member)}
                          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-white"
                          style={{ background: "#ef4444" }}
                        >
                          {member.isMe ? "Ja, verlassen" : "Ja, entfernen"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(null)}
                          className="rounded-lg px-2 py-1 text-[11px]"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          Abbrechen
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(member.userId)}
                        className="rounded-lg p-1.5 transition hover:bg-white/10"
                        style={{ color: "var(--text-tertiary)" }}
                        title={member.isMe ? "Workspace verlassen" : "Aus dem Workspace entfernen"}
                        aria-label={member.isMe ? "Workspace verlassen" : "Aus dem Workspace entfernen"}
                      >
                        {member.isMe ? <LogOut size={13} /> : <Trash2 size={13} />}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Open invites */}
      {workspace.teamEnabled && canManage && invites.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
            Offene Einladungen
          </p>
          <div className="overflow-hidden rounded-2xl border" style={card}>
            {invites.map((invite, index) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{ borderTop: index ? "1px solid var(--os-border-faint)" : undefined }}
              >
                <Mail size={13} style={{ color: "var(--text-tertiary)" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" style={{ color: "var(--text-primary)" }}>{invite.email}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>gültig bis {formatDate(invite.expiresAt)}</p>
                </div>
                <RoleBadge role={invite.role} />
                <button
                  type="button"
                  onClick={() => void revokeInvite(invite)}
                  className="rounded-lg px-2 py-1 text-[11px] transition hover:bg-white/10"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Zurückziehen
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Roles */}
      <section>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>Rollen</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLE_ORDER.map((role) => {
            const info = ROLE_INFO[role];
            return (
              <div key={role} className="rounded-xl border p-3" style={card}>
                <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: info.tone }}>
                  <info.icon size={13} /> {info.label}
                </p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{info.text}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
          <Lock size={11} className="mt-0.5 flex-shrink-0" />
          Persönliche Workspaces sind für alle Rollen tabu – auch für Owner und Admins dieses Workspace.
        </p>
      </section>

      {/* Activity */}
      {workspace.teamEnabled && canManage && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>Verlauf</p>
          {activity.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Noch keine Änderungen am Team.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border" style={card}>
              {activity.map((entry, index) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-xs"
                  style={{ borderTop: index ? "1px solid var(--os-border-faint)" : undefined }}
                >
                  <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                    <span className="font-medium">{entry.actor ?? "Unbekannt"}</span>{" "}
                    <span style={{ color: "var(--text-secondary)" }}>{describeActivity(entry)}</span>
                  </span>
                  <span className="flex-shrink-0 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{relative(entry.at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {/* Danger zone: owners of a company workspace */}
      {workspace.teamEnabled && workspace.type !== "system_platform" && me?.role === "owner" && (
        <section className="rounded-2xl border p-5" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.04)" }}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#f87171" }}>
            <Trash2 size={14} /> Workspace löschen
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Entfernt den Workspace mit allen Mitgliedschaften, Einladungen und Einstellungen. Das kann nicht rückgängig gemacht werden.
            Der Verlauf im Audit-Log bleibt erhalten. Tippe zur Bestätigung <b>{workspace.name}</b> ein.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
              placeholder={workspace.name}
              className="min-w-[200px] flex-1 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
              style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--text-primary)" }}
              aria-label="Name des Workspace zur Bestätigung"
            />
            <button
              type="button"
              disabled={deleting || deleteName.trim() !== workspace.name.trim()}
              onClick={() => void deleteWorkspace()}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
              style={{ background: "#ef4444" }}
            >
              {deleting ? "Wird gelöscht …" : "Endgültig löschen"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
