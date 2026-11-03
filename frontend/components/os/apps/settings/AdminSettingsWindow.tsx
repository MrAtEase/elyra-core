"use client";

import { useState } from "react";
import {
  Users, Shield, FileText, Activity, ChevronRight,
  UserCheck, AlertCircle, Check, X, Clock, Plus,
  BarChart2, Mail, Building2, Settings, Trash2,
} from "lucide-react";

type Section = "members" | "policies" | "audit" | "usage";

const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }> }[] = [
  { id: "members",  label: "Members & Roles", icon: Users },
  { id: "policies", label: "Policies",         icon: Shield },
  { id: "audit",    label: "Audit Log",        icon: FileText },
  { id: "usage",    label: "Usage",            icon: BarChart2 },
];

type RoleColor = "violet" | "blue" | "emerald" | "slate";

const MEMBERS = [
  { id: "u1", name: "Paul Arndt",   email: "paul@elyra-core.app",   role: "Founder", avatar: "PA", roleColor: "violet" as RoleColor, active: true,  lastSeen: "Now" },
  { id: "u2", name: "Sarah Chen",   email: "sarah@elyra-core.app",  role: "Admin",   avatar: "SC", roleColor: "blue" as RoleColor,   active: true,  lastSeen: "2 min ago" },
  { id: "u3", name: "Max Weber",    email: "max@elyra-core.app",    role: "Member",  avatar: "MW", roleColor: "emerald" as RoleColor, active: true,  lastSeen: "15 min ago" },
  { id: "u4", name: "Lisa Park",    email: "lisa@elyra-core.app",   role: "Member",  avatar: "LP", roleColor: "emerald" as RoleColor, active: false, lastSeen: "2 days ago" },
  { id: "u5", name: "Tom Fischer",  email: "tom@fish-delish.com",   role: "Guest",   avatar: "TF", roleColor: "slate" as RoleColor,  active: true,  lastSeen: "1 hr ago" },
];

const POLICIES = [
  { id: "p1", label: "Require approval for mail sends", desc: "All outbound emails must be approved by an admin before delivery", enabled: true },
  { id: "p2", label: "Strict audit logging",            desc: "Log all AI actions, file accesses, and integration calls", enabled: true },
  { id: "p3", label: "Cross-workspace bridge: manual gate", desc: "Sharing data between workspaces requires manual approval", enabled: true },
  { id: "p4", label: "Auto-expire guest access",        desc: "Guest roles are automatically revoked after 30 days", enabled: false },
  { id: "p5", label: "Two-factor authentication",       desc: "Require 2FA for all admin and owner accounts", enabled: false },
];

const AUDIT_ENTRIES = [
  { id: "a1", actor: "Paul Arndt",  action: "Approved",  resource: "Mail draft → sarah@vendor.com", time: "2 min ago",   status: "success" },
  { id: "a2", actor: "Elli (AI)",   action: "Created",   resource: "Calendar event: Q4 Review",      time: "14 min ago",  status: "success" },
  { id: "a3", actor: "Sarah Chen",  action: "Changed",   resource: "Policy: Audit logging → strict", time: "1 hr ago",    status: "info" },
  { id: "a4", actor: "Elli (AI)",   action: "Blocked",   resource: "Cross-workspace data request",    time: "3 hr ago",    status: "warn" },
  { id: "a5", actor: "Paul Arndt",  action: "Published", resource: "Workflow: New Lead Qualification", time: "Yesterday",   status: "success" },
  { id: "a6", actor: "Elli (AI)",   action: "Failed",    resource: "Google Drive sync (auth error)",  time: "2 days ago",  status: "error" },
  { id: "a7", actor: "Max Weber",   action: "Invited",   resource: "Workspace invite → lisa@elyra",  time: "3 days ago",  status: "success" },
];

const ROLE_COLORS: Record<RoleColor, { bg: string; text: string }> = {
  violet:  { bg: "rgba(139,92,246,0.12)", text: "#a78bfa" },
  blue:    { bg: "rgba(59,130,246,0.12)", text: "#60a5fa" },
  emerald: { bg: "rgba(16,185,129,0.12)", text: "#34d399" },
  slate:   { bg: "rgba(148,163,184,0.1)", text: "#94a3b8" },
};

