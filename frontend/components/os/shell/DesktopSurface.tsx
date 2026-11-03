"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  ArrowRight,
  Brain,
  CalendarDays,
  CheckSquare,
  Cloud,
  Code2,
  CloudSun,
  FileText,
  Globe,
  Calendar,
  GitBranch,
  Link2,
  Loader2,
  Mail,
  Network,
  Package,
  RefreshCw,
  Sparkles,
  Target,
  TriangleAlert,
  Wand2,
  Wrench,
  Zap,
} from "lucide-react";
import { listAppsForWorkspace } from "@/components/os/kernel/appRegistry";
import type { AppManifest as KernelAppManifest } from "@/components/os/kernel/types";
import type {
  DashboardConnectedApp,
  DashboardGoal,
  DashboardPayload,
  DashboardRun,
  DashboardSection,
  DashboardSections,
  DashboardSuggestedAction,
  DashboardSummary,
  DashboardUpcomingItem,
} from "@/lib/orb-os/dashboard/types";
import type { ActiveIntentState, AppId, IntentMessage, UiQuickAction, WorkspaceArtifact } from "@/components/os/kernel/types";
import { eventBus } from "@/components/os/kernel/eventBus";
import { resolveAppsSurfaceEntries, type ResolvedQuickAction, type SurfaceId } from "@/lib/orb-os/contracts/rendering";
import type {
  AppManifest,
  InstalledApp,
  IntegrationStatus,
  ToolRegistryItem,
  WorkspaceCapabilities,
} from "@/lib/orb-os/contracts/types";
import ProfileSurface from "@/components/os/shell/surfaces/ProfileSurface";
import WorkspaceAdminSurface from "@/components/os/shell/surfaces/WorkspaceAdminSurface";
import ArtifactResultCard from "@/components/os/shell/cards/ArtifactResultCard";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { WORKSPACES } from "@/components/os/kernel/workspaceModel";

type DesktopSurfaceProps = {
  accent: string;
  workspaceLabel: string;
  workspaceId: string;
  workspaceRole: string | null;
  dashboardWidgetAppIds: string[];
  visibleSurfaces: SurfaceId[];
  appsSurfaceApps: AppManifest[];
  installedApps: InstalledApp[];
  orbQuickActions: ResolvedQuickAction[];
  toolRegistry: ToolRegistryItem[];
  workspaceCapabilities: WorkspaceCapabilities | null;
  integrationStatus: IntegrationStatus[];
  messages: IntentMessage[];
  artifacts: WorkspaceArtifact[];
  activeIntentState: ActiveIntentState;
  onOpenApp: (appId: AppId) => void;
  onOpenAssistant: () => void;
  onExecuteQuickAction: (action: UiQuickAction) => void;
  onOpenGoals: () => void;
  onOpenSettings: () => void;
  onOpenRun?: (runId: string) => void;
  onConfirmStep?: (stepId?: string) => void;
  onDenyStep?: (stepId?: string) => void;
  onSurfaceChange?: (surface: SurfaceId) => void;
  onConnectGoogle: () => void;
  onDisconnectGoogle: () => void;
  onSignOut: () => void;
};

type DashboardState = {
  loading: boolean;
  error: string | null;
  payload: DashboardPayload | null;
};

type RunFilter = "all" | "running" | "waiting" | "failed" | "success";
type GoalFilter = "all" | "at_risk" | "owner";
type UpcomingWindow = "today" | "3d" | "7d";

type ProjectItem = {
  id: string;
  name: string;
  archived: boolean;
};

type ConnectorCard = {
  id: string;
  name: string;
  description: string;
  status: "connected" | "available" | "not_configured";
  category: string;
  source: "google" | "github" | "icloud_mail" | "icloud_calendar" | "figma" | "banana2" | "google_stitch" | "twentyfirst" | "native";
};

function statusBadgeTone(status: string) {
  if (status === "connected" || status === "success" || status === "active" || status === "ready") {
    return "border-emerald-300/35 bg-emerald-500/12 text-emerald-800";
  }
  if (status === "running" || status === "waiting_for_auth" || status === "waiting_for_approval" || status === "needs_auth" || status === "needs_scope" || status === "at_risk") {
    return "border-amber-300/45 bg-amber-500/15 text-amber-900";
  }
  if (status === "failed" || status === "degraded" || status === "blocked" || status === "policy_blocked") {
    return "border-orange-300/45 bg-orange-500/12 text-orange-900";
  }
  return "border-[var(--border-strong)] bg-[var(--panel2)] text-[var(--text-secondary)]";
}

function prettyDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function CardStateEmpty({
  title,
  body,
  cta,
  onClick,
}: {
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{body}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-3 inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1 text-[11px] font-medium text-[color:var(--text-primary)]"
      >
        {cta} <ArrowRight size={12} />
      </button>
    </div>
  );
}

function CardStateNeedsAuth({
  title,
  body,
  onConnect,
}: {
  title: string;
  body: string;
  onConnect: () => void;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <div className="inline-flex items-center gap-1 rounded-full border border-amber-300/50 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-amber-900">
        Needs connection
      </div>
      <p className="mt-2 text-[13px] font-medium text-[color:var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{body}</p>
      <button
        type="button"
        onClick={onConnect}
        className="mt-3 inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1 text-[11px] font-medium text-[color:var(--text-primary)]"
      >
        <Link2 size={12} /> Connect Google
      </button>
    </div>
  );
}

function CardStateErrorMuted({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <div className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel2)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        Temporarily unavailable
      </div>
      <p className="mt-2 text-[13px] font-medium text-[color:var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] bg-transparent px-3 py-1 text-[11px] font-medium text-[color:var(--text-secondary)]"
      >
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function DashboardHealthBanner({
  impacted,
  onRetry,
}: {
  impacted: Array<keyof DashboardSections>;
  onRetry: () => void;
}) {
  if (impacted.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
      <TriangleAlert size={14} className="text-[color:var(--text-muted)]" />
      <p className="text-[12px] text-[color:var(--text-secondary)]">Some data is temporarily unavailable.</p>
      {impacted.map((section) => (
        <span key={section} className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
          {section}
        </span>
      ))}
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--text-secondary)]"
      >
        <RefreshCw size={11} /> Retry
      </button>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="animate-pulse rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <div className="h-3 w-20 rounded bg-[var(--border)]" />
      <div className="mt-3 h-4 w-3/4 rounded bg-[var(--border)]" />
      <div className="mt-2 h-4 w-1/2 rounded bg-[var(--border)]" />
      <div className="mt-4 h-14 rounded bg-[var(--border-subtle)]" />
    </div>
  );
}

function mapActionToApp(action: DashboardSuggestedAction): AppId | null {
  const toolRoot = action.tool_ref.split(".")[0] ?? "";
  if (toolRoot.includes("mail")) return "mail";
  if (toolRoot.includes("calendar") || action.label.toLowerCase().includes("event")) return "calendar";
  if (toolRoot.includes("drive") || action.label.toLowerCase().includes("file")) return "files";
  if (toolRoot.includes("slides") || action.label.toLowerCase().includes("slide")) return "slides";
  if (toolRoot.includes("task")) return "tasks";
  return null;
}

