"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { fetchGoogleStatus, type GoogleStatusResponse } from "@/components/os/apps/liveGoogleClient";
import { useWhoamiLoader } from "@/lib/auth/useWhoamiLoader";
import { THEME_REGISTRY, THEME_KEYS, type ThemeKey, isThemeKey } from "@/lib/theme/themeRegistry";
import { ensureSupabaseToken } from "@/lib/supabase/browser";

const ELYRA_THEME_KEY = "elyra_theme";

function applyTheme(key: ThemeKey) {
  document.documentElement.setAttribute("data-theme", key);
  window.localStorage.setItem(ELYRA_THEME_KEY, key);
}

function getStoredTheme(): ThemeKey {
  if (typeof window === "undefined") return "cyber";
  const stored = window.localStorage.getItem(ELYRA_THEME_KEY);
  if (stored && isThemeKey(stored)) return stored;
  return "cyber";
}

const VALID_SECTIONS = [
  "profile",
  "settings",
  "integrations",
  "ai",
  "billing",
  "workspace",
  "members",
  "platform",
] as const;

type SectionKey = (typeof VALID_SECTIONS)[number];

const SECTION_TITLES: Record<SectionKey, string> = {
  profile: "Profile",
  settings: "Appearance & Controls",
  integrations: "Integrations",
  ai: "AI Settings",
  billing: "Billing",
  workspace: "Workspace",
  members: "Members & Roles",
  platform: "Platform Admin",
};

const SECTION_DESCRIPTIONS: Record<SectionKey, string> = {
  profile: "Manage your identity, active workspace, and connected workspaces.",
  settings: "Dial in your preferred theme, language, and usability defaults.",
  integrations: "Keep your Google & workspace connections in check.",
  ai: "Control models, memory, and budget behavior for this workspace.",
  billing: "Track credits, usage, and billing notes.",
  workspace: "Review workspace purpose, policies, and meta info.",
  members: "Invite members, adjust roles, and keep the roster tidy.",
  platform: "High-level platform controls for Elyra Core administrators.",
};

const THEME_STORAGE_KEY = "elyra-theme-preference";
const LANGUAGE_STORAGE_KEY = "elyra-language-preference";
const GRAPH_MEMORY_KEY = "elyra-graph-memory-enabled";
const BUDGET_STORAGE_KEY = "elyra-budget-limit";

type ThemeOption = "auto" | "light" | "dark";
type ModelPreference = "fast" | "deep";

type SettingsSectionContentProps = {
  section: string;
};

