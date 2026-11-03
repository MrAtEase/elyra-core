"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Bell,
  Bot,
  Brain,
  Building2,
  Code2,
  CreditCard,
  FileText,
  Flag,
  FlaskConical,
  Gauge,
  HeartPulse,
  KeyRound,
  Keyboard,
  Link2,
  MessageSquare,
  Monitor,
  Palette,
  Shield,
  ShieldCheck,
  User,
  Users,
  X,
} from "lucide-react";
import {
  fetchWorkspaceBrain,
  saveWorkspaceBrain,
  type WorkspaceBrainProfile,
} from "@/components/os/kernel/aiClient";
import type { WorkspaceKind } from "@/components/os/kernel/types";
import {
  startGoogleConnect,
  type GoogleStatusResponse,
} from "@/components/os/apps/liveGoogleClient";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import {
  SHELL_LAYER_DATA_ATTR,
  SHELL_LAYERS,
} from "@/components/os/shell/layers";
import { LANGUAGE_NATIVE_NAMES, type AppLanguage } from "@/lib/i18n";
import { THEME_REGISTRY, type ThemeKey } from "@/lib/theme/themeRegistry";
import { ORB_PRESETS, type OrbVariant } from "@/components/merlin/orbs/orbRegistry";

type OverlayRole = "owner" | "admin" | "member";

type SettingsSectionItem = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  minRole?: OverlayRole;
  kinds?: WorkspaceKind[];
};

type SettingsGroup = {
  id: string;
  label: string;
  minRole?: OverlayRole;
  kinds?: WorkspaceKind[];
  items: SettingsSectionItem[];
};

type SettingsViewProps = {
  open: boolean;
  role: OverlayRole;
  section: string;
  workspaceId: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceKind;
  onSelectSection: (section: string) => void;
  onClose: () => void;
  userName: string;
  userEmail: string;
  workspaceRoleLabel: string;
  googleStatus: GoogleStatusResponse | null;
  onGoogleDisconnect: () => void;
};

type OsSettings = {
  theme: (typeof THEME_OPTIONS)[number]["value"];
  /** Specific theme key from the theme library — overrides the dark/light mode mapping when set. */
  themeKey: ThemeKey | null;
  language: string;   // AppLanguage code or "auto"
  /** Which orb visual variant Elly uses on the desktop. */
  orbVariant: OrbVariant;
  fastModel: string;
  deepModel: string;
  graphMemory: boolean;
  budget: number;
};

type SettingsDetailContext = {
  workspaceId: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceKind;
  workspaceRoleLabel: string;
  userName: string;
  userEmail: string;
  googleStatus: GoogleStatusResponse | null;
  osSettings: OsSettings;
  updateOsSettings: (patch: Partial<OsSettings>) => void;
  onGoogleConnect?: () => void;
  onGithubConnect?: () => void;
  onGoogleDisconnect: () => void;
};

const MEMBER_ROWS = [
  { name: "Paul Odak", email: "paul@elyra-core.app", role: "Founder", avatar: "PO", active: true },
  { name: "Sarah Chen", email: "sarah@elyra-core.app", role: "Admin", avatar: "SC", active: true },
  { name: "Max Weber", email: "max@elyra-core.app", role: "Member", avatar: "MW", active: true },
  { name: "Lisa Park", email: "lisa@elyra-core.app", role: "Member", avatar: "LP", active: false },
  { name: "Tom Fischer", email: "tom@fish-delish.pt", role: "Guest", avatar: "TF", active: true },
];

const ROLE_TEMPLATES = [
  { name: "Founder", perms: ["All access", "System config", "Feature flags", "Billing"] },
  { name: "Admin", perms: ["Workspace settings", "Members", "Integrations", "Audit log"] },
  { name: "Manager", perms: ["Team tasks", "Shared flows", "Reports"] },
  { name: "Member", perms: ["Own tasks", "Mail", "Calendar", "Files"] },
  { name: "Guest", perms: ["Read-only", "Limited apps"] },
];