function surfaceLabel(surface: SurfaceId): string {
  if (surface === "dashboard") return "Home";
  if (surface === "assistant") return "Agent";
  if (surface === "goals") return "Goals";
  if (surface === "apps") return "Apps";
  if (surface === "settings") return "Workspace Admin";
  if (surface === "builder") return "Builder";
  return "Marketplace";
}

function appIcon(iconName: string) {
  if (iconName === "mail") return Mail;
  if (iconName === "calendar") return CalendarDays;
  if (iconName === "tasks") return CheckSquare;
  if (iconName === "files") return FileText;
  if (iconName === "cloud-sun") return CloudSun;
  if (iconName === "globe") return Globe;
  return AppWindow;
}

function nativeAppIcon(appId: string) {
  if (appId === "mail") return Mail;
  if (appId === "calendar") return CalendarDays;
  if (appId === "tasks") return CheckSquare;
  if (appId === "files") return FileText;
  if (appId === "graph") return Network;
  if (appId === "builder") return Wrench;
  if (appId === "slides") return AppWindow;
  if (appId === "studio") return Wand2;
  if (appId === "code") return Code2;
  if (appId === "weather") return Cloud;
  return Sparkles;
}

function appStatusDotTone(status: string) {
  if (status === "connected") return "bg-emerald-500";
  if (status === "degraded" || status === "error") return "bg-rose-500";
  if (status === "disabled") return "bg-[var(--muted)]";
  return "bg-amber-500";
}