// Shared CSS classes using design system variables
const panel = "rounded-3xl border p-5";
const card = "rounded-2xl border p-4";
const label = "text-[10px] uppercase tracking-[0.2em]";
const muted = "text-[color:var(--text-tertiary)]";
const secondary = "text-[color:var(--text-secondary)]";
const primary = "text-[color:var(--text-primary)]";
const borderSoft = "border-[color:var(--os-border-soft)]";
const bgSurface = "bg-[color:var(--bg-surface)]";
const bgElevated = "bg-[color:var(--bg-elevated)]";
const bgCanvas = "bg-[color:var(--bg-canvas)]";

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-[11px] transition ${
        active ? `${borderSoft} ${bgSurface} ${primary}` : `${borderSoft} ${muted}`
      }`}
    >
      {children}
    </button>
  );
}

function ActionButton({
  href,
  children,
  onClick,
}: {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const cls = `rounded-xl border ${borderSoft} ${bgSurface} px-3 py-2 text-sm ${secondary} transition hover:${bgElevated} hover:${primary}`;
  if (href) {
    return (
      <Link href={href} className={cls} {...(onClick ? { onClick } : {})}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export default function SettingsSectionContent({ section }: SettingsSectionContentProps) {
  const normalized = (section ?? "profile").toLowerCase();
  const sectionKey: SectionKey = VALID_SECTIONS.includes(normalized as SectionKey)
    ? (normalized as SectionKey)
    : "profile";

  const { data: whoami, loading, authState } = useWhoamiLoader();

  const [googleStatus, setGoogleStatus] = useState<GoogleStatusResponse | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const activeWorkspaceId = whoami?.activeWorkspace?.id ?? null;
  const activeWorkspaceType = (whoami?.activeWorkspace?.type ?? "").toLowerCase();
  const isPersonalWorkspace = activeWorkspaceType === "individual" || activeWorkspaceType === "personal";

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchGoogleStatus(activeWorkspaceId);
        if (!cancelled) {
          setGoogleStatus(payload);
          setGoogleError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setGoogleError(error instanceof Error ? error.message : "Unable to load status.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const [activeTheme, setActiveTheme] = useState<ThemeKey>(() => getStoredTheme());

  function handleThemeChange(key: ThemeKey) {
    setActiveTheme(key);
    applyTheme(key);
  }

  const [themePreference, setThemePreference] = useState<ThemeOption>(() => {
    if (typeof window === "undefined") return "auto";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeOption | null;
    return stored ?? "auto";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [themePreference]);

  const [languagePreference, setLanguagePreference] = useState<string>(() => {
    if (typeof window === "undefined") return "de";
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "de";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, languagePreference);
  }, [languagePreference]);

  const [modelPreference, setModelPreference] = useState<ModelPreference>("fast");
  const [graphMemoryEnabled, setGraphMemoryEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(GRAPH_MEMORY_KEY) !== "false";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GRAPH_MEMORY_KEY, graphMemoryEnabled ? "true" : "false");
  }, [graphMemoryEnabled]);

  const [budgetLimit, setBudgetLimit] = useState(() => {
    if (typeof window === "undefined") return "1200";
    return window.localStorage.getItem(BUDGET_STORAGE_KEY) ?? "1200";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BUDGET_STORAGE_KEY, budgetLimit);
  }, [budgetLimit]);

  const [platformTab, setPlatformTab] = useState<"customers" | "users">("customers");

  // ── Workspace Brain ──
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainSaving, setBrainSaving] = useState(false);
  const [brainSaved, setBrainSaved] = useState(false);
  const [brainPurpose, setBrainPurpose] = useState("");
  const [brainRole, setBrainRole] = useState("");
  const [brainGoals, setBrainGoals] = useState<string[]>([""]);
  const [brainRules, setBrainRules] = useState<string[]>([""]);
  const [brainLanguage, setBrainLanguage] = useState("de");
  const [brainTone, setBrainTone] = useState<"casual" | "formal" | "direct">("direct");

  useEffect(() => {
    if (!activeWorkspaceId || sectionKey !== "workspace") return;
    let cancelled = false;
    setBrainLoading(true);
    (async () => {
      try {
        const token = await ensureSupabaseToken();
        const res = await fetch(
          `/api/v1/workspace-brain/?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!cancelled && res.ok) {
          const data = (await res.json()) as {
            profile?: {
              purpose?: string;
              goals?: string[];
              operatingRules?: string[];
              preferences?: { language?: string; tone?: string };
              roleFocus?: string;
            };
          };
          const p = data.profile ?? {};
          setBrainPurpose(p.purpose ?? "");
          setBrainRole(p.roleFocus ?? "");
          setBrainGoals(p.goals?.length ? p.goals : [""]);
          setBrainRules(p.operatingRules?.length ? p.operatingRules : [""]);
          setBrainLanguage(p.preferences?.language ?? "de");
          setBrainTone((p.preferences?.tone as "casual" | "formal" | "direct") ?? "direct");
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setBrainLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, sectionKey]);

  const saveBrain = useCallback(async () => {
    if (!activeWorkspaceId || brainSaving) return;
    setBrainSaving(true);
    try {
      const token = await ensureSupabaseToken();
      await fetch(
        `/api/v1/workspace-brain/?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: {
              purpose: brainPurpose,
              roleFocus: brainRole,
              goals: brainGoals.filter((g) => g.trim()),
              operatingRules: brainRules.filter((r) => r.trim()),
              preferences: { language: brainLanguage, tone: brainTone },
            },
          }),
        },
      );
      setBrainSaved(true);
      setTimeout(() => setBrainSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setBrainSaving(false);
    }
  }, [activeWorkspaceId, brainSaving, brainPurpose, brainRole, brainGoals, brainRules, brainLanguage, brainTone]);

  const platformAdminIds = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS ?? "";
    return raw
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }, []);

  const membershipRole = whoami?.membership?.role?.toLowerCase() ?? "";
  const workspaceType = whoami?.activeWorkspace?.type?.toLowerCase() ?? "";
  const canManageWorkspace = ["owner", "manager", "admin"].includes(membershipRole);
  const isOrgOrPlatform = workspaceType === "organization" || workspaceType === "platform";
  const canAccessWorkspaceSection = true; // Everyone can configure their workspace brain
  const canAccessMembers = ["owner", "manager", "admin"].includes(membershipRole);
  const isPlatformAdmin = Boolean(
    whoami?.user?.id && platformAdminIds.includes(whoami.user.id),
  );
  const showPlatformAdmin = isPlatformAdmin && workspaceType === "platform";

  if (loading || authState !== "authenticated") {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm"
        style={{ background: "var(--bg-canvas, #05070f)", color: "var(--text-tertiary)" }}
      >
        Preparing settings…
      </div>
    );
  }

  const displayUserName = whoami?.user?.email?.split("@")[0] ?? "Paul";
  const displayEmail = whoami?.user?.email ?? "hello@elyra-core.app";

  const renderProfileSection = () => (
    <div
      className={`space-y-4 ${panel} ${borderSoft} ${bgSurface}`}
      style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
    >
      <div className="space-y-1">
        <p className={`${label} ${muted}`}>Profile</p>
        <h2 className={`text-xl font-semibold ${primary}`}>{displayUserName}</h2>
        <p className={`text-sm ${secondary}`}>{displayEmail}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div
          className={`${card} ${borderSoft}`}
          style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
        >
          <p className={`text-[11px] uppercase tracking-[0.3em] ${muted}`}>Current workspace</p>
          <p className={`mt-1 text-sm ${primary}`}>
            {whoami?.activeWorkspace?.name ?? whoami?.activeWorkspace?.slug}
          </p>
          <p className={`text-xs ${secondary}`}>{whoami?.membership?.title ?? "Member"}</p>
        </div>
        <div
          className={`${card} ${borderSoft}`}
          style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
        >
          <p className={`text-[11px] uppercase tracking-[0.3em] ${muted}`}>Workspaces</p>
          <ul className={`mt-2 space-y-2 text-sm ${secondary}`}>
            {(whoami?.workspaces ?? []).slice(0, 4).map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between">
                <span>{workspace.name}</span>
                <span className={`text-[11px] uppercase tracking-[0.2em] ${muted}`}>
                  {workspace.type ?? "workspace"}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/os/settings/integrations"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className={`mt-3 inline-flex items-center justify-center rounded-xl border ${borderSoft} ${bgSurface} px-3 py-2 text-[11px] ${secondary} transition hover:${bgElevated} hover:${primary}`}
          >
            Manage connected accounts
          </Link>
        </div>
      </div>
    </div>
  );

  const renderSettingsSection = () => (
    <div
      className={`space-y-6 ${panel} ${borderSoft} ${bgSurface}`}
      style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
    >
      {/* Theme grid */}
      <div>
        <p className={`${label} ${muted}`}>Theme</p>
        <p className={`mt-1 text-xs ${secondary}`}>Changes take effect immediately across all windows</p>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {THEME_REGISTRY.map((descriptor) => {
            const isActive = activeTheme === descriptor.key;
            return (
              <button
                key={descriptor.key}
                type="button"
                onClick={() => handleThemeChange(descriptor.key)}
                className="group relative overflow-hidden rounded-xl border-2 transition-all hover:scale-105"
                style={{
                  borderColor: isActive ? descriptor.preview.accentHint : "var(--os-border-soft, rgba(255,255,255,0.08))",
                  boxShadow: isActive ? `0 0 0 1px ${descriptor.preview.accentHint}44` : undefined,
                }}
                title={descriptor.name}
              >
                {/* Swatch */}
                <div
                  className="flex h-12 items-end justify-start p-1.5"
                  style={{ background: descriptor.preview.bg }}
                >
                  <div className="h-1 rounded-full" style={{ width: "60%", background: descriptor.preview.accentHint, opacity: 0.8 }} />
                </div>
                {/* Label */}
                <div
                  className="border-t px-1.5 py-1"
                  style={{
                    borderColor: "var(--os-border-soft, rgba(255,255,255,0.08))",
                    background: descriptor.preview.panel + "cc",
                  }}
                >
                  <p className="truncate text-center text-[9px]" style={{ color: descriptor.preview.text + "aa" }}>{descriptor.name}</p>
                </div>
                {/* Active checkmark */}
                {isActive && (
                  <div
                    className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ background: descriptor.preview.accentHint }}
                  >
                    <Check size={8} style={{ color: "#000" }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Language */}
      <div>
        <p className={`${label} ${muted}`}>Language</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: "Deutsch", code: "de" },
            { label: "English", code: "en" },
            { label: "Français", code: "fr" },
            { label: "Español", code: "es" },
          ].map((option) => (
            <PillButton
              key={option.code}
              active={languagePreference === option.code}
              onClick={() => setLanguagePreference(option.code)}
            >
              {option.label}
            </PillButton>
          ))}
        </div>
      </div>
    </div>
  );

  const renderIntegrationsSection = () => (
    <div
      className={`space-y-4 ${panel} ${borderSoft} ${bgSurface}`}
      style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
    >
      <div className="space-y-2">
        <p className={`${label} ${muted}`}>
          {isPersonalWorkspace ? "iCloud integration" : "Google integration"}
        </p>
        <p className={`text-sm ${secondary}`}>
          {isPersonalWorkspace
            ? "Connect iCloud Mail und Calendar für deinen Personal Workspace."
            : "Sync your Google calendar, mail, and tasks to let Elli act on your behalf."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={`${card} ${borderSoft}`}
          style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
        >
          <p className={`text-xs ${muted}`}>Connection status</p>
          <p className={`mt-2 text-xl ${primary}`}>
            {googleStatus?.google.connected ? "Connected" : "Disconnected"}
          </p>
        </div>
        <div
          className={`${card} ${borderSoft}`}
          style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
        >
          <p className={`text-xs ${muted}`}>Scopes</p>
          <ul className={`mt-2 space-y-1 text-[11px] ${secondary}`}>
            {googleStatus?.google.scopes?.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
            {!googleStatus?.google.scopes?.length && <li className={muted}>Not requested yet.</li>}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {isPersonalWorkspace && activeWorkspaceId ? (
          <ActionButton href={`/workspace/work/mail?workspace_id=${encodeURIComponent(activeWorkspaceId)}`}>
            Connect iCloud Mail
          </ActionButton>
        ) : (
          <ActionButton
            href={
              activeWorkspaceId
                ? `/api/google/connect?workspaceId=${encodeURIComponent(activeWorkspaceId)}&next=${encodeURIComponent("/os")}`
                : "/api/google/connect?next=%2Fos"
            }
          >
            Connect Google
          </ActionButton>
        )}
        {!isPersonalWorkspace && (
          <ActionButton>Disconnect</ActionButton>
        )}
        {isPersonalWorkspace && activeWorkspaceId && (
          <ActionButton href={`/workspace/work/calendar?workspace_id=${encodeURIComponent(activeWorkspaceId)}`}>
            Connect iCloud Calendar
          </ActionButton>
        )}
      </div>
      {googleError && (
        <p className="text-xs text-rose-500">{googleError}</p>
      )}
    </div>
  );

  const renderAISection = () => (
    <div
      className={`space-y-4 ${panel} ${borderSoft} ${bgSurface}`}
      style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
    >
      <div>
        <p className={`${label} ${muted}`}>Default models</p>
        <div className="mt-3 flex gap-2">
          {[
            { label: "Fast Model", value: "fast" as ModelPreference },
            { label: "Deep Model", value: "deep" as ModelPreference },
          ].map((option) => (
            <PillButton
              key={option.value}
              active={modelPreference === option.value}
              onClick={() => setModelPreference(option.value)}
            >
              {option.label}
            </PillButton>
          ))}
        </div>
      </div>
      <div
        className={`flex items-center justify-between gap-3 ${card} ${borderSoft}`}
        style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
      >
        <div>
          <p className={`text-sm font-semibold ${primary}`}>Graph memory</p>
          <p className={`text-[11px] ${secondary}`}>Enable Elli learning from your workspace graph.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={graphMemoryEnabled}
            onChange={(event) => setGraphMemoryEnabled(event.target.checked)}
            className="h-5 w-5 rounded border focus:ring-0"
            style={{
              borderColor: "var(--os-border-soft)",
              backgroundColor: "var(--bg-canvas)",
              accentColor: "var(--os-accent, #34d399)",
            }}
          />
          <span className={`text-[11px] ${secondary}`}>{graphMemoryEnabled ? "On" : "Off"}</span>
        </label>
      </div>
      <div
        className={`space-y-2 ${card} ${borderSoft}`}
        style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
      >
        <p className={`text-[11px] uppercase tracking-[0.2em] ${muted}`}>Budget limit</p>
        <input
          type="number"
          min={0}
          value={budgetLimit}
          onChange={(event) => setBudgetLimit(event.target.value)}
          className={`w-full rounded-xl border ${borderSoft} px-3 py-2 text-sm ${primary} outline-none focus:ring-1 focus:ring-[color:var(--os-accent,#34d399)]`}
          style={{
            background: "var(--bg-surface, var(--bg-elevated))",
          }}
        />
        <p className={`text-[11px] ${muted}`}>Monthly credits used as a guide only.</p>
      </div>
    </div>
  );

  const renderBillingSection = () => (
    <div
      className={`${panel} ${borderSoft} ${bgSurface}`}
      style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
    >
      <p className={`${label} ${muted}`}>Billing</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div
          className={`${card} ${borderSoft}`}
          style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
        >
          <p className={`text-xs ${muted}`}>Credits balance</p>
          <p className={`mt-2 text-2xl font-semibold ${primary}`}>1,280</p>
        </div>
        <div
          className={`${card} ${borderSoft}`}
          style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
        >
          <p className={`text-xs ${muted}`}>This month</p>
          <p className={`mt-2 text-2xl font-semibold ${primary}`}>384 used</p>
        </div>
      </div>
      <p className={`mt-4 text-[11px] ${muted}`}>Contact billing@elyra-core.app for true invoices.</p>
    </div>
  );

  const renderWorkspaceSection = () => {
    const workspaceName = whoami?.activeWorkspace?.name ?? "this workspace";
    const workspaceKind = whoami?.activeWorkspace?.type?.toLowerCase() ?? "individual";
    const isOrg = workspaceKind === "organization" || workspaceKind === "company";
    const isPlatform = workspaceKind === "platform";

    const goalDefaults = isPlatform
      ? ["Build the Elli AI platform", "Improve agent capabilities", "Grow the user base", "Ship high-quality features fast"]
      : isOrg
      ? ["Build a strong & motivated team", "Achieve product-market fit", "Grow revenue and margins", "Create efficient operations", "Expand market presence"]
      : ["Stay healthy and fit", "Manage personal finances well", "Build meaningful relationships", "Keep learning every day", "Create space for creativity"];

    const ruleDefaults = [
      "Always be concise and action-oriented",
      "Suggest the next best step after every task",
      "Flag risks or blockers proactively",
      "Prioritize high-impact work first",
    ];

    const fieldCls = `w-full rounded-xl border ${borderSoft} bg-[color:var(--bg-canvas)] px-3 py-2 text-sm ${primary} placeholder:text-[color:var(--text-tertiary)] outline-none focus:ring-1 focus:ring-[color:var(--accent)]`;

    return (
      <div className="space-y-4">
        {/* Header */}
        <div
          className={`${panel} ${borderSoft} ${bgSurface}`}
          style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
        >
          <p className={`${label} ${muted}`}>Elly Context — {workspaceName}</p>
          <p className={`mt-2 text-sm ${secondary}`}>
            Tell Elly who you are, what this workspace is for, and what matters most. This context is injected into every conversation — Elly always knows what to prioritize.
          </p>
          {brainLoading && <p className={`mt-2 text-xs ${muted}`}>Loading context…</p>}
        </div>

        {/* Purpose & Role */}
        <div
          className={`${panel} ${borderSoft} ${bgSurface}`}
          style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
        >
          <p className={`${label} ${muted}`}>Purpose & Role</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className={`mb-1.5 text-xs ${secondary}`}>What is this workspace for?</p>
              <textarea
                value={brainPurpose}
                onChange={(e) => setBrainPurpose(e.target.value)}
                placeholder={
                  isOrg
                    ? "Building a healthy food company in Portugal — scaling operations, growing the team, launching products."
                    : isPlatform
                    ? "Building the Elli AI OS platform — the personal operating system for ambitious people."
                    : "Personal life management — health, finances, relationships, learning, and creative projects."
                }
                rows={3}
                className={`${fieldCls} resize-none`}
              />
            </div>
            <div>
              <p className={`mb-1.5 text-xs ${secondary}`}>Your role here</p>
              <input
                value={brainRole}
                onChange={(e) => setBrainRole(e.target.value)}
                placeholder={isOrg ? "CEO & Founder" : isPlatform ? "Founder & Product Lead" : "Owner"}
                className={fieldCls}
              />
            </div>
          </div>
        </div>

        {/* Goals */}
        <div
          className={`${panel} ${borderSoft} ${bgSurface}`}
          style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
        >
          <div className="flex items-center justify-between">
            <p className={`${label} ${muted}`}>Goals</p>
            {brainGoals.filter((g) => g.trim()).length === 0 && (
              <button
                type="button"
                onClick={() => setBrainGoals(goalDefaults)}
                className={`text-[10px] ${muted} hover:text-[color:var(--text-secondary)] transition`}
              >
                Use defaults
              </button>
            )}
          </div>
          <p className={`mt-1 text-xs ${muted}`}>Up to 8 goals Elly should always keep in mind when planning and responding.</p>
          <div className="mt-3 space-y-2">
            {brainGoals.map((goal, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={goal}
                  onChange={(e) => {
                    const updated = [...brainGoals];
                    updated[i] = e.target.value;
                    setBrainGoals(updated);
                  }}
                  placeholder={`Goal ${i + 1}`}
                  className={`${fieldCls} flex-1`}
                />
                {brainGoals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBrainGoals(brainGoals.filter((_, j) => j !== i))}
                    className={`shrink-0 text-[11px] ${muted} hover:text-red-400 transition px-1`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {brainGoals.length < 8 && (
              <button
                type="button"
                onClick={() => setBrainGoals([...brainGoals, ""])}
                className={`text-[11px] ${muted} hover:text-[color:var(--text-secondary)] transition`}
              >
                + Add goal
              </button>
            )}
          </div>
        </div>

        {/* Operating Rules */}
        <div
          className={`${panel} ${borderSoft} ${bgSurface}`}
          style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
        >
          <div className="flex items-center justify-between">
            <p className={`${label} ${muted}`}>Operating Rules</p>
            {brainRules.filter((r) => r.trim()).length === 0 && (
              <button
                type="button"
                onClick={() => setBrainRules(ruleDefaults)}
                className={`text-[10px] ${muted} hover:text-[color:var(--text-secondary)] transition`}
              >
                Use defaults
              </button>
            )}
          </div>
          <p className={`mt-1 text-xs ${muted}`}>How Elly should behave, communicate, and prioritize in this workspace.</p>
          <div className="mt-3 space-y-2">
            {brainRules.map((rule, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={rule}
                  onChange={(e) => {
                    const updated = [...brainRules];
                    updated[i] = e.target.value;
                    setBrainRules(updated);
                  }}
                  placeholder={`Rule ${i + 1}`}
                  className={`${fieldCls} flex-1`}
                />
                {brainRules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBrainRules(brainRules.filter((_, j) => j !== i))}
                    className={`shrink-0 text-[11px] ${muted} hover:text-red-400 transition px-1`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {brainRules.length < 10 && (
              <button
                type="button"
                onClick={() => setBrainRules([...brainRules, ""])}
                className={`text-[11px] ${muted} hover:text-[color:var(--text-secondary)] transition`}
              >
                + Add rule
              </button>
            )}
          </div>
        </div>

        {/* Communication Style */}
        <div
          className={`${panel} ${borderSoft} ${bgSurface}`}
          style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
        >
          <p className={`${label} ${muted}`}>Communication Style</p>
          <div className="mt-3 grid grid-cols-2 gap-6">
            <div>
              <p className={`mb-2 text-xs ${secondary}`}>Language</p>
              <div className="flex flex-wrap gap-2">
                {["de", "en", "fr", "es"].map((lang) => (
                  <PillButton key={lang} active={brainLanguage === lang} onClick={() => setBrainLanguage(lang)}>
                    {lang === "de" ? "Deutsch" : lang === "en" ? "English" : lang === "fr" ? "Français" : "Español"}
                  </PillButton>
                ))}
              </div>
            </div>
            <div>
              <p className={`mb-2 text-xs ${secondary}`}>Tone</p>
              <div className="flex flex-wrap gap-2">
                {(["direct", "casual", "formal"] as const).map((tone) => (
                  <PillButton key={tone} active={brainTone === tone} onClick={() => setBrainTone(tone)}>
                    {tone.charAt(0).toUpperCase() + tone.slice(1)}
                  </PillButton>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Save */}
        <button
          type="button"
          onClick={saveBrain}
          disabled={brainSaving}
          className={`w-full rounded-2xl border px-4 py-3 text-sm font-medium transition ${
            brainSaved
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              : "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)] hover:bg-[color:var(--accent)]/20"
          }`}
        >
          {brainSaving ? "Saving…" : brainSaved ? "✓ Saved — Elly now knows who you are" : `Save ${workspaceName} Context`}
        </button>
      </div>
    );
  };

  const renderMembersSection = () => (
    <div
      className={`space-y-4 ${panel} ${borderSoft} ${bgSurface}`}
      style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
    >
      <p className={`${label} ${muted}`}>Members &amp; Roles</p>
      {canAccessMembers ? (
        <div className="space-y-3">
          {["Owner", "Admin", "Member"].map((role) => (
            <div
              key={role}
              className={`flex items-center justify-between rounded-2xl border ${borderSoft} px-3 py-2`}
              style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
            >
              <span className={secondary}>{role} placeholder</span>
              <span className={`text-[11px] ${muted}`}>Active</span>
            </div>
          ))}
          <button
            type="button"
            className={`mt-2 w-full rounded-xl border ${borderSoft} ${bgSurface} px-3 py-2 text-[11px] ${secondary} transition hover:${bgElevated} hover:${primary}`}
          >
            Invite member
          </button>
        </div>
      ) : (
        <p className={`text-sm ${muted}`}>Members access is owner/manager-only.</p>
      )}
    </div>
  );

  const renderPlatformSection = () => {
    if (!showPlatformAdmin) {
      return (
        <div
          className={`${panel} ${borderSoft} ${bgSurface}`}
          style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
        >
          <p className={`${label} ${muted}`}>Platform Admin</p>
          <p className={`mt-2 text-sm ${muted}`}>Platform administration is limited to platform admins.</p>
        </div>
      );
    }
    return (
      <div
        className={`${panel} ${borderSoft} ${bgSurface}`}
        style={{ background: "var(--bg-surface, var(--bg-elevated))" }}
      >
        <div className="flex items-center justify-between">
          <p className={`${label} ${muted}`}>Platform Admin</p>
          <div className={`flex gap-2 text-[11px] ${secondary}`}>
            {(["customers", "users"] as const).map((tab) => (
              <PillButton key={tab} active={platformTab === tab} onClick={() => setPlatformTab(tab)}>
                {tab === "customers" ? "Customers" : "Users"}
              </PillButton>
            ))}
          </div>
        </div>
        <div className={`mt-4 space-y-2 text-[11px] ${secondary}`}>
          {platformTab === "customers" ? (
            (whoami?.workspaces ?? []).map((workspace) => (
              <div
                key={workspace.id}
                className={`flex items-center justify-between rounded-2xl border ${borderSoft} px-3 py-2`}
                style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
              >
                <span>{workspace.name}</span>
                <span className={`text-[11px] ${muted}`}>{workspace.type ?? "Workspace"}</span>
              </div>
            ))
          ) : (
            ["alice@elyra", "bob@fish-delish", "carlo@elyra"].map((user) => (
              <div
                key={user}
                className={`flex items-center justify-between rounded-2xl border ${borderSoft} px-3 py-2`}
                style={{ background: "var(--bg-canvas, var(--bg-elevated))" }}
              >
                <span>{user}</span>
                <span className={`text-[11px] ${muted}`}>Active</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderSectionContent = () => {
    switch (sectionKey) {
      case "profile":
        return renderProfileSection();
      case "settings":
        return renderSettingsSection();
      case "integrations":
        return renderIntegrationsSection();
      case "ai":
        return renderAISection();
      case "billing":
        return renderBillingSection();
      case "workspace":
        return renderWorkspaceSection();
      case "members":
        return renderMembersSection();
      case "platform":
        return renderPlatformSection();
      default:
        return renderProfileSection();
    }
  };

  return (
    <div
      className="min-h-screen px-6 py-10"
      style={{ background: "var(--bg-canvas, #05070f)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className={`text-[11px] uppercase tracking-[0.3em] ${muted}`}>Account</p>
          <h1 className={`text-4xl font-semibold ${primary}`}>{SECTION_TITLES[sectionKey]}</h1>
          <p className={`text-sm ${secondary}`}>{SECTION_DESCRIPTIONS[sectionKey]}</p>
        </header>
        <div className="space-y-4">{renderSectionContent()}</div>
      </div>
    </div>
  );
}