const GROUPS: SettingsGroup[] = [
  {
    id: "profile",
    label: "Profile",
    items: [
      { id: "profile", label: "Profile", icon: User },
      { id: "sessions", label: "Sessions", icon: Monitor },
    ],
  },
  {
    id: "system",
    label: "Global",
    items: [
      { id: "system-settings", label: "Appearance & Controls", icon: Palette },
      { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
      { id: "developer", label: "Developer", icon: Code2, minRole: "admin" as const },
      { id: "experimental", label: "Experimental", icon: FlaskConical, minRole: "admin" as const },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      { id: "ai", label: "AI Settings", icon: Bot },
      { id: "workspace-brain", label: "Workspace Brain", icon: Brain },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    minRole: "admin",
    kinds: ["organization", "platform"],
    items: [
      { id: "workspace-profile", label: "Workspace Profile", icon: Building2 },
      { id: "members-roles", label: "Members & Roles", icon: Users },
      { id: "billing", label: "Billing & Usage", icon: CreditCard },
      { id: "integrations", label: "Integrations", icon: Link2 },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    minRole: "owner",
    kinds: ["platform"],
    items: [
      { id: "platform-admin", label: "Platform Admin", icon: ShieldCheck },
      { id: "system-admin", label: "System Admin", icon: Shield },
    ],
  },
];

function roleRank(role: OverlayRole): number {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  return 1;
}

function hasRole(role: OverlayRole, minRole?: OverlayRole): boolean {
  if (!minRole) return true;
  return roleRank(role) >= roleRank(minRole);
}

function inWorkspaceKind(workspaceKind: WorkspaceKind, kinds?: WorkspaceKind[]): boolean {
  if (!kinds || kinds.length === 0) return true;
  return kinds.includes(workspaceKind);
}

function roleBadgeText(minRole?: OverlayRole): string | null {
  if (!minRole) return null;
  if (minRole === "owner") return "Founder";
  if (minRole === "admin") return "Admin";
  return null;
}

function roleTone(roleLabel: string): string {
  if (roleLabel === "Founder") return "border-violet-300/25 bg-violet-500/12 text-violet-100";
  if (roleLabel === "Admin") return "border-blue-300/20 bg-blue-500/12 text-blue-100";
  if (roleLabel === "Guest") return "border-[var(--border-strong)] bg-[var(--panel2)] text-[var(--text-secondary)]";
  return "border-white/15 bg-white/[0.05] text-white/90";
}

const THEME_OPTIONS = [
  { value: "auto", label: "System", description: "Follow your device appearance" },
  { value: "dark", label: "Dark", description: "Use the premium dark interface" },
  { value: "light", label: "Light", description: "Use the bright light interface" },
] as const;

const LANGUAGE_OPTIONS: { value: AppLanguage; label: string; description?: string }[] = [
  { value: "auto", label: "Auto", description: "Follows your browser setting" },
  { value: "en",   label: LANGUAGE_NATIVE_NAMES.en },
  { value: "de",   label: LANGUAGE_NATIVE_NAMES.de },
  { value: "hr",   label: LANGUAGE_NATIVE_NAMES.hr },
  { value: "pt",   label: LANGUAGE_NATIVE_NAMES.pt },
  { value: "es",   label: LANGUAGE_NATIVE_NAMES.es },
];

const AI_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "",   label: "Auto (same as UI language)" },
  { value: "en", label: LANGUAGE_NATIVE_NAMES.en },
  { value: "de", label: LANGUAGE_NATIVE_NAMES.de },
  { value: "hr", label: LANGUAGE_NATIVE_NAMES.hr },
  { value: "pt", label: LANGUAGE_NATIVE_NAMES.pt },
  { value: "es", label: LANGUAGE_NATIVE_NAMES.es },
];

const THEME_KEY_EVENT = "elyra:theme-key";
const ORB_VARIANT_EVENT = "elyra:orb-variant";
const LANGUAGE_EVENT = "elyra:language";

// ── Model catalogue (updated 2026-03) ────────────────────────────────────────
// DEV: add new rows here; the select uses <optgroup> automatically.
const MODEL_GROUPS: { group: string; models: { value: string; label: string; badge?: string }[] }[] = [
  {
    group: "Google",
    models: [
      { value: "gemini-3.1-pro",                label: "Gemini 3.1 Pro",           badge: "Latest" },
      { value: "gemini-3.0-flash",              label: "Gemini 3.0 Flash",         badge: "Fast"   },
      { value: "gemini-2.5-pro",                label: "Gemini 2.5 Pro",           badge: "Power"  },
      { value: "gemini-2.5-flash",              label: "Gemini 2.5 Flash"                          },
      { value: "gemini-2.0-flash",              label: "Gemini 2.0 Flash"                          },
      { value: "gemini-2.0-flash-lite",         label: "Gemini 2.0 Flash-Lite",    badge: "Fast"   },
      { value: "gemini-2.0-pro-exp-02-05",      label: "Gemini 2.0 Pro Exp"                        },
      { value: "gemini-1.5-flash",              label: "Gemini 1.5 Flash"                          },
    ],
  },
  {
    group: "Anthropic",
    models: [
      { value: "claude-opus-4-6-20260301",      label: "Claude Opus 4.6",          badge: "Latest" },
      { value: "claude-sonnet-4-6-20260301",    label: "Claude Sonnet 4.6"                         },
      { value: "claude-opus-4-5-20251201",      label: "Claude Opus 4.5",          badge: "Power"  },
      { value: "claude-sonnet-4-5-20251201",    label: "Claude Sonnet 4.5"                         },
      { value: "claude-opus-4-20250514",        label: "Claude Opus 4"                             },
      { value: "claude-sonnet-4-20250514",      label: "Claude Sonnet 4"                           },
      { value: "claude-3-7-sonnet-20250219",    label: "Claude 3.7 Sonnet"                         },
      { value: "claude-3-5-sonnet-20241022",    label: "Claude 3.5 Sonnet"                         },
      { value: "claude-3-5-haiku-20241022",     label: "Claude 3.5 Haiku",         badge: "Fast"   },
      { value: "claude-3-opus-20240229",        label: "Claude 3 Opus"                             },
      { value: "claude-3-haiku-20240307",       label: "Claude 3 Haiku",           badge: "Fast"   },
    ],
  },
  {
    group: "OpenAI",
    models: [
      { value: "gpt-5",                         label: "GPT-5",                    badge: "Latest" },
      { value: "gpt-5-mini",                    label: "GPT-5 Mini",               badge: "Fast"   },
      { value: "gpt-5-codex",                   label: "GPT-5 Codex",              badge: "Code"   },
      { value: "o4-mini",                       label: "o4-mini",                  badge: "Fast"   },
      { value: "o3",                            label: "o3",                       badge: "Power"  },
      { value: "o3-mini",                       label: "o3-mini",                  badge: "Fast"   },
      { value: "gpt-4o",                        label: "GPT-4o"                                    },
      { value: "gpt-4o-mini",                   label: "GPT-4o Mini",              badge: "Fast"   },
      { value: "o1",                            label: "o1",                       badge: "Power"  },
    ],
  },
];
// Flat list for default-value validation
const MODEL_OPTIONS = MODEL_GROUPS.flatMap((g) => g.models);

const MODEL_CATALOG_DATE = "2026-03";

// ── Orb ↔ Theme coupling ──────────────────────────────────────────────────────
// 4 themes: each orb (Elli / Pulse) × each mode (dark / light).
const ORB_THEME_MAP: Partial<Record<ThemeKey, OrbVariant>> = {
  "orb-cosmos":  "ribbonLoop",    // Elli dark
  "elli-light":  "ribbonLoop",    // Elli light
  "pulse-dark":  "thinkingOrb",   // Pulse dark
  "orb-dawn":    "thinkingOrb",   // Pulse light
};

const USER_PREF_KEY = "elyra-os/user-prefs";
const WORKSPACE_PREF_KEY_PREFIX = "elyra-os/workspace-prefs:";
const THEME_MODE_STORAGE_KEY = "elyra_theme_mode";
const THEME_SYNC_EVENT = "elyra:theme-mode";
const DEFAULT_OS_SETTINGS: OsSettings = {
  theme: "auto",
  themeKey: null,
  language: "auto",
  orbVariant: "ribbonLoop",
  fastModel: "gemini-2.0-flash",
  deepModel: "claude-sonnet-4-20250514",
  graphMemory: true,
  budget: 200,
};

function parseSettingsStorage(value: string | null): Partial<OsSettings> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Partial<OsSettings>;
  } catch {
    return null;
  }
}