const STATUS_COLORS: Record<string, { icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>; color: string; bg: string }> = {
  success: { icon: Check,        color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  info:    { icon: FileText,     color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
  warn:    { icon: AlertCircle,  color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  error:   { icon: X,            color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
};

export default function AdminSettingsWindow() {
  const [section, setSection] = useState<Section>("members");
  const [policies, setPolicies] = useState(POLICIES);
  const [members] = useState(MEMBERS);

  function togglePolicy(id: string) {
    setPolicies((prev) => prev.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p));
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-48 flex-shrink-0 flex-col border-r py-2" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className="flex w-full items-center gap-2.5 rounded-lg mx-2 px-3 py-2.5 text-left transition"
            style={{
              width: "calc(100% - 16px)",
              background: section === id ? "var(--os-accent-faint, rgba(108,156,252,0.12))" : "transparent",
              color: section === id ? "var(--os-accent)" : "var(--text-secondary)",
            }}
          >
            <Icon size={14} />
            <span className="text-sm">{label}</span>
            {section === id && <ChevronRight size={12} className="ml-auto opacity-50" />}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* MEMBERS */}
        {section === "members" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Team Members</h3>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{members.filter((m) => m.active).length} active · {members.length} total</p>
              </div>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-white transition"
                style={{ background: "var(--os-accent)" }}
              >
                <Plus size={12} /> Invite member
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--os-border-faint)" }}>
              {members.map((member, i) => {
                const rc = ROLE_COLORS[member.roleColor];
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.02]"
                    style={{ borderBottom: i < members.length - 1 ? "1px solid var(--os-border-faint)" : undefined }}
                  >
                    {/* Avatar */}
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                      style={{ background: rc.bg, color: rc.text }}
                    >
                      {member.avatar}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{member.name}</p>
                        {!member.active && <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)" }}>Inactive</span>}
                      </div>
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{member.email}</p>
                    </div>
                    {/* Role badge */}
                    <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: rc.bg, color: rc.text }}>
                      {member.role}
                    </span>
                    {/* Last seen */}
                    <span className="flex-shrink-0 text-[10px]" style={{ color: "var(--text-tertiary)" }}>{member.lastSeen}</span>
                    {/* Actions */}
                    <button type="button" className="flex-shrink-0 rounded-lg p-1.5 text-white/30 transition hover:bg-white/8 hover:text-white/60">
                      <Settings size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* POLICIES */}
        {section === "policies" && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Access Policies</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Govern how Elli and team members can act within this workspace</p>
            </div>
            <div className="space-y-2">
              {policies.map((policy) => (
                <div
                  key={policy.id}
                  className="flex items-start gap-4 rounded-xl border px-4 py-3.5"
                  style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{policy.label}</p>
                      {policy.enabled && <Check size={11} style={{ color: "var(--os-accent)" }} />}
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{policy.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePolicy(policy.id)}
                    className="relative mt-0.5 h-6 w-10 flex-shrink-0 rounded-full transition-colors"
                    style={{ background: policy.enabled ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}
                  >
                    <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: policy.enabled ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AUDIT */}
        {section === "audit" && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Audit Log</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>All AI actions, policy changes, and security events</p>
            </div>
            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--os-border-faint)" }}>
              {AUDIT_ENTRIES.map((entry, i) => {
                const status = STATUS_COLORS[entry.status] ?? STATUS_COLORS["info"]!;
                const StatusIcon = status.icon;
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: i < AUDIT_ENTRIES.length - 1 ? "1px solid var(--os-border-faint)" : undefined }}
                  >
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: status.bg }}>
                      <StatusIcon size={11} style={{ color: status.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs" style={{ color: "var(--text-primary)" }}>
                        <span className="font-medium">{entry.actor}</span>
                        {" · "}
                        <span style={{ color: "var(--text-tertiary)" }}>{entry.action}</span>
                        {" · "}
                        <span className="truncate">{entry.resource}</span>
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      <Clock size={9} className="mr-1 inline" />
                      {entry.time}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* USAGE */}
        {section === "usage" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Usage & Quotas</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Current billing period: March 2026</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "AI Credits Used",  value: "3,842",  total: "10,000", color: "var(--os-accent)" },
                { label: "Active Members",   value: "4",      total: "10",     color: "#22c55e" },
                { label: "Workflows Runs",   value: "321",    total: "1,000",  color: "#f59e0b" },
                { label: "Files Processed",  value: "1.2 GB", total: "50 GB",  color: "#a78bfa" },
                { label: "Mail Sends",       value: "28",     total: "500",    color: "#38bdf8" },
                { label: "API Calls",        value: "12,440", total: "50,000", color: "#f472b6" },
              ].map(({ label, value, total, color }) => (
                <div key={label} className="rounded-xl border p-4" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{label}</p>
                  <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>of {total}</p>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--bg-surface)" }}>
                    <div className="h-full rounded-full" style={{ width: "38%", background: color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