export default function DesktopSurface({
  accent,
  workspaceLabel,
  workspaceId,
  workspaceRole,
  dashboardWidgetAppIds,
  visibleSurfaces,
  appsSurfaceApps,
  installedApps,
  orbQuickActions,
  toolRegistry,
  workspaceCapabilities,
  integrationStatus,
  messages,
  artifacts,
  activeIntentState,
  onOpenApp,
  onOpenAssistant,
  onExecuteQuickAction,
  onOpenGoals,
  onOpenSettings,
  onOpenRun,
  onConfirmStep,
  onDenyStep,
  onSurfaceChange,
  onConnectGoogle,
  onDisconnectGoogle,
  onSignOut,
}: DesktopSurfaceProps) {
  const [state, setState] = useState<DashboardState>({ loading: true, error: null, payload: null });
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [goalFilter, setGoalFilter] = useState<GoalFilter>("all");
  const [upcomingWindow, setUpcomingWindow] = useState<UpcomingWindow>("3d");
  const [activeSurface, setActiveSurface] = useState<SurfaceId>("dashboard");
  const [systemSection, setSystemSection] = useState<"integrations" | "marketplace" | "policies" | "health" | "billing" | "ai">("integrations");
  const [now, setNow] = useState<Date>(() => new Date());
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [scopeWorkspaceId, setScopeWorkspaceId] = useState<string | "all">(workspaceId);
  const [showScopeDrop, setShowScopeDrop] = useState(false);
  const [northStarDraft, setNorthStarDraft] = useState<string>("");
  const [northStarSaving, setNorthStarSaving] = useState(false);
  const [connectorActionNote, setConnectorActionNote] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 60000);
    return () => window.clearInterval(id);
  }, []);

  const loadDashboard = async (targetScope?: string) => {
    const target = targetScope ?? scopeWorkspaceId;
    if (target === "all") return; // aggregate view — no single fetch
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const headers = await withSupabaseAuthorization({
        "x-workspace-id": target,
      });
      const response = await fetch(`/api/os/dashboard?workspace_id=${encodeURIComponent(target)}`, {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      const payload = (await response.json()) as { ok: boolean; dashboard?: DashboardPayload; error?: string };
      if (!response.ok || !payload.ok || !payload.dashboard) {
        throw new Error(payload.error ?? "Unable to load dashboard");
      }
      setState({ loading: false, error: null, payload: payload.dashboard });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Dashboard request failed", payload: null });
    }
  };

  useEffect(() => {
    void loadDashboard(workspaceId);
    setScopeWorkspaceId(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const loadProjects = async () => {
      try {
        const headers = await withSupabaseAuthorization({
          "x-workspace-id": workspaceId,
        });
        const response = await fetch(`/api/os/projects?workspace_id=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          credentials: "include",
          headers,
        });
        const payload = (await response.json().catch(() => null)) as { ok?: boolean; projects?: ProjectItem[] } | null;
        if (!response.ok || !payload?.ok || cancelled) return;
        const available = (payload.projects ?? []).filter((project) => !project.archived);
        setProjects(available);
        setActiveProjectId((current) => current || available[0]?.id || "");
      } catch {
        if (!cancelled) {
          setProjects([]);
          setActiveProjectId("");
        }
      }
    };
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const sections = state.payload?.sections;
  const summary: DashboardSummary | undefined = state.payload?.summary;
  const goalsSection = sections?.goals;
  const runsSection = sections?.runs;
  const appsSection = sections?.apps;
  const actionsSection = sections?.actions;
  const upcomingSection = sections?.upcoming;

  const goalsData = goalsSection?.data;
  const runsData = runsSection?.data ?? [];
  const appsData = appsSection?.data ?? [];
  const actionsData = actionsSection?.data ?? [];
  const upcomingData = upcomingSection?.data ?? [];

  const widgetScopedAppsData = useMemo(() => {
    if (dashboardWidgetAppIds.length === 0) return appsData;
    const allowed = new Set(dashboardWidgetAppIds);
    return appsData.filter((app) => allowed.has(app.app_id));
  }, [appsData, dashboardWidgetAppIds]);

  const widgetScopedActionsData = useMemo(() => {
    if (dashboardWidgetAppIds.length === 0) return actionsData;
    const allowed = new Set(dashboardWidgetAppIds);
    return actionsData.filter((action) => allowed.has(action.app_id));
  }, [actionsData, dashboardWidgetAppIds]);
  const launcherApps = useMemo(
    () =>
      resolveAppsSurfaceEntries({
        workspaceId,
        manifests: appsSurfaceApps,
        installedApps,
        toolRegistry,
        integrationStatus,
        googleConnectionState:
          summary?.google.state === "connected"
            ? "connected"
            : summary?.google.state === "needs_scope"
              ? "needs_scope"
              : summary?.google.state === "needs_auth"
                ? "needs_auth"
                : summary?.google.state === "error"
                  ? "degraded"
                  : "disconnected",
      }),
    [workspaceId, appsSurfaceApps, installedApps, toolRegistry, integrationStatus, summary?.google.state],
  );
  const connectorCards = useMemo<ConnectorCard[]>(() => {
    const googleConnected = integrationStatus.some((entry) => entry.integration_id === "google_oauth" && entry.state === "connected");
    const githubConnected = integrationStatus.some((entry) => entry.integration_id === "github" && entry.state === "connected");
    const icloudMailConnected = integrationStatus.some(
      (entry) => (entry.integration_id === "imap" || entry.integration_id === "icloud_imap") && entry.state === "connected",
    );
    const icloudCalendarConnected = integrationStatus.some(
      (entry) => entry.integration_id === "icloud_caldav" && entry.state === "connected",
    );
    const figmaConnected = integrationStatus.some((entry) => entry.integration_id === "figma" && entry.state === "connected");
    const banana2Connected = integrationStatus.some((entry) => entry.integration_id === "banana2" && entry.state === "connected");
    const stitchConnected = integrationStatus.some((entry) => entry.integration_id === "google_stitch" && entry.state === "connected");
    const twentyfirstConnected = integrationStatus.some((entry) => entry.integration_id === "twentyfirst" && entry.state === "connected");
    return [
      {
        id: "gmail",
        name: "Gmail",
        description: "Draft replies, summarize threads, and search your inbox.",
        status: googleConnected ? "connected" : "available",
        category: "Communication",
        source: "google",
      },
      {
        id: "google_calendar",
        name: "Google Calendar",
        description: "Manage schedule, meetings, and timeline context.",
        status: googleConnected ? "connected" : "available",
        category: "Productivity",
        source: "google",
      },
      {
        id: "google_drive",
        name: "Google Drive",
        description: "Access files and source material for tasks and slides.",
        status: googleConnected ? "connected" : "available",
        category: "Files",
        source: "google",
      },
      {
        id: "github",
        name: "GitHub",
        description: "Repo reviews, PR context, and coding workflows in Elyra Code.",
        status: githubConnected ? "connected" : "available",
        category: "Development",
        source: "github",
      },
      {
        id: "icloud_mail",
        name: "iCloud Mail",
        description: "Connect IMAP/SMTP with an Apple app-specific password.",
        status: icloudMailConnected ? "connected" : "available",
        category: "Communication",
        source: "icloud_mail",
      },
      {
        id: "icloud_calendar",
        name: "iCloud Calendar",
        description: "Connect CalDAV with an Apple app-specific password.",
        status: icloudCalendarConnected ? "connected" : "available",
        category: "Productivity",
        source: "icloud_calendar",
      },
      {
        id: "figma",
        name: "Figma",
        description: "Connect design context so Elli can implement and iterate directly from Figma.",
        status: figmaConnected ? "connected" : "available",
        category: "Design",
        source: "figma",
      },
      {
        id: "banana2",
        name: "Banana2",
        description: "Generate design assets and concept images for fast visual iteration.",
        status: banana2Connected ? "connected" : "available",
        category: "Creative AI",
        source: "banana2",
      },
      {
        id: "google_stitch",
        name: "Google Stitch",
        description: "Generate UI concepts and structured screen drafts for product design exploration.",
        status: stitchConnected ? "connected" : "available",
        category: "Design AI",
        source: "google_stitch",
      },
      {
        id: "twentyfirst",
        name: "21st.dev",
        description: "Use curated UI component and asset libraries for production-ready interface building.",
        status: twentyfirstConnected ? "connected" : "available",
        category: "UI Library",
        source: "twentyfirst",
      },
      {
        id: "supabase",
        name: "Supabase",
        description: "Database, auth, and storage context for Elyra tooling.",
        status: "available",
        category: "Data",
        source: "native",
      },
      {
        id: "vercel",
        name: "Vercel",
        description: "Deployment and project context for build and release tasks.",
        status: "available",
        category: "Deploy",
        source: "native",
      },
    ];
  }, [integrationStatus]);
  const connectGithub = async () => {
    try {
      const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/github/connect`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { connectUrl?: string; hint?: string; error?: string }
        | null;
      if (!response.ok || !payload?.connectUrl) {
        throw new Error(payload?.hint || payload?.error || "Unable to start GitHub connect.");
      }
      if (payload.hint) {
        setConnectorActionNote(payload.hint);
      }
      window.location.href = payload.connectUrl;
    } catch (error) {
      setConnectorActionNote(error instanceof Error ? error.message : "Unable to start GitHub connect.");
    }
  };
  const disconnectGithub = async () => {
    try {
      const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
      const response = await fetch("/api/github/disconnect", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ workspaceId }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to disconnect GitHub.");
      }
      setConnectorActionNote("GitHub disconnected for this workspace.");
      void loadDashboard();
    } catch (error) {
      setConnectorActionNote(error instanceof Error ? error.message : "Unable to disconnect GitHub.");
    }
  };
  const connectExternalIntegration = async (key: "figma" | "banana2" | "google_stitch" | "twentyfirst") => {
    try {
      const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/${encodeURIComponent(key)}/connect`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { connectUrl?: string; hint?: string; error?: string }
        | null;
      if (!response.ok || !payload?.connectUrl) {
        throw new Error(payload?.hint || payload?.error || `Unable to start ${key} connect.`);
      }
      if (payload.hint) setConnectorActionNote(payload.hint);
      window.location.href = payload.connectUrl;
    } catch (error) {
      setConnectorActionNote(error instanceof Error ? error.message : `Unable to start ${key} connect.`);
    }
  };

  // Native OS apps — always shown regardless of bootstrap contract
  const nativeApps = useMemo<KernelAppManifest[]>(() => {
    const ws = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0];
    const kind = ws?.kind ?? "individual";
    return listAppsForWorkspace(kind).filter((app) => app.category !== "settings");
  }, [workspaceId]);

  const filteredRuns = useMemo(() => {
    if (runFilter === "all") return runsData;
    if (runFilter === "running") return runsData.filter((run) => run.status === "running");
    if (runFilter === "waiting") {
      return runsData.filter((run) => run.status === "waiting_for_auth" || run.status === "waiting_for_approval");
    }
    if (runFilter === "failed") return runsData.filter((run) => run.status === "failed");
    return runsData.filter((run) => run.status === "success");
  }, [runsData, runFilter]);

  const filteredOperationalGoals = useMemo(() => {
    const goals = goalsData?.operational ?? [];
    if (goalFilter === "all") return goals;
    if (goalFilter === "at_risk") return goals.filter((goal) => goal.status === "at_risk" || goal.status === "blocked");
    return goals.filter((goal) => goal.owner_label.toLowerCase().includes("owner"));
  }, [goalFilter, goalsData?.operational]);

  const filteredUpcoming = useMemo(() => {
    const now = Date.now();
    const horizonHours = upcomingWindow === "today" ? 24 : upcomingWindow === "3d" ? 72 : 168;
    return upcomingData.filter((item) => {
      const at = Date.parse(item.at);
      if (!Number.isFinite(at)) return false;
      return at >= now && at <= now + horizonHours * 60 * 60 * 1000;
    });
  }, [upcomingData, upcomingWindow]);

  const northStar = goalsData?.north_star[0] ?? null;
  const healthImpacted = state.payload?.health.impacted_sections ?? [];

  const isNewWorkspace =
    (goalsSection?.state === "empty" || !goalsSection) &&
    (runsSection?.state === "empty" || !runsSection || (runsSection.state === "needs_auth" && (runsSection.data?.length ?? 0) === 0));

  const firstReadyWowAction = widgetScopedActionsData.find((action) => action.state === "ready") ?? null;
  const renderedSurfaces = useMemo((): SurfaceId[] => {
    const base = visibleSurfaces.length > 0 ? visibleSurfaces : ["dashboard"];
    const allowed = new Set<SurfaceId>(["dashboard", "assistant", "goals", "apps", "settings"]);
    const filtered = base.filter((surface): surface is SurfaceId => allowed.has(surface as SurfaceId));
    return filtered.length > 0 ? filtered : ["dashboard"];
  }, [visibleSurfaces]);
  const aiCapabilityLevel =
    workspaceCapabilities?.capabilities["ai_model"] ?? workspaceCapabilities?.capabilities["ai"] ?? null;
  const showGeminiBadge = aiCapabilityLevel === "enabled" || aiCapabilityLevel === "read_only";
  const assistantMessages = useMemo(
    () => messages.slice(-12),
    [messages],
  );
  const pendingApprovals = useMemo(
    () => activeIntentState.steps.filter((step) => step.requiresConfirmation && step.status === "approval_required"),
    [activeIntentState.steps],
  );

  const goalsByPriority = useMemo(() => {
    const priorities = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;
    return [...(goalsData?.operational ?? [])].sort((a, b) => priorities[a.priority] - priorities[b.priority]);
  }, [goalsData?.operational]);

  const linkedGoalRuns = useMemo(() => {
    const operational = goalsData?.operational ?? [];
    const byGoal = new Map<string, DashboardRun[]>();
    operational.forEach((goal) => {
      const tokens = goal.title.toLowerCase().split(/\s+/).filter((token) => token.length > 3);
      const matches = runsData.filter((run) => tokens.some((token) => run.intent.toLowerCase().includes(token)));
      byGoal.set(goal.id, matches.slice(0, 3));
    });
    return byGoal;
  }, [goalsData?.operational, runsData]);

  useEffect(() => {
    if (!renderedSurfaces.includes(activeSurface)) {
      setActiveSurface(renderedSurfaces[0] ?? "dashboard");
    }
  }, [activeSurface, renderedSurfaces]);

  useEffect(() => {
    onSurfaceChange?.(activeSurface);
  }, [activeSurface, onSurfaceChange]);

  return (
    <section
      className="relative h-full overflow-hidden rounded-2xl border p-4 shadow-[0_18px_44px_rgba(20,45,83,0.16)]"
      data-elyra-page-shell="true"
      onClick={() => {
        eventBus.emit("overlay:close-all", {});
        setShowScopeDrop(false);
      }}
      style={{
        borderColor: "var(--os-border-soft)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--elyra-panel) 86%, #ffffff 14%) 0%, color-mix(in srgb, var(--elyra-panel-2) 92%, #ffffff 8%) 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 6%, color-mix(in srgb, ${accent} 24%, transparent) 0%, transparent 44%), radial-gradient(circle at 90% 8%, rgba(101, 189, 255, 0.08) 0%, transparent 42%)`,
          transition: "background 500ms ease",
        }}
      />

      <div className="relative z-10 h-full overflow-auto pr-1">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{surfaceLabel(activeSurface)}</p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-[18px] font-semibold text-[color:var(--text-primary)]">
                {scopeWorkspaceId === "all" ? "All Workspaces" : (WORKSPACES.find((ws) => ws.id === scopeWorkspaceId)?.label ?? workspaceLabel)} Control Center
              </h2>
              {/* Scope selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowScopeDrop((v) => !v); }}
                  className="flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-[10px] font-medium text-[color:var(--text-secondary)] transition hover:border-[color:var(--os-border-strong)] hover:text-[color:var(--text-primary)]"
                  title="Switch scope"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: WORKSPACES.find((ws) => ws.id === scopeWorkspaceId)?.accent ?? "var(--os-accent-color)" }}
                  />
                  {scopeWorkspaceId === "all" ? "All" : (WORKSPACES.find((ws) => ws.id === scopeWorkspaceId)?.label ?? "—")}
                  <span className="opacity-50">▾</span>
                </button>
                {showScopeDrop && (
                  <div
                    className="absolute left-0 top-full z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-xl border shadow-xl"
                    style={{ background: "var(--bg-elevated)", borderColor: "var(--os-border-soft)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {WORKSPACES.map((ws) => (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => { setScopeWorkspaceId(ws.id); void loadDashboard(ws.id); setShowScopeDrop(false); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] transition hover:bg-[color:var(--bg-surface-hover)]"
                        style={{ color: scopeWorkspaceId === ws.id ? "var(--text-primary)" : "var(--text-secondary)" }}
                      >
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: ws.accent }} />
                        {ws.label}
                        {scopeWorkspaceId === ws.id && <span className="ml-auto text-[10px] opacity-50">●</span>}
                      </button>
                    ))}
                    <div className="border-t" style={{ borderColor: "var(--os-border-soft)" }}>
                      <button
                        type="button"
                        onClick={() => { setScopeWorkspaceId("all"); setShowScopeDrop(false); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] transition hover:bg-[color:var(--bg-surface-hover)]"
                        style={{ color: scopeWorkspaceId === "all" ? "var(--text-primary)" : "var(--text-muted)" }}
                      >
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[color:var(--text-muted)]" />
                        All workspaces
                        {scopeWorkspaceId === "all" && <span className="ml-auto text-[10px] opacity-50">●</span>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {renderedSurfaces.map((surface) => (
                <button
                  key={surface}
                  type="button"
                  onClick={() => setActiveSurface(surface)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] transition ${
                    activeSurface === surface
                      ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                      : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]"
                  }`}
                >
                  {surfaceLabel(surface)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {showGeminiBadge ? (
              <span className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                Gemini active
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-1 text-[11px] font-medium text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)]"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </header>

        <DashboardHealthBanner impacted={healthImpacted} onRetry={() => void loadDashboard()} />

        {activeSurface === "dashboard" ? (
          <>
            <section className="mb-5 rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Workspace Context</p>
                  <h3 className="mt-1 text-[15px] font-semibold text-[color:var(--text-primary)]">{workspaceLabel}</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                    {new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(now)}
                  </span>
                  <span className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                    {workspaceRole ?? "member"}
                  </span>
                  <span className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                    {launcherApps.filter((app) => app.status !== "connected").length} needs attention
                  </span>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={onOpenAssistant}
                  className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-left"
                >
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Resume</p>
                  <p className="mt-1 text-[12px] text-[color:var(--text-primary)]">Continue last session</p>
                </button>
                <button
                  type="button"
                  onClick={onOpenAssistant}
                  className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-left"
                >
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Artifact</p>
                  <p className="mt-1 text-[12px] text-[color:var(--text-primary)]">Open recent artifact</p>
                </button>
                <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">System State</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]">Tools</span>
                    <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]">Approvals</span>
                    <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]">Sync</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-3">
              <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Today</p>
                <p className="mt-2 text-[13px] font-semibold text-[color:var(--text-primary)]">
                  {summary?.today.next_event?.title ?? "No events today"}
                </p>
                <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                  {summary?.today.next_event ? prettyDate(summary.today.next_event.at) : "No calendar event for today"}
                </p>
                <p className="mt-3 text-[11px] text-[color:var(--text-secondary)]">
                  Open tasks: {summary?.today.tasks_open_count ?? 0}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenApp("calendar")}
                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                  >
                    Calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenApp("tasks")}
                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                  >
                    Tasks
                  </button>
                </div>
              </article>

              <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Inbox</p>
                  {summary?.google?.state && summary.google.state !== "connected" && (
                    <span className="rounded-full border border-amber-300/35 bg-amber-500/12 px-2 py-0.5 text-[9px] text-amber-800">
                      {summary.google.state === "needs_auth" || summary.google.state === "disconnected"
                        ? "Google not connected"
                        : summary.google.state === "needs_scope"
                          ? "Needs permissions"
                          : "Google error"}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13px] font-semibold text-[color:var(--text-primary)]">
                  Unread: {summary?.inbox.unread_count ?? 0}
                </p>
                <div className="mt-2 space-y-1">
                  {(summary?.inbox.latest ?? []).slice(0, 5).map((message) => (
                    <p key={message.id} className="truncate text-[11px] text-[color:var(--text-secondary)]">
                      {message.subject || "(no subject)"}
                    </p>
                  ))}
                </div>
                {(summary?.inbox.latest.length ?? 0) === 0 ? (
                  <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
                    {summary?.google?.state === "needs_auth" || summary?.google?.state === "disconnected"
                      ? "Connect Google in System → Integrations to see inbox."
                      : "Inbox loaded, no recent messages."}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenApp("mail")}
                  className="mt-3 rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                >
                  Open Mail
                </button>
              </article>

              <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Activity</p>
                <p className="mt-2 text-[13px] font-semibold text-[color:var(--text-primary)]">
                  Runs: {summary?.activity.runs_count ?? filteredRuns.length}
                </p>
                <div className="mt-2 space-y-1">
                  {(summary?.activity.latest_runs ?? filteredRuns).slice(0, 5).map((run) => (
                    <p key={run.id} className="truncate text-[11px] text-[color:var(--text-secondary)]">
                      {run.intent}
                    </p>
                  ))}
                </div>
                {(summary?.activity.latest_runs.length ?? 0) === 0 ? (
                  <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">No recent actions.</p>
                ) : null}
                <button
                  type="button"
                  onClick={onOpenAssistant}
                  className="mt-3 rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                >
                  Open Assistant
                </button>
              </article>
            </div>

            {/* Sprint + Focus — ADHD weekly system */}
            <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Weekly Sprint</p>
                  <h4 className="mt-1 text-[14px] font-semibold text-[color:var(--text-primary)]">
                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()]} — focus sprint
                  </h4>
                </div>
                {/* Day-of-week progress dots Mon–Sun */}
                <div className="flex gap-1.5 pt-1">
                  {(["M", "T", "W", "T", "F", "S", "S"] as const).map((d, i) => {
                    const adjustedDay = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0 … Sun=6
                    const isPast = i < adjustedDay;
                    const isToday = i === adjustedDay;
                    return (
                      <div key={i} className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] text-[color:var(--text-muted)]">{d}</span>
                        <div
                          className={`h-2 w-2 rounded-full transition-all ${
                            isToday
                              ? "bg-[color:var(--accent)] shadow-[0_0_6px_var(--accent)]"
                              : isPast
                                ? "bg-[color:var(--text-muted)]/40"
                                : "border border-[color:var(--os-border-soft)]"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 text-[12px] text-[color:var(--text-secondary)]">
                One thing at a time. Micro-wins compound. Sprint, rest, repeat.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onExecuteQuickAction({
                      app_id: "assistant",
                      app_name: "Elly",
                      action_id: "one-thing-now",
                      label: "One thing now",
                      intent:
                        "What is the single most important thing I should focus on right now? Consider my open tasks, calendar, and goals. Give me ONE clear action — no lists, no overwhelm. Tell me how long it takes and what the first 2-minute step is.",
                      tool_ref: "agent.focus",
                      requires_auth: false,
                      requires_approval: false,
                      state: "ready",
                      badges: [],
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3 py-1.5 text-[11px] font-semibold text-[color:var(--text-primary)] transition hover:bg-[color:var(--accent)]/20"
                >
                  <Target size={11} /> One thing now
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onExecuteQuickAction({
                      app_id: "assistant",
                      app_name: "Elly",
                      action_id: "plan-my-week",
                      label: "Plan my week",
                      intent:
                        "Help me plan this week as a sprint. Use my goals, open tasks, and calendar. Give me a focused week with daily themes and max 3 priorities per day. Keep it simple — I have ADHD. Start with: what is the ONE theme for this week?",
                      tool_ref: "agent.plan",
                      requires_auth: false,
                      requires_approval: false,
                      state: "ready",
                      badges: [],
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                >
                  <CalendarDays size={11} /> Plan my week
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onExecuteQuickAction({
                      app_id: "assistant",
                      app_name: "Elly",
                      action_id: "brain-dump",
                      label: "Brain dump",
                      intent:
                        "I need to do a brain dump. I'll share everything on my mind — accept it all without judgment, then sort it into: DO NOW / DO THIS WEEK / DELEGATE / SOMEDAY / TRASH. Then surface the top 3 things I should act on.",
                      tool_ref: "agent.tasks",
                      requires_auth: false,
                      requires_approval: false,
                      state: "ready",
                      badges: [],
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                >
                  <Brain size={11} /> Brain dump
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onExecuteQuickAction({
                      app_id: "assistant",
                      app_name: "Elly",
                      action_id: "weekly-review",
                      label: "Weekly review",
                      intent:
                        "Let's do a quick weekly review — under 5 minutes. Structure: ✅ Wins → 🔓 Open loops → 💡 Lessons → 🎯 Next week intention. Celebrate what moved, identify one friction point, and set Monday's first action.",
                      tool_ref: "agent.review",
                      requires_auth: false,
                      requires_approval: false,
                      state: "ready",
                      badges: [],
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[11px] text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)]"
                >
                  <Sparkles size={11} /> Weekly review
                </button>
              </div>
            </article>

            {state.loading ? (
              <div className="mt-4 inline-flex items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                <Loader2 size={12} className="animate-spin" /> Loading control center...
              </div>
            ) : null}

            {pendingApprovals.length > 0 ? (
              <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-500/8 p-3">
                <p className="mb-2 text-xs font-medium text-amber-200">
                  Awaiting Approval ({pendingApprovals.length})
                </p>
                {pendingApprovals.map((step) => (
                  <div key={step.id} className="mb-2 flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 last:mb-0">
                    <span className="text-xs text-white/70">{step.label}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onConfirmStep?.(step.id);
                        }}
                        className="rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/30"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDenyStep?.(step.id);
                        }}
                        className="rounded-full bg-rose-500/20 px-3 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/30"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {activeSurface === "assistant" ? (
          <section className="space-y-4">
            {/* Context bar */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Context:</span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-0.5 text-[10px] font-medium text-[color:var(--text-secondary)]"
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: WORKSPACES.find((ws) => ws.id === scopeWorkspaceId)?.accent ?? "var(--os-accent-color)" }}
                />
                {scopeWorkspaceId === "all" ? "All workspaces" : (WORKSPACES.find((ws) => ws.id === scopeWorkspaceId)?.label ?? workspaceLabel)}
              </span>
              {projects.length > 0 && (
                <select
                  value={activeProjectId}
                  onChange={(event) => setActiveProjectId(event.target.value)}
                  className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-0.5 text-[10px] text-[color:var(--text-secondary)]"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={onOpenAssistant}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1 text-[11px] font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
              >
                <Sparkles size={11} /> Open Agent Console
              </button>
            </div>

            {/* 3-panel grid */}
            <div className="grid gap-4 lg:grid-cols-[196px_1fr_196px]">

              {/* Left: Skills palette */}
              <aside className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Skills</p>

                {[
                  {
                    label: "Mail", icon: Mail, color: "#3b82f6", skills: [
                      { label: "Read inbox", action: () => onOpenApp("mail") },
                      { label: "Draft reply", action: onOpenAssistant },
                      { label: "Summarize thread", action: onOpenAssistant },
                    ],
                  },
                  {
                    label: "Calendar", icon: CalendarDays, color: "#ec4899", skills: [
                      { label: "View today", action: () => onOpenApp("calendar") },
                      { label: "Create event", action: onOpenAssistant },
                      { label: "Find free slot", action: onOpenAssistant },
                    ],
                  },
                  {
                    label: "Tasks", icon: CheckSquare, color: "#8b5cf6", skills: [
                      { label: "Show open tasks", action: () => onOpenApp("tasks") },
                      { label: "Create task", action: onOpenAssistant },
                      { label: "Mark complete", action: onOpenAssistant },
                    ],
                  },
                  {
                    label: "Files", icon: FileText, color: "#22c55e", skills: [
                      { label: "Browse files", action: () => onOpenApp("files") },
                      { label: "Create document", action: onOpenAssistant },
                      { label: "Search drive", action: onOpenAssistant },
                    ],
                  },
                  {
                    label: "Design", icon: Wand2, color: "#14b8a6", skills: [
                      { label: "Open Figma flow", action: onOpenAssistant },
                      { label: "Generate visuals (Banana2)", action: onOpenAssistant },
                      { label: "Use 21st.dev assets", action: onOpenAssistant },
                    ],
                  },
                  {
                    label: "AI Runs", icon: Zap, color: "#f59e0b", skills: [
                      { label: "New run", action: onOpenAssistant },
                      { label: "View history", action: onOpenAssistant },
                    ],
                  },
                ].map((group) => (
                  <div key={group.label} className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                    <div className="mb-2 flex items-center gap-1.5">
                      <group.icon size={11} style={{ color: group.color }} />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-muted)]">{group.label}</span>
                    </div>
                    <div className="space-y-1">
                      {group.skills.map((skill) => (
                        <button
                          key={skill.label}
                          type="button"
                          onClick={skill.action}
                          className="w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1.5 text-left text-[11px] text-[color:var(--text-secondary)] transition hover:border-[color:var(--os-border-strong)] hover:text-[color:var(--text-primary)]"
                        >
                          {skill.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </aside>

              {/* Center: Runs timeline */}
              <div className="min-w-0 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Runs</p>
                  <div className="ml-auto flex gap-1">
                    {(["all", "running", "waiting", "failed", "success"] as RunFilter[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setRunFilter(f)}
                        className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.06em] transition ${
                          runFilter === f
                            ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                            : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                  {filteredRuns.length === 0 ? (
                    <div className="py-8 text-center">
                      <Sparkles size={20} className="mx-auto mb-2 text-[color:var(--text-muted)]" />
                      <p className="text-[12px] text-[color:var(--text-muted)]">No runs yet. Start an action from the Agent Console.</p>
                      <button
                        type="button"
                        onClick={onOpenAssistant}
                        className="mt-3 inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1 text-[11px] font-medium text-[color:var(--text-primary)]"
                      >
                        Open Console <ArrowRight size={11} />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredRuns.slice(0, 20).map((run) => {
                        const dotColor =
                          run.status === "success" ? "bg-emerald-500"
                          : run.status === "running" ? "bg-blue-500"
                          : run.status === "failed" ? "bg-rose-500"
                          : run.status === "waiting_for_approval" || run.status === "waiting_for_auth" ? "bg-amber-400"
                          : "bg-[color:var(--text-muted)]";
                        return (
                          <button
                            key={run.id}
                            type="button"
                            onClick={() => onOpenRun?.(run.id)}
                            className="flex w-full items-start gap-2.5 rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-left transition-colors hover:border-[color:var(--os-border-strong)] hover:bg-[color:var(--bg-surface-soft)]"
                          >
                            <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium text-[color:var(--text-primary)]">{run.intent}</p>
                              <p className="mt-0.5 text-[10px] text-[color:var(--text-muted)]">
                                {relativeTime(run.started_at)} · <span className={statusBadgeTone(run.status)}>{run.status}</span>
                              </p>
                            </div>
                            <span className={`mt-0.5 flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${statusBadgeTone(run.status)}`}>
                              {run.status}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Approvals inline */}
                {pendingApprovals.length > 0 && (
                  <div className="rounded-xl border border-amber-300/25 bg-amber-500/8 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-800">
                      Awaiting approval ({pendingApprovals.length})
                    </p>
                    {pendingApprovals.map((step) => (
                      <div key={step.id} className="mb-2 flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 last:mb-0">
                        <span className="text-[11px] text-white/70">{step.label}</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onConfirmStep?.(step.id); }}
                            className="rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/30"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDenyStep?.(step.id); }}
                            className="rounded-full bg-rose-500/20 px-3 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/30"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Artifacts rail */}
              <aside className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Artifacts</p>
                <div className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                  {artifacts.length === 0 ? (
                    <div className="py-6 text-center">
                      <Package size={18} className="mx-auto mb-2 text-[color:var(--text-muted)]" />
                      <p className="text-[11px] text-[color:var(--text-muted)]">No artifacts yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {artifacts.slice(0, 12).map((artifact) => (
                        <ArtifactResultCard key={artifact.id} artifact={artifact} compact />
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenApp("files")}
                    className="mt-3 w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1.5 text-[11px] text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)]"
                  >
                    Open Files ↗
                  </button>
                </div>
              </aside>

            </div>
          </section>
        ) : null}

        {activeSurface === "goals" ? (
          <section className="space-y-5">
            {/* North Star card with inline edit */}
            <article className="rounded-2xl border border-[color:var(--os-border-strong)] bg-[color:var(--bg-elevated)] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">North Star</p>
                {northStarDraft !== (northStar?.title ?? "") && northStarDraft.trim().length > 0 && (
                  <button
                    type="button"
                    disabled={northStarSaving}
                    onClick={async () => {
                      setNorthStarSaving(true);
                      try {
                        const headers = await withSupabaseAuthorization({ "x-workspace-id": workspaceId, "content-type": "application/json" });
                        await fetch(`/api/os/goals/north-star?workspace_id=${encodeURIComponent(workspaceId)}`, {
                          method: "POST",
                          credentials: "include",
                          headers,
                          body: JSON.stringify({ title: northStarDraft.trim() }),
                        });
                        void loadDashboard();
                      } finally {
                        setNorthStarSaving(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {northStarSaving ? <Loader2 size={10} className="animate-spin" /> : null}
                    Save
                  </button>
                )}
              </div>
              <textarea
                value={northStarDraft || (northStar?.title ?? "")}
                onChange={(e) => setNorthStarDraft(e.target.value)}
                rows={2}
                placeholder="Define your North Star goal…"
                className="mt-2 w-full resize-none rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-[15px] font-semibold text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)] focus:outline-none"
              />
              <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">Keep execution aligned with long-term intent via regular check-ins.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const goalText = northStarDraft.trim() || northStar?.title || "my goals";
                    onExecuteQuickAction({ app_id: "assistant", app_name: "Agent", action_id: "generate-plan", label: "Generate plan", intent: `Generate a weekly plan for: ${goalText}`, tool_ref: "agent.plan", requires_auth: false, requires_approval: false, state: "ready", badges: [] });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-accent-color,var(--os-border-strong))] bg-[color:var(--bg-surface-soft)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                >
                  <Zap size={11} /> Generate plan
                </button>
                <button type="button" onClick={onOpenGoals} className="rounded-full border border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--text-primary)]">Check-in</button>
                <button type="button" onClick={onOpenGoals} className="rounded-full border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[11px] text-[color:var(--text-secondary)]">Create operational goal</button>
              </div>
            </article>

            <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h4 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Operational Timeline</h4>
                  <div className="ml-auto flex gap-1">
                    {(["all", "at_risk", "owner"] as GoalFilter[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setGoalFilter(f)}
                        className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.06em] transition ${
                          goalFilter === f
                            ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                            : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"
                        }`}
                      >
                        {f === "at_risk" ? "At risk" : f === "owner" ? "Mine" : "All"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {filteredOperationalGoals.length === 0 ? (
                    <p className="text-[12px] text-[color:var(--text-muted)]">No operational goals yet.</p>
                  ) : filteredOperationalGoals.map((goal) => (
                    <div key={goal.id} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] text-[color:var(--text-primary)]">{goal.title}</p>
                        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusBadgeTone(goal.status)}`}>{goal.status}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-[color:var(--text-muted)]">
                        <span>{goal.priority.toUpperCase()}</span>
                        <span>·</span>
                        <span>Due {prettyDate(goal.due_at)}</span>
                        {(linkedGoalRuns.get(goal.id) ?? []).length > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-[color:var(--text-secondary)]">{linkedGoalRuns.get(goal.id)!.length} run(s)</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
                <h4 className="mb-3 text-[14px] font-semibold text-[color:var(--text-primary)]">Linked Runs</h4>
                <div className="space-y-2">
                  {(goalsData?.operational ?? []).slice(0, 4).map((goal) => {
                    const linked = linkedGoalRuns.get(goal.id) ?? [];
                    return (
                      <div key={goal.id} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
                        <p className="text-[12px] font-medium text-[color:var(--text-primary)]">{goal.title}</p>
                        {linked.length === 0 ? (
                          <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">No linked runs</p>
                        ) : linked.map((run) => (
                          <div key={run.id} className="mt-1 flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${run.status === "success" ? "bg-emerald-500" : run.status === "failed" ? "bg-rose-500" : run.status === "running" ? "bg-blue-500" : "bg-amber-400"}`} />
                            <p className="truncate text-[11px] text-[color:var(--text-muted)]">{run.intent}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {(goalsData?.operational ?? []).length === 0 && (
                    <p className="text-[12px] text-[color:var(--text-muted)]">Create goals to see run links here.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onOpenAssistant}
                  className="mt-3 w-full rounded-lg border border-[color:var(--os-border-soft)] px-3 py-2 text-[12px] text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)]"
                >
                  Suggested Actions from Runs
                </button>
              </article>
            </div>
          </section>
        ) : null}

        {activeSurface === "apps" ? (
          <section className="space-y-5">
            <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
              <h3 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Apps Launchpad</h3>
              <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">Open app surfaces. Manage auth/scopes in System.</p>
            </article>

            {/* ── Native OS Apps ─────────────────────────────────────────── */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Native Apps</p>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 xl:grid-cols-6">
                {nativeApps.map((app) => {
                  const Icon = nativeAppIcon(app.id);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => onOpenApp(app.id)}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4 text-center transition hover:bg-[color:var(--bg-surface-soft)] hover:border-[color:var(--os-border-strong)]"
                    >
                      <div className="grid h-12 w-12 place-items-center rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]">
                        <Icon size={22} className="text-[color:var(--text-secondary)]" />
                      </div>
                      <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{app.name}</span>
                      <span className="text-[11px] text-[color:var(--text-muted)] capitalize">{app.category}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Connected Integrations (bootstrap contract) ────────────── */}
            {launcherApps.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Integrations</p>
                <div className="grid gap-5 grid-cols-2 sm:grid-cols-4 xl:grid-cols-6">
                  {launcherApps.map((app) => {
                    const Icon = appIcon(app.icon_name);
                    return (
                      <article
                        key={`${app.source_app_id}:${app.app_id}`}
                        className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4 transition hover:bg-[color:var(--bg-surface-soft)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (app.launch_hint) {
                                onOpenApp(app.launch_hint as AppId);
                              } else {
                                onOpenAssistant();
                              }
                            }}
                            className="text-left"
                          >
                            <div className="relative inline-flex">
                              <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]">
                                <Icon size={26} className="text-[color:var(--text-secondary)]" />
                              </div>
                              <span className={`absolute -right-1 -top-1 inline-block h-2.5 w-2.5 rounded-full ${appStatusDotTone(app.status)}`} />
                            </div>
                            <h4 className="mt-2 text-[14px] font-semibold text-[color:var(--text-primary)]">{app.name}</h4>
                            <p className="text-[12px] text-[color:var(--text-muted)]">{app.category}</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSurface("settings");
                              onOpenSettings();
                            }}
                            className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]"
                            aria-label={`Manage ${app.name} in System`}
                            title="Manage in System"
                          >
                            ···
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {activeSurface === "settings" ? (
          <section className="space-y-5">
            <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
              <h3 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Workspace Admin</h3>
              <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">
                Integrations, policies, members and workspace health.
              </p>
            </article>
            <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
              <nav className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                {[
                  ["integrations", "Integrations"],
                  ["marketplace", "Marketplace"],
                  ["policies", "Policies"],
                  ["health", "Health"],
                  ["billing", "Billing"],
                  ["ai", "AI"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSystemSection(id as typeof systemSection)}
                    className={`mb-1 w-full rounded-xl border px-3 py-2 text-left text-[12px] ${
                      systemSection === id
                        ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                        : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-4">
                {systemSection === "integrations" ? (
                  <>
                    <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Apps & Integrations</h4>
                    <div className="mt-3 rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">Connectors</p>
                          <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                            Connect Elyra to your apps, files, and services so the agent and code tools can use the same context.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.08em]">
                          <span className="rounded-full border border-emerald-300/35 bg-emerald-500/12 px-2 py-0.5 text-emerald-800">
                            {connectorCards.filter((item) => item.status === "connected").length} connected
                          </span>
                          <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[color:var(--text-muted)]">
                            {connectorCards.length} available
                          </span>
                        </div>
                      </div>
                      {connectorActionNote ? (
                        <p className="mt-3 rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 py-2 text-[11px] text-[color:var(--text-secondary)]">
                          {connectorActionNote}
                        </p>
                      ) : null}
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {connectorCards.map((connector) => {
                          const Icon =
                            connector.id === "github"
                              ? GitBranch
                              : connector.id === "icloud_calendar"
                                ? Calendar
                                : connector.id === "icloud_mail"
                                  ? Mail
                              : connector.id === "google_calendar"
                                ? CalendarDays
                                : connector.id === "google_drive"
                                  ? FileText
                                  : connector.id === "gmail"
                                    ? Mail
                                    : connector.id === "figma"
                                      ? Wand2
                                      : connector.id === "google_stitch"
                                        ? Sparkles
                                        : connector.id === "twentyfirst"
                                          ? Code2
                                      : connector.id === "supabase"
                                        ? Network
                                        : connector.id === "vercel"
                                          ? Zap
                                          : Link2;
                          const isConnected = connector.status === "connected";
                          return (
                            <div key={connector.id} className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                  <div className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]">
                                    <Icon size={16} className="text-[color:var(--text-secondary)]" />
                                  </div>
                                  <div>
                                    <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{connector.name}</p>
                                    <p className="text-[11px] text-[color:var(--text-muted)]">{connector.category}</p>
                                  </div>
                                </div>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${statusBadgeTone(isConnected ? "connected" : "needs_auth")}`}>
                                  {isConnected ? "connected" : "available"}
                                </span>
                              </div>
                              <p className="mt-2 text-[11px] leading-5 text-[color:var(--text-secondary)]">{connector.description}</p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {connector.source === "google" ? (
                                  <>
                                    <button type="button" onClick={onConnectGoogle} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
                                      {isConnected ? "Reconnect" : "Connect"}
                                    </button>
                                    {isConnected ? (
                                      <button type="button" onClick={onDisconnectGoogle} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
                                        Disconnect
                                      </button>
                                    ) : null}
                                  </>
                                ) : connector.source === "github" ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isConnected) {
                                          setActiveSurface("apps");
                                          onOpenApp("code");
                                          return;
                                        }
                                        void connectGithub();
                                      }}
                                      className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                    >
                                      {isConnected ? "Open" : "Connect"}
                                    </button>
                                    {isConnected ? (
                                      <button type="button" onClick={() => void disconnectGithub()} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
                                        Disconnect
                                      </button>
                                    ) : null}
                                  </>
                                ) : connector.source === "icloud_mail" ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      window.location.href = `/os/mail/connect?workspaceId=${encodeURIComponent(workspaceId)}`;
                                    }}
                                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                  >
                                    {isConnected ? "Reconnect" : "Connect"}
                                  </button>
                                ) : connector.source === "icloud_calendar" ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      window.location.href = `/os/calendar/connect?workspaceId=${encodeURIComponent(workspaceId)}`;
                                    }}
                                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                  >
                                    {isConnected ? "Reconnect" : "Connect"}
                                  </button>
                                ) : connector.source === "figma" ? (
                                  <button
                                    type="button"
                                    onClick={() => { void connectExternalIntegration("figma"); }}
                                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                  >
                                    {isConnected ? "Open" : "Connect"}
                                  </button>
                                ) : connector.source === "banana2" ? (
                                  <button
                                    type="button"
                                    onClick={() => { void connectExternalIntegration("banana2"); }}
                                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                  >
                                    {isConnected ? "Open" : "Connect"}
                                  </button>
                                ) : connector.source === "google_stitch" ? (
                                  <button
                                    type="button"
                                    onClick={() => { void connectExternalIntegration("google_stitch"); }}
                                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                  >
                                    {isConnected ? "Open" : "Connect"}
                                  </button>
                                ) : connector.source === "twentyfirst" ? (
                                  <button
                                    type="button"
                                    onClick={() => { void connectExternalIntegration("twentyfirst"); }}
                                    className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
                                  >
                                    {isConnected ? "Open" : "Connect"}
                                  </button>
                                ) : (
                                  <button type="button" onClick={() => setConnectorActionNote(`${connector.name} is available to Elyra tools but does not have a dedicated OAuth connector flow in this screen yet.`)} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
                                    Open
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {launcherApps.map((app) => (
                        <div key={`${app.source_app_id}:${app.app_id}`} className="flex items-center justify-between rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2">
                          <div>
                            <p className="text-[12px] text-[color:var(--text-primary)]">{app.name}</p>
                            <p className="text-[11px] text-[color:var(--text-muted)]">{app.category}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={app.name.toLowerCase().includes("mail") || app.name.toLowerCase().includes("calendar") || app.name.toLowerCase().includes("drive") ? onConnectGoogle : () => setConnectorActionNote(`Open ${app.name} from the app launcher to configure it.`)}
                              className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]"
                            >
                              Connect
                            </button>
                            <button
                              type="button"
                              onClick={app.name.toLowerCase().includes("mail") || app.name.toLowerCase().includes("calendar") || app.name.toLowerCase().includes("drive") ? onDisconnectGoogle : () => setConnectorActionNote(`${app.name} does not expose a disconnect flow in this panel yet.`)}
                              className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]"
                            >
                              Disconnect
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h4 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">{systemSection}</h4>
                    <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">Control-plane section. Configure this area in System without cluttering Home or Apps.</p>
                  </>
                )}
              </article>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