function loadOsSettings(workspaceId: string): OsSettings {
  if (typeof window === "undefined") {
    return DEFAULT_OS_SETTINGS;
  }
  const userPrefs = parseSettingsStorage(window.localStorage.getItem(USER_PREF_KEY));
  const workspacePrefs = parseSettingsStorage(
    window.localStorage.getItem(`${WORKSPACE_PREF_KEY_PREFIX}${workspaceId}`),
  );

  const rawBudget = workspacePrefs?.budget;
  const parsedBudget =
    typeof rawBudget === "number"
      ? rawBudget
      : Number.isFinite(Number(rawBudget))
        ? Number(rawBudget)
        : DEFAULT_OS_SETTINGS.budget;

  const rawThemeKey = (userPrefs as Record<string, unknown> | null)?.themeKey;
  const storedThemeKey = typeof rawThemeKey === "string" && rawThemeKey ? (rawThemeKey as ThemeKey) : null;

  // Read orb variant — prefer the appearance store (merlin.settings.appearance) which drives the live orb
  const rawOrbVariantFromUser = (userPrefs as Record<string, unknown> | null)?.orbVariant;
  const appearanceRaw = parseSettingsStorage(window.localStorage.getItem("merlin.settings.appearance"));
  const rawOrbVariant = (appearanceRaw as Record<string, unknown> | null)?.orbVariant ?? rawOrbVariantFromUser;
  const storedOrbVariant = typeof rawOrbVariant === "string" && rawOrbVariant ? (rawOrbVariant as OrbVariant) : null;

  return {
    ...DEFAULT_OS_SETTINGS,
    theme: userPrefs?.theme ?? DEFAULT_OS_SETTINGS.theme,
    themeKey: storedThemeKey,
    language: userPrefs?.language ?? DEFAULT_OS_SETTINGS.language,
    orbVariant: storedOrbVariant ?? DEFAULT_OS_SETTINGS.orbVariant,
    fastModel: workspacePrefs?.fastModel ?? DEFAULT_OS_SETTINGS.fastModel,
    deepModel: workspacePrefs?.deepModel ?? DEFAULT_OS_SETTINGS.deepModel,
    graphMemory: workspacePrefs?.graphMemory ?? DEFAULT_OS_SETTINGS.graphMemory,
    budget: parsedBudget,
  };
}

function persistOsSettings(workspaceId: string, settings: OsSettings): void {
  if (typeof window === "undefined") return;
  try {
    const themeMode = settings.theme === "auto" ? "system" : settings.theme;
    // Persist user preferences including optional specific theme key and orb variant
    const userPrefs: Record<string, unknown> = {
      theme: settings.theme,
      language: settings.language,
      orbVariant: settings.orbVariant,
    };
    if (settings.themeKey) userPrefs.themeKey = settings.themeKey;
    window.localStorage.setItem(USER_PREF_KEY, JSON.stringify(userPrefs));
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    window.localStorage.setItem(
      `${WORKSPACE_PREF_KEY_PREFIX}${workspaceId}`,
      JSON.stringify({
        fastModel: settings.fastModel,
        deepModel: settings.deepModel,
        graphMemory: settings.graphMemory,
        budget: settings.budget,
      }),
    );
    // If a specific theme key is set, apply it immediately via dedicated event.
    if (settings.themeKey) {
      window.dispatchEvent(new CustomEvent(THEME_KEY_EVENT, { detail: { themeKey: settings.themeKey } }));
    } else {
      window.dispatchEvent(new CustomEvent(THEME_SYNC_EVENT, { detail: { theme: themeMode } }));
    }
    // Notify the Merlin orb of variant change.
    window.dispatchEvent(new CustomEvent(ORB_VARIANT_EVENT, { detail: { orbVariant: settings.orbVariant } }));
    // Notify LocaleProvider of language change (used by LocaleProvider in WorkspaceShell context).
    window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language: settings.language } }));
  } catch {
    // If localStorage is not writeable, ignore but keep UI responsive.
  }
}

function useOsSettings(workspaceId: string) {
  const [settings, setSettings] = useState<OsSettings>(() => loadOsSettings(workspaceId));

  useEffect(() => {
    setSettings(loadOsSettings(workspaceId));

    let active = true;
    async function fetchPolicies() {
      try {
        const res = await fetch(
          `/api/os/workspace-policies?workspaceId=${encodeURIComponent(workspaceId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok: boolean;
          settings?: { fastModel: string; deepModel: string; graphMemory: boolean; budget: number };
        };
        if (active && json.ok && json.settings) {
          setSettings((prev) => ({
            ...prev,
            fastModel: json.settings!.fastModel,
            deepModel: json.settings!.deepModel,
            graphMemory: json.settings!.graphMemory,
            budget: Number(json.settings!.budget),
          }));
        }
      } catch {
        // If the fetch fails, keep the localStorage defaults — no console noise.
      }
    }
    void fetchPolicies();

    return () => {
      active = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    persistOsSettings(workspaceId, settings);

    const timeoutId = setTimeout(() => {
      void fetch("/api/os/workspace-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          fastModel: settings.fastModel,
          deepModel: settings.deepModel,
          graphMemory: settings.graphMemory,
          budget: settings.budget,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => null) as { error?: string } | null;
          console.error("Failed to save workspace policies:", err?.error ?? res.status);
        }
      }).catch((err) => {
        console.error("Failed to save workspace policies:", err);
      });
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [workspaceId, settings]);

  const updateOsSettings = useCallback((patch: Partial<OsSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  return [settings, updateOsSettings] as const;
}

type WorkspaceBrainDraft = {
  purpose: string;
  goalsText: string;
  operatingRulesText: string;
  language: string;
  tone: string;
  /** AI executive role — used by company/platform workspaces (COO, CFO, CMO, CTO, CPO). */
  aiRole: string;
};

const AI_ROLE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: "",    label: "Elly (Default)",            description: "General AI assistant" },
  { value: "COO", label: "COO — Chief Operating Officer", description: "Operations, processes, efficiency" },
  { value: "CFO", label: "CFO — Chief Financial Officer", description: "Finance, budgets, forecasting" },
  { value: "CMO", label: "CMO — Chief Marketing Officer", description: "Brand, campaigns, growth" },
  { value: "CTO", label: "CTO — Chief Technology Officer", description: "Tech strategy, engineering" },
  { value: "CPO", label: "CPO — Chief Product Officer",    description: "Product vision, roadmap, UX" },
];

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function toLines(value: string[] | undefined): string {
  return Array.isArray(value) ? value.join("\n") : "";
}

function toDraft(profile: WorkspaceBrainProfile | null): WorkspaceBrainDraft {
  return {
    purpose: profile?.purpose ?? "",
    goalsText: toLines(profile?.goals),
    operatingRulesText: toLines(profile?.operatingRules),
    language: profile?.preferences?.language ?? "",
    tone: profile?.preferences?.tone ?? "",
    aiRole: profile?.preferences?.aiRole ?? "",
  };
}

function WorkspaceBrainPanel({
  workspaceId,
  workspaceLabel,
  workspaceKind,
}: {
  workspaceId: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceKind;
}) {
  const [draft, setDraft] = useState<WorkspaceBrainDraft>(toDraft(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWorkspaceBrain(workspaceId);
      setDraft(toDraft(response.profile));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load workspace brain.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveWorkspaceBrain(workspaceId, {
        purpose: draft.purpose.trim(),
        goals: parseLines(draft.goalsText),
        operatingRules: parseLines(draft.operatingRulesText),
        preferences: {
          language: draft.language.trim(),
          tone: draft.tone.trim(),
          aiRole: draft.aiRole.trim(),
        },
      });
      setSavedAt(Date.now());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save workspace brain.");
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = useMemo(() => {
    if (workspaceKind === "platform") return "Platform";
    if (workspaceKind === "organization") return "Organisation";
    return "Privat";
  }, [workspaceKind]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-muted)]">Workspace Brain</p>
            <h2 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{workspaceLabel}</h2>
            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
              Define the identity and operating directives Ely should use for this workspace.
            </p>
          </div>
          <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-white/75">
            {kindLabel}
          </span>
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border p-5 text-sm text-[color:var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
          Loading workspace brain...
        </section>
      ) : (
        <section className="grid gap-4 rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Purpose</span>
            <textarea
              value={draft.purpose}
              onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))}
              className="min-h-[110px] rounded-xl border bg-[var(--bg-surface)] px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--border-subtle)" }}
              placeholder="Why this workspace exists and what Ely should optimize for."
            />
          </label>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Goals (one per line)</span>
              <textarea
                value={draft.goalsText}
                onChange={(event) => setDraft((current) => ({ ...current, goalsText: event.target.value }))}
                className="min-h-[140px] rounded-xl border bg-[var(--bg-surface)] px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none"
                style={{ borderColor: "var(--border-subtle)" }}
                placeholder="Increase response quality&#10;Reduce execution latency&#10;Protect brand voice"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Operating Rules (one per line)</span>
              <textarea
                value={draft.operatingRulesText}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, operatingRulesText: event.target.value }))
                }
                className="min-h-[140px] rounded-xl border bg-[var(--bg-surface)] px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none"
                style={{ borderColor: "var(--border-subtle)" }}
                placeholder="Ask before external send&#10;Prefer concise summaries&#10;Always include sources"
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">AI Response Language</span>
              <select
                value={draft.language}
                onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))}
                className="h-10 rounded-xl border bg-[var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none appearance-none cursor-pointer"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {AI_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Tone</span>
              <input
                value={draft.tone}
                onChange={(event) => setDraft((current) => ({ ...current, tone: event.target.value }))}
                className="h-10 rounded-xl border bg-[var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none"
                style={{ borderColor: "var(--border-subtle)" }}
                placeholder="Direct, premium, practical"
              />
            </label>
          </div>

          {/* ── AI Executive Role (company + platform workspaces) ── */}
          {(workspaceKind === "organization" || workspaceKind === "platform") && (
            <div>
              <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">AI Executive Role</span>
              <p className="mb-3 text-[11px] text-[color:var(--text-secondary)]">
                Give Elly a C-suite persona for this company workspace.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AI_ROLE_OPTIONS.map((opt) => {
                  const isActive = draft.aiRole === opt.value;
                  return (
                    <button
                      key={opt.value || "default"}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, aiRole: opt.value }))}
                      aria-pressed={isActive}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${
                        isActive
                          ? "ring-1 ring-[color:var(--border-focus)] bg-white/[0.08]"
                          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
                      }`}
                      style={{ borderColor: isActive ? "var(--border-focus)" : undefined }}
                    >
                      {opt.value ? (
                        <p className="text-sm font-semibold text-[color:var(--text-primary)]">{opt.value}</p>
                      ) : null}
                      <p className={`${opt.value ? "text-[10px] text-[color:var(--text-muted)]" : "text-sm font-medium text-[color:var(--text-primary)]"} leading-tight`}>
                        {opt.value ? opt.description : opt.label}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[color:var(--text-muted)]">
              {savedAt ? `Saved ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(savedAt)}` : "Not saved yet"}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-xs uppercase tracking-[0.12em] text-white/90 transition hover:bg-white/[0.12] disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Workspace Brain"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function renderDetail(
  section: string,
  context: SettingsDetailContext,
) {
  const {
    workspaceId,
    workspaceLabel,
    workspaceKind,
    workspaceRoleLabel,
    userName,
    userEmail,
    googleStatus,
    osSettings,
    updateOsSettings,
    onGoogleConnect,
    onGithubConnect,
    onGoogleDisconnect,
  } = context;

  const googleConnected = Boolean(googleStatus?.google?.connected);
  const workspaceKindValue = String(workspaceKind).toLowerCase();
  const isPersonalWorkspace =
    workspaceKindValue === "individual" || workspaceKindValue === "personal";
  const shortcutList = [
    "⌘K — App Launcher",
    "⌘Space — Orb Panel",
    "⌘/ — Focus IntentLine",
    "⌘, — Settings",
    "Esc — Close overlays",
    "⌘1…6 — Mail · Calendar · Tasks · Files · Builder · Slides",
  ];
  const platformRows = [
    { id: "acme", customer: "Acme Foods", workspaces: "3", status: "Active" },
    { id: "nextgen", customer: "NextGen Labs", workspaces: "2", status: "Provisioning" },
    { id: "elyra", customer: "Elyra Internal", workspaces: "7", status: "Monitoring" },
  ];

  if (section === "profile") {
    return (
      <div className="space-y-6">
        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 text-xl font-semibold text-white">
              {userName?.[0] ?? userEmail?.[0] ?? "E"}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Profile</p>
              <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">{userName}</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">{userEmail}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <article>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Workspace</p>
              <p className="text-sm font-medium text-[color:var(--text-primary)]">{workspaceLabel}</p>
              <p className="text-xs text-[color:var(--text-muted)]">{workspaceKind}</p>
            </article>
            <article>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Role</p>
              <p className="text-sm font-medium text-[color:var(--text-primary)]">{workspaceRoleLabel}</p>
              <p className="text-xs text-[color:var(--text-muted)]">Persisted per workspace</p>
            </article>
          </div>
        </section>

        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Appearance</p>
              <h2 className="mt-1 text-2xl font-semibold text-[color:var(--text-primary)]">Theme mode</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                Switch instantly between Light, Dark, or System. The choice persists after reload.
              </p>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}>
              {THEME_OPTIONS.find((option) => option.value === osSettings.theme)?.label ?? "System"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {THEME_OPTIONS.map((option) => (
              <button
                key={`profile-${option.value}`}
                type="button"
                onClick={() => updateOsSettings({ theme: option.value })}
                aria-pressed={osSettings.theme === option.value}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  osSettings.theme === option.value ? "bg-white/[0.08]" : "bg-white/[0.02]"
                }`}
                style={{ borderColor: osSettings.theme === option.value ? "var(--border-focus)" : "var(--border-subtle)" }}
              >
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">{option.label}</p>
                <p className="mt-1 text-[11px] text-[color:var(--text-secondary)]">{option.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Session info</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <article className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Active session</p>
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">{workspaceLabel}</p>
              <p className="text-xs text-[color:var(--text-secondary)]">{workspaceId}</p>
            </article>
            <article className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Google connector</p>
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                {googleConnected ? "Connected" : "Disconnected"}
              </p>
              {googleStatus?.google?.accountEmail ? (
                <p className="text-xs text-[color:var(--text-secondary)] truncate">{googleStatus.google.accountEmail}</p>
              ) : (
                <p className="text-xs text-[color:var(--text-secondary)]">No account connected</p>
              )}
            </article>
          </div>
        </section>
        <div className="flex justify-end border-t border-white/5 pt-3">
          <button
            type="button"
            disabled
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/60 cursor-not-allowed"
            style={{ background: "var(--bg-surface)" }}
            title="Invite a member once the invite flow is implemented."
          >
            Invite member
          </button>
        </div>
      </div>
    );
  }

  if (section === "sessions") {
    const sessionRows = [
      { label: "Aktive Sitzung", detail: "ELYRA OS · Launcher" },
      { label: "Google Connector", detail: googleConnected ? "Verbunden" : "Nicht verbunden" },
    ];

    return (
      <section
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Sessions</p>
        <h2 className="mt-1 text-2xl font-semibold text-[color:var(--text-primary)]">Active sessions</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {sessionRows.map((row) => (
            <article
              key={row.label}
              className="rounded-xl border px-4 py-3"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">{row.label}</p>
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">{row.detail}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-sm text-[color:var(--text-secondary)]">
          Sign out everywhere clears any stale sessions. (Manual action)
        </p>
        <button
          type="button"
          data-uat="sign-out-all"
          className="mt-3 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
          onClick={() => {
            if (typeof window !== "undefined" && window.confirm("Sign out from all sessions?")) {
              window.alert("Sign out flow is not implemented yet.");
            }
          }}
        >
          Sign out everywhere
        </button>
      </section>
    );
  }

  if (section === "system-settings") {
    return (
      <div className="space-y-6">
        {/* ── Appearance — Theme + Orb (unified) ───────────────── */}
        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Theme & Orb</p>
              <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">Appearance</h2>
            </div>
            <button
              type="button"
              onClick={() => updateOsSettings({ theme: "auto", themeKey: null })}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
                !osSettings.themeKey && osSettings.theme === "auto"
                  ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                  : "border-[color:var(--border)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]"
              }`}
            >
              Auto
            </button>
          </div>

          {/* 2×2 theme grid — Elli (dark/light) + Pulse (dark/light) */}
          <div className="grid grid-cols-2 gap-2.5">
            {THEME_REGISTRY.map((theme) => {
              const isActive   = osSettings.themeKey === theme.key;
              const matchedOrb = ORB_THEME_MAP[theme.key];
              const orbPreset  = ORB_PRESETS.find((p) => p.id === matchedOrb);
              const OrbComp    = orbPreset?.Component;
              return (
                <button
                  key={theme.key}
                  type="button"
                  onClick={() =>
                    updateOsSettings({
                      theme: theme.group,
                      themeKey: theme.key,
                      ...(matchedOrb ? { orbVariant: matchedOrb } : {}),
                    })
                  }
                  aria-pressed={isActive}
                  title={`${theme.name} — ${theme.description}`}
                  className="relative rounded-xl overflow-hidden text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    height: 130,
                    background: theme.preview.bg,
                    boxShadow: isActive
                      ? `0 0 0 2.5px ${theme.preview.accentHint}, 0 8px 28px rgba(0,0,0,0.38)`
                      : "0 0 0 1px rgba(128,128,128,0.12), 0 3px 10px rgba(0,0,0,0.2)",
                  }}
                >
                  {/* Radial accent glow behind orb */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: `radial-gradient(ellipse at 50% 45%, ${theme.preview.accentHint}22 0%, transparent 68%)`,
                    }}
                  />
                  {/* Live orb preview — centered in upper area */}
                  {OrbComp && (
                    <div
                      className="absolute inset-x-0 top-0 flex items-center justify-center pointer-events-none"
                      style={{ height: 92 }}
                    >
                      <OrbComp size={68} preview={false} />
                    </div>
                  )}
                  {/* Footer info strip */}
                  <div
                    className="absolute bottom-0 inset-x-0 px-3 py-2.5 flex items-center justify-between"
                    style={{
                      background: theme.preview.panel,
                      borderTop: `1px solid ${theme.preview.accentHint}55`,
                    }}
                  >
                    <div className="min-w-0">
                      <p
                        className="text-[12px] font-bold leading-tight truncate"
                        style={{ color: theme.preview.text }}
                      >
                        {theme.name}
                      </p>
                      <p
                        className="text-[9.5px] leading-tight mt-0.5 opacity-55 truncate"
                        style={{ color: theme.preview.text }}
                      >
                        {matchedOrb === "thinkingOrb" ? "Pulse" : "Elli"}
                      </p>
                    </div>
                    {isActive ? (
                      <svg className="w-5 h-5 flex-shrink-0 ml-1" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="9.5" fill={theme.preview.accentHint} />
                        <path
                          d="M6 10l3 3 5-6"
                          stroke={theme.preview.bg}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <div
                        className="w-4 h-4 rounded-full border-2 flex-shrink-0 ml-1"
                        style={{ borderColor: `${theme.preview.accentHint}77` }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-[color:var(--text-faint)]">
            Theme + Orb apply instantly · saved to this browser
          </p>
        </section>

        {/* ── UI Language ───────────────────────────────────────── */}
        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Language</p>
          <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">UI Language</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">Controls the language of menus, labels, and system text.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {LANGUAGE_OPTIONS.map((option) => {
              const isActive = osSettings.language === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    updateOsSettings({ language: option.value });
                  }}
                  aria-pressed={isActive}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isActive ? "bg-white/[0.08]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                  style={{ borderColor: isActive ? "var(--border-focus)" : "var(--border-subtle)" }}
                >
                  <p className="text-sm font-semibold text-[color:var(--text-primary)]">{option.label}</p>
                  {option.description ? (
                    <p className="text-[11px] text-[color:var(--text-secondary)]">{option.description}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <p className="text-xs text-[color:var(--text-secondary)]">
          Preferences are saved locally and persist after reloads.
        </p>
      </div>
    );
  }

  if (section === "shortcuts") {
    return (
      <section
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "color-mix(in srgb, var(--bg-elevated) 88%, var(--bg-base) 12%)" }}
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Shortcuts</p>
        <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Keyboard palette</h2>
        <ul className="mt-4 space-y-2 text-sm text-[color:var(--text-secondary)]">
          {shortcutList.map((shortcut) => (
            <li key={shortcut} className="flex items-center justify-between rounded-xl border px-4 py-2" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}>
              <span className="text-white/70">{shortcut}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[color:var(--text-muted)]">These shortcuts work in Elyra OS desktop and orb experiences.</p>
      </section>
    );
  }

  if (section === "integrations") {
    const googleNeedsReauth =
      googleStatus?.google?.needsReauth === true ||
      googleStatus?.google?.connectionState === "needs_scope";

    // ── Personal workspace: iCloud Mail + Calendar ──────────────────────────
    if (isPersonalWorkspace) {
      return (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Integrations · Personal</p>
            <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">iCloud</h2>
            <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
              Connect your Apple account for Mail and Calendar. Requires an App-Specific Password from
              {" "}<a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[color:var(--text-primary)]">appleid.apple.com</a>.
            </p>
          </div>

          {/* iCloud Mail */}
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">Mail</p>
                <p className="text-xs text-[color:var(--text-muted)]">IMAP · imap.mail.me.com · port 993</p>
              </div>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-[10px] text-[color:var(--text-muted)]">
                IMAP / SMTP
              </span>
            </div>
            <p className="text-xs text-[color:var(--text-secondary)]">
              Use paul@elyra-core.app, paul.odak@fish-delish.pt, or paul.odak@icloud.com with an App-Specific Password.
            </p>
            <button
              type="button"
              className="rounded-full border border-[color:var(--border)] bg-[color:var(--btn-secondary-bg)] px-4 py-2 text-sm font-semibold text-[color:var(--btn-secondary-fg)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--accent-soft)]"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.assign(`/os/mail/connect?workspaceId=${encodeURIComponent(workspaceId)}`);
                }
              }}
            >
              Set up iCloud Mail →
            </button>
          </div>

          {/* iCloud Calendar */}
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">Calendar</p>
                <p className="text-xs text-[color:var(--text-muted)]">CalDAV · caldav.icloud.com</p>
              </div>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-[10px] text-[color:var(--text-muted)]">
                CalDAV
              </span>
            </div>
            <p className="text-xs text-[color:var(--text-secondary)]">
              Sync iCloud events directly into Elyra Calendar. Same App-Specific Password as Mail.
            </p>
            <button
              type="button"
              className="rounded-full border border-[color:var(--border)] bg-[color:var(--btn-secondary-bg)] px-4 py-2 text-sm font-semibold text-[color:var(--btn-secondary-fg)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--accent-soft)]"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.assign(`/os/calendar/connect?workspaceId=${encodeURIComponent(workspaceId)}`);
                }
              }}
            >
              Set up iCloud Calendar →
            </button>
          </div>

          {/* GitHub */}
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">GitHub</p>
                <p className="text-xs text-[color:var(--text-muted)]">Code reviews · repo tasks</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-full border border-[color:var(--border)] bg-[color:var(--btn-secondary-bg)] px-4 py-2 text-sm font-semibold text-[color:var(--btn-secondary-fg)] transition hover:border-[color:var(--border-strong)]"
              onClick={onGithubConnect}
              disabled={!onGithubConnect}
            >
              Connect GitHub
            </button>
          </div>
        </div>
      );
    }

    // ── Organization workspace: Google Workspace ────────────────────────────
    return (
      <section
        className="space-y-4 rounded-2xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Integrations · {workspaceLabel}</p>
            <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Google Workspace</h2>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
              googleConnected && !googleNeedsReauth
                ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-200"
                : googleNeedsReauth
                  ? "border-amber-300/40 bg-amber-500/10 text-amber-200"
                  : "border-white/15 bg-white/[0.04] text-white/60"
            }`}
          >
            {googleConnected && !googleNeedsReauth ? "Connected" : googleNeedsReauth ? "Needs re-auth" : "Disconnected"}
          </span>
        </div>

        {googleConnected && !googleNeedsReauth && googleStatus?.google?.accountEmail ? (
          <p className="text-sm text-[color:var(--text-secondary)]">{googleStatus.google.accountEmail}</p>
        ) : (
          <p className="text-sm text-[color:var(--text-secondary)]">
            Verbindet Mail, Kalender und Tasks mit dem {workspaceLabel} Google Workspace Account.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full border border-[color:var(--border)] bg-[color:var(--btn-secondary-bg)] px-4 py-2 text-sm font-semibold text-[color:var(--btn-secondary-fg)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--accent-soft)]"
            onClick={onGoogleConnect}
            disabled={!onGoogleConnect}
          >
            {googleNeedsReauth ? "Re-connect Google" : googleConnected ? "Reconnect Google" : "Connect Google Workspace"}
          </button>
          {googleConnected ? (
            <button
              type="button"
              className="rounded-full border border-rose-400/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
              onClick={() => {
                if (typeof window !== "undefined" && window.confirm("Disconnect Google integration?")) {
                  onGoogleDisconnect();
                }
              }}
            >
              Disconnect
            </button>
          ) : null}
        </div>

        {googleStatus?.google?.scopes?.length ? (
          <div className="space-y-2 text-xs text-[color:var(--text-secondary)]">
            <p className="uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Active scopes</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {googleStatus.google.scopes.map((scope) => (
                <li key={scope} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/70">
                  {scope}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* GitHub */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-medium text-white/80">GitHub</p>
              <p className="text-xs text-white/40">Repo reviews and coding tasks in Elyra Code</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/40 hover:bg-white/[0.12]"
            onClick={onGithubConnect}
            disabled={!onGithubConnect}
          >
            Connect GitHub
          </button>
        </div>
      </section>
    );
  }

  if (section === "ai") {
    return (
      <section
        className="space-y-5 rounded-2xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">AI settings</p>
          <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Model & memory</h2>
          <p className="text-sm text-[color:var(--text-secondary)]">Persisted per workspace in local storage and database.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Fast model</span>
            <select
              className="h-10 rounded-xl border bg-[var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--border-subtle)" }}
              value={osSettings.fastModel}
              onChange={(event) => updateOsSettings({ fastModel: event.target.value })}
            >
              {MODEL_GROUPS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}{m.badge ? ` · ${m.badge}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Deep model</span>
            <select
              className="h-10 rounded-xl border bg-[var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--border-subtle)" }}
              value={osSettings.deepModel}
              onChange={(event) => updateOsSettings({ deepModel: event.target.value })}
            >
              {MODEL_GROUPS.map((g) => (
                <optgroup key={`deep-${g.group}`} label={g.group}>
                  {g.models.map((m) => (
                    <option key={`${m.value}-deep`} value={m.value}>
                      {m.label}{m.badge ? ` · ${m.badge}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-[color:var(--text-faint)]">
          Catalogue updated&nbsp;{MODEL_CATALOG_DATE}. New provider API keys must be added in your .env.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => updateOsSettings({ graphMemory: !osSettings.graphMemory })}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              osSettings.graphMemory ? "border-white/60 bg-white/[0.08]" : "border-white/10 bg-white/[0.02]"
            }`}
            style={{ borderColor: osSettings.graphMemory ? "var(--border-focus)" : "var(--border-subtle)" }}
            aria-pressed={osSettings.graphMemory}
          >
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">Graph memory</p>
            <p className="text-[11px] text-[color:var(--text-secondary)]">
              {osSettings.graphMemory ? "Enabled" : "Paused"} · Elyra stores context locally.
            </p>
          </button>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Budget (USD)</span>
            <input
              type="number"
              min={0}
              step={10}
              value={osSettings.budget}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                updateOsSettings({ budget: Number.isFinite(parsed) ? parsed : 0 });
              }}
              className="h-10 rounded-xl border bg-[var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--border-subtle)" }}
            />
          </label>
        </div>
        <p className="text-xs text-[color:var(--text-secondary)]">Budget tracking is local for now.</p>
      </section>
    );
  }

  if (section === "billing") {
    return (
      <section
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Billing</p>
        <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Billing & usage</h2>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
          Usage is aggregated from workspace activity and AI service calls. Manage limits in the platform console.
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-[color:var(--text-secondary)]">Usage source: Elyra Platform</span>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/60 cursor-not-allowed"
            style={{ background: "var(--bg-surface)" }}
            title="Billing is managed in the platform console."
          >
            Manage billing
          </button>
        </div>
      </section>
    );
  }

  if (section === "workspace-profile") {
    return (
      <section
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Workspace</p>
        <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">{workspaceLabel}</h2>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
          Kind: {workspaceKind} · Role: {workspaceRoleLabel}
        </p>
        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">Workspace ID: {workspaceId}</p>
        <button
          type="button"
          className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80"
          style={{ background: "var(--bg-surface)" }}
        >
          View policies
        </button>
      </section>
    );
  }

  if (section === "workspace-brain") {
    return (
      <WorkspaceBrainPanel
        workspaceId={workspaceId}
        workspaceLabel={workspaceLabel}
        workspaceKind={workspaceKind}
      />
    );
  }

  if (section === "members-roles") {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Workspace</p>
          <h2 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">Members & Roles</h2>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            Manage who has access to this workspace and what they are allowed to do.
          </p>
        </div>

        <section className="space-y-2 rounded-2xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Members ({MEMBER_ROWS.length})</p>
          {MEMBER_ROWS.map((member) => (
            <article
              key={member.email}
              className="flex items-center justify-between rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-xs font-semibold text-white">
                  {member.avatar}
                </span>
                <div>
                  <p className="text-sm text-[color:var(--text-primary)]">{member.name}</p>
                  <p className="text-xs text-[color:var(--text-muted)]">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${roleTone(member.role)}`}>
                  {member.role}
                </span>
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${member.active ? "bg-emerald-400" : "bg-white/25"}`}
                  aria-label={member.active ? "Active" : "Offline"}
                />
              </div>
            </article>
          ))}
        </section>

        <section className="space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Role Templates</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ROLE_TEMPLATES.map((template) => (
              <article
                key={template.name}
                className="rounded-xl border p-3"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
              >
                <p className="text-sm font-medium text-[color:var(--text-primary)]">{template.name}</p>
                <ul className="mt-2 space-y-1 text-xs text-[color:var(--text-secondary)]">
                  {template.perms.map((perm) => (
                    <li key={`${template.name}-${perm}`}>• {perm}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (section === "developer") {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>System</p>
          <h2 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Developer</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            API keys, webhook endpoints, debug tools, and local overrides.
          </p>
        </div>
        <section className="space-y-3 rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>API Access</p>
          {[
            { label: "Workspace API Key", value: "sk-elyra-••••••••••••3f2a", mono: true },
            { label: "Webhook URL", value: `https://api.elyra-core.app/webhook/${workspaceId.slice(0, 8)}`, mono: true },
            { label: "SDK Version", value: "0.9.4-beta", mono: false },
          ].map(({ label, value, mono }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              <code
                className="rounded-lg px-2 py-1 text-xs"
                style={{
                  background: "var(--bg-surface)",
                  color: mono ? "var(--os-accent)" : "var(--text-primary)",
                  fontFamily: mono ? "monospace" : undefined,
                }}
              >{value}</code>
            </div>
          ))}
        </section>
        <section className="space-y-3 rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>Debug Mode</p>
          {[
            { id: "debug-intent", label: "Log intent routing", desc: "Print intent→domain→app routing to console" },
            { id: "debug-sse", label: "Log SSE events", desc: "Stream run events to browser console" },
            { id: "debug-kernel", label: "Verbose kernel state", desc: "Log KernelProvider state transitions" },
          ].map(({ id, label, desc }) => (
            <div key={id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
              </div>
              <button
                type="button"
                className="relative h-5 w-9 rounded-full border transition"
                style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-faint)" }}
              >
                <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white/30 transition-transform" />
              </button>
            </div>
          ))}
        </section>
      </div>
    );
  }

  if (section === "experimental") {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>System</p>
          <h2 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Experimental</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            Features that are in active development. They may change or be removed without notice.
          </p>
        </div>
        <section className="rounded-2xl border border-amber-300/20 bg-amber-500/8 p-4">
          <p className="text-xs text-amber-200/80">
            ⚠️ Experimental features are unstable. Enable them only in development workspaces.
          </p>
        </section>
        <section className="space-y-3 rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
          {[
            { id: "plan-mode", label: "Plan Mode (Mindmap)", desc: "Show AI plan as a force-directed graph before execution", enabled: true },
            { id: "voice-orb", label: "Voice Orb", desc: "Enable microphone input for the intent orb", enabled: false },
            { id: "multi-agent", label: "Multi-Agent Routing", desc: "Route complex intents through multiple specialized agents", enabled: false },
            { id: "surf-ai", label: "Surf Forecast AI", desc: "Post-session forecast analysis and accuracy scoring", enabled: true },
            { id: "collab-cursors", label: "Collaborative Cursors", desc: "See teammates' cursor positions in real-time", enabled: false },
          ].map(({ id, label, desc, enabled: defaultEnabled }) => (
            <div key={id} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
              </div>
              <button
                type="button"
                className="relative h-5 w-9 flex-shrink-0 rounded-full border transition"
                style={{
                  background: defaultEnabled ? "var(--os-accent)" : "var(--bg-surface)",
                  borderColor: defaultEnabled ? "transparent" : "var(--os-border-faint)",
                }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
                  style={{ left: defaultEnabled ? "calc(100% - 18px)" : "2px" }}
                />
              </button>
            </div>
          ))}
        </section>
      </div>
    );
  }

  if (section === "platform-admin") {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Platform</p>
          <h2 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">Platform Admin</h2>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            High-level customer and workspace visibility for platform owners.
          </p>
        </div>
        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--text-muted)]">
                <tr>
                  <th className="pb-3">Customer</th>
                  <th className="pb-3">Workspaces</th>
                  <th className="pb-3">Status</th>
                </tr>
              </thead>
              <tbody className="text-[13px] text-[color:var(--text-primary)]">
                {platformRows.map((entry) => (
                  <tr key={entry.id} className="border-t border-white/5">
                    <td className="py-3">{entry.customer}</td>
                    <td className="py-3">{entry.workspaces}</td>
                    <td className="py-3">{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (section === "system-admin") {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Platform</p>
          <h2 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">System Admin</h2>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            Manage platform-wide controls, governance, and cross-workspace operations visibility.
          </p>
        </div>

        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
        >
          <p className="text-sm text-[color:var(--text-secondary)]">
            System admin controls are available here for platform owners in Elyra Core.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}>
      <p className="text-xs uppercase tracking-[0.15em] text-[color:var(--text-muted)]">Settings</p>
      <h2 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{section}</h2>
      <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
        This section is ready for detailed controls and policy wiring in the next pass.
      </p>
    </div>
  );
}

export default function SettingsView({
  open,
  role,
  section,
  workspaceId,
  workspaceLabel,
  workspaceKind,
  onSelectSection,
  onClose,
  userName,
  userEmail,
  workspaceRoleLabel,
  googleStatus,
  onGoogleDisconnect,
}: SettingsViewProps) {
  const [osSettings, updateOsSettings] = useOsSettings(workspaceId);
  const workspaceKindValue = String(workspaceKind).toLowerCase();
  const isPersonalWorkspace =
    workspaceKindValue === "individual" || workspaceKindValue === "personal";
  const handleGoogleConnect = useCallback(() => {
    if (isPersonalWorkspace) {
      if (typeof window !== "undefined") {
        window.location.assign(`/os/mail/connect?workspaceId=${encodeURIComponent(workspaceId)}`);
      }
      return;
    }
    void startGoogleConnect(workspaceId, "/os").catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to start Google connect.";
      if (typeof window !== "undefined") {
        window.alert(message);
      }
    });
  }, [isPersonalWorkspace, workspaceId]);
  const handleGithubConnect = useCallback(() => {
    void (async () => {
      try {
        const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/github/connect`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        const payload = (await response.json().catch(() => null)) as
          | { connectUrl?: string; hint?: string; error?: string }
          | null;
        if (!response.ok || !payload?.connectUrl) {
          throw new Error(payload?.hint || payload?.error || "Unable to start GitHub connect.");
        }
        if (typeof window !== "undefined") {
          window.location.assign(payload.connectUrl);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start GitHub connect.";
        if (typeof window !== "undefined") {
          window.alert(message);
        }
      }
    })();
  }, [workspaceId]);
  if (!open) return null;

  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      hasRole(role, item.minRole) && inWorkspaceKind(workspaceKind, item.kinds),
    ),
  })).filter((group) =>
    hasRole(role, group.minRole) &&
    inWorkspaceKind(workspaceKind, group.kinds) &&
    group.items.length > 0,
  );

  const detailContext: SettingsDetailContext = {
    workspaceId,
    workspaceLabel,
    workspaceKind,
    workspaceRoleLabel,
    userName,
    userEmail,
    googleStatus,
    osSettings,
    updateOsSettings,
    onGoogleConnect: handleGoogleConnect,
    onGithubConnect: handleGithubConnect,
    onGoogleDisconnect,
  };

  return (
    <section
      className="fixed inset-x-0 bottom-0 top-14 flex"
      style={{ zIndex: SHELL_LAYERS.modal }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings view"
      {...{ [SHELL_LAYER_DATA_ATTR]: "settings" }}
    >
      <aside
        className="w-[280px] shrink-0 overflow-y-auto border-r p-4"
        style={{
          borderColor: "var(--border-subtle)",
          background: "color-mix(in srgb, var(--bg-elevated) 96%, transparent)",
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface-soft)" }}
            aria-label="Close settings"
          >
            <X size={14} />
          </button>
        </div>

        <nav className="space-y-4">
        {visibleGroups.map((group) => {
            const badge = roleBadgeText(group.minRole);
            return (
              <div key={group.id}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{group.label}</p>
                  {badge ? (
                    <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-white/70">
                      {badge}
                    </span>
                  ) : null}
                </div>
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const active = item.id === section;
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => onSelectSection(item.id)}
                          className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition"
                          style={{
                            borderColor: active ? "var(--border-focus)" : "transparent",
                            background: active ? "var(--bg-surface-active)" : "transparent",
                            color: active ? "var(--text-primary)" : "var(--text-secondary)",
                          }}
                        >
                          <Icon size={14} />
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto p-8" style={{ background: "var(--bg-base)" }}>
        {renderDetail(section, detailContext)}
      </div>
    </section>
  );
}
