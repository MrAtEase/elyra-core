"use client";

import { AnimatePresence } from "framer-motion";
import {
  Suspense,
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Columns2, LayoutGrid, Minus, X, XCircle } from "lucide-react";
import { KernelProvider, useKernel } from "@/components/os/kernel/KernelProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { eventBus } from "@/components/os/kernel/eventBus";
import { WORKSPACES } from "@/components/os/kernel/workspaceModel";
import { setWorkspaceViewportBottomInset, setWorkspaceViewportRightInset } from "@/components/os/kernel/windowManager";
import type { AppId, IntentAttachment } from "@/components/os/kernel/types";
import AppLauncherOverlay from "@/components/os/shell/AppLauncherOverlay";
import DesktopSurface from "@/components/os/shell/DesktopSurface";
import AgentConsoleRail from "@/components/agent/AgentConsoleRail";
import type { AIDockContext, AIDockSurfaceId } from "@/components/agent/aidock/types";
import IntentLine, { type IntentLineAttachment, type IntentLineHandle } from "@/components/os/shell/IntentLine";
import OrbArea from "@/components/os/shell/OrbArea";
import OrbMount from "@/components/os/shell/OrbMount";
import SettingsView from "@/components/os/shell/SettingsView";
import PlanModeOverlay from "@/components/os/shell/PlanModeOverlay";
import WorkspaceOnboardingWizard from "@/components/os/shell/WorkspaceOnboardingWizard";
import WindowChrome from "@/components/os/shell/WindowChrome";
import WindowDock from "@/components/os/shell/WindowDock";
import {
  SHELL_LAYERS,
  SHELL_LAYER_DATA_ATTR,
} from "@/components/os/shell/layers";
import GraphApp from "@/components/os/apps/graph/GraphApp";
import {
  disconnectGoogle,
  fetchGoogleStatus,
  startGoogleConnect,
  type GoogleStatusResponse,
} from "@/components/os/apps/liveGoogleClient";
import { ensureSupabaseToken, supabaseBrowserClient } from "@/lib/supabase/browser";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import type { WorkspaceKind } from "@/components/os/kernel/types";
import { getLogoutEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import IdentityMenu from "@/components/os/shell/IdentityMenu";
import type { ResolvedQuickAction, ResolvedUiModel } from "@/lib/orb-os/contracts/rendering";
import type { ToolRegistryItem, UiBootstrapContract } from "@/lib/orb-os/contracts/types";

const AppApprovalsWindow = lazy(() => import("@/components/os/apps/AppApprovalsWindow"));
const AppAuditWindow = lazy(() => import("@/components/os/apps/AppAuditWindow"));
const AppRunsWindow = lazy(() => import("@/components/os/apps/AppRunsWindow"));
const BuilderWindow = lazy(() => import("@/components/os/apps/builder/BuilderWindow"));
const StudioWindow = lazy(() => import("@/components/os/apps/studio/StudioWindow"));
const CodingAgentWindow = lazy(() => import("@/components/os/apps/code/CodingAgentWindow"));
const CalendarWindow = lazy(() => import("@/components/os/apps/calendar/CalendarWindow"));
const FilesWindow = lazy(() => import("@/components/os/apps/files/FilesWindow"));
const MailWindow = lazy(() => import("@/components/os/apps/mail/MailWindow"));
const SlidesWindow = lazy(() => import("@/components/os/apps/slides/SlidesWindow"));
const AdminSettingsWindow = lazy(() => import("@/components/os/apps/settings/AdminSettingsWindow"));
const AiSettingsWindow = lazy(() => import("@/components/os/apps/settings/AiSettingsWindow"));
const OsSettingsWindow = lazy(() => import("@/components/os/apps/settings/OsSettingsWindow"));
const TasksWindow = lazy(() => import("@/components/os/apps/tasks/TasksWindow"));
const WeatherWindow = lazy(() => import("@/components/os/apps/weather/WeatherWindow"));
const ImageStudioWindow = lazy(() => import("@/components/os/apps/studio/ImageStudioWindow"));

type OverlayRole = "owner" | "admin" | "member";
type OrbActivityState =
  | "idle"
  | "thinking"
  | "listening"
  | "planning"
  | "attention"
  | "degraded"
  | "executing"
  | "waiting_for_auth"
  | "waiting_for_approval"
  | "success"
  | "error";
type OrbMountState = "idle" | "hover" | "active" | "thinking" | "warning" | "success" | "error";
type Layer = "orb" | "apps" | "identityMenu" | "modal" | "settings";

type BootstrapApiResponse =
  | {
      ok: true;
      contract: UiBootstrapContract;
      ui: ResolvedUiModel;
    }
  | {
      ok: false;
      error: string;
    };

type IntentRouteTarget = "code" | "slides" | "builder" | "mail" | "calendar" | "tasks" | "general";

function renderAppWindow(appId: AppId, windowId: string, workspaceId: string, accent: string) {
  let content: ReactElement;
  if (appId === "mail") content = <MailWindow windowId={windowId} />;
  else if (appId === "calendar") content = <CalendarWindow windowId={windowId} />;
  else if (appId === "tasks") content = <TasksWindow windowId={windowId} />;
  else if (appId === "files") content = <FilesWindow />;
  else if (appId === "graph") content = <GraphApp workspaceId={workspaceId} accent={accent} />;
  else if (appId === "builder") content = <BuilderWindow />;
  else if (appId === "slides") content = <SlidesWindow />;
  else if (appId === "studio") content = <StudioWindow />;
  else if (appId === "code") content = <CodingAgentWindow />;
  else if (appId === "weather") content = <WeatherWindow />;
  else if (appId === "settings_ai") content = <AiSettingsWindow />;
  else if (appId === "settings_os") content = <OsSettingsWindow />;
  else if (appId === "settings_admin") content = <AdminSettingsWindow />;
  else if (appId === "approvals") content = <AppApprovalsWindow />;
  else if (appId === "audit") content = <AppAuditWindow />;
  else if (appId === "runs") content = <AppRunsWindow />;
  else if (appId === "image_studio") content = <ImageStudioWindow workspaceId={workspaceId} />;
  else content = <AdminSettingsWindow />;

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading...</div>}>
      {content}
    </Suspense>
  );
}

function roleFromWorkspaceKind(workspaceKind: WorkspaceKind): OverlayRole {
  if (workspaceKind === "platform") return "owner";
  if (workspaceKind === "organization") return "admin";
  return "member";
}

function workspaceKindLabel(kind: WorkspaceKind): string {
  switch (kind) {
    case "individual":
      return "Privat";
    case "organization":
      return "Unternehmen";
    case "platform":
      return "System";
    default:
      return kind;
  }
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim().replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized.split("").map((part) => `${part}${part}`).join("")
      : normalized;
  if (expanded.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return `rgba(255, 255, 255, ${alpha})`;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, [role=\"textbox\"], select"));
}

function parseSettingsSection(pathname: string): string | null {
  if (!pathname.startsWith("/os/settings")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 2) return "profile";
  return segments[2] || "profile";
}

function parseRoutedApp(pathname: string): AppId | null {
  if (pathname.startsWith("/os/mail")) return "mail";
  if (pathname.startsWith("/os/calendar")) return "calendar";
  if (pathname.startsWith("/os/tasks")) return "tasks";
  if (pathname.startsWith("/os/files")) return "files";
  if (pathname.startsWith("/os/graph")) return "graph";
  if (pathname.startsWith("/os/builder")) return "builder";
  if (pathname.startsWith("/os/slides")) return "slides";
  if (pathname.startsWith("/os/studio")) return "studio";
  if (pathname.startsWith("/os/code")) return "code";
  if (pathname.startsWith("/os/weather")) return "weather";
  return null;
}

function parseDesktopSurface(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "home" || normalized === "dashboard") return "dashboard";
  if (normalized === "agent" || normalized === "assistant") return "assistant";
  if (normalized === "goals") return "goals";
  if (normalized === "apps") return "apps";
  if (normalized === "system" || normalized === "settings") return "settings";
  if (normalized === "builder") return "builder";
  if (normalized === "marketplace") return "marketplace";
  return null;
}

function mapWindowToSurface(appId: AppId): AIDockSurfaceId {
  if (appId === "mail") return "mail";
  if (appId === "calendar") return "calendar";
  if (appId === "tasks") return "tasks";
  if (appId === "slides") return "slides";
  if (appId === "files") return "drive";
  if (appId === "graph") return "apps";
  if (appId === "builder") return "research";
  if (appId === "studio") return "apps";
  if (appId === "code") return "apps";
  if (appId === "settings_ai" || appId === "settings_os" || appId === "settings_admin") return "system";
  if (appId === "approvals" || appId === "audit" || appId === "runs") return "system";
  return "agent";
}

function mapDesktopSurfaceToDock(surface: string): AIDockSurfaceId {
  if (surface === "assistant") return "agent";
  if (surface === "goals") return "goals";
  if (surface === "apps") return "apps";
  if (surface === "settings") return "system";
  return "home";
}

const APP_SHORTCUTS: Array<{ key: string; appId: AppId }> = [
  { key: "1", appId: "mail" },
  { key: "2", appId: "calendar" },
  { key: "3", appId: "tasks" },
  { key: "4", appId: "files" },
  { key: "5", appId: "builder" },
  { key: "6", appId: "slides" },
];

const QUICK_ACTION_TO_APP: Record<string, AppId> = {
  google_mail: "mail",
  google_calendar: "calendar",
  google_drive: "files",
  google_slides: "slides",
};

const INTENT_LINE_ZONE_PX = 96;
const INTENT_LINE_CONTENT_PAD_PX = 6;

function buildUserInitials(value?: string | null): string {
  if (!value) return "EC";
  const local = value.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return (local.slice(0, 2).toUpperCase() || "EC");
}

// Human-readable label for each routed app (shown in the chrome bar)
const ROUTED_APP_LABELS: Partial<Record<AppId, string>> = {
  code:     "Coding Agent",
  mail:     "Mail",
  calendar: "Calendar",
  tasks:    "Tasks",
  files:    "Files",
  builder:  "Builder",
  slides:   "Slides",
  studio:   "Studio",
  weather:  "Weather",
};

// Apps that have their own route — openApp navigates there instead of creating a floating window
const ROUTED_APP_PATHS: Partial<Record<AppId, string>> = {
  code:     "/os/code",
  mail:     "/os/mail",
  calendar: "/os/calendar",
  tasks:    "/os/tasks",
  files:    "/os/files",
  builder:  "/os/builder",
  slides:   "/os/slides",
  studio:   "/os/studio",
  weather:  "/os/weather",
};

type WorkspaceOSInnerProps = {
  whoami: WhoamiResponse | null;
  children?: ReactNode;
};

function WorkspaceOSInner({ whoami, children }: WorkspaceOSInnerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    state,
    activeWorkspace,
    activeWindows,
    activeMessages,
    activeArtifacts,
    activeIntentState,
    setActiveWorkspace,
    openApp,
    closeWindow,
    focusWindow,
    minimizeWindow,
    toggleWindowMaximized,
    moveWindow,
    resizeWindow,
    splitWindows,
    setOverlayOpen,
    submitIntent,
    executeQuickAction,
    confirmActiveIntentStep,
    denyActiveIntentStep,
    cancelActiveIntent,
    retryActiveIntent,
    clearActiveIntent,
  } = useKernel();
  const normalizedActiveWorkspaceId =
    normalizeWorkspaceId(activeWorkspace.id) ?? activeWorkspace.id;

  // Whether the current URL corresponds to a routed app (not the home/desktop view)
  const routedAppId = parseRoutedApp(pathname); // null on /os home
  const isRoutedApp = routedAppId !== null;

  // Route-aware openApp: navigates to the app's URL for routed apps,
  // falls back to kernel floating-window for utility apps (approvals, audit, runs, graph).
  const handleOpenApp = useCallback((appId: AppId) => {
    const route = ROUTED_APP_PATHS[appId];
    if (route && parseRoutedApp(pathname) !== appId) {
      router.push(`${route}?workspaceId=${encodeURIComponent(normalizedActiveWorkspaceId)}`);
    }
    openApp(appId); // keep kernel window state in sync for backwards-compat
  }, [normalizedActiveWorkspaceId, openApp, pathname, router]);

  const urlSyncInitializedRef = useRef(false);
  // Ref copy of normalizedActiveWorkspaceId — lets Effect A read the current workspace
  // without being a dep of it (avoids the revert loop when a tab click happens before
  // the URL has been updated by Effect B).
  const normalizedActiveWorkspaceIdRef = useRef(normalizedActiveWorkspaceId);
  useEffect(() => { normalizedActiveWorkspaceIdRef.current = normalizedActiveWorkspaceId; });
  const lastRoutedAppRef = useRef<string | null>(null);
  const intentLineRef = useRef<IntentLineHandle>(null);
  const identityButtonRef = useRef<HTMLButtonElement>(null);

  const [orbHover, setOrbHover] = useState(false);
  const [orbActivityState, setOrbActivityState] = useState<OrbActivityState>("idle");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<GoogleStatusResponse | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [elyPanelVisible, setElyPanelVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });
  const [dockWidth, setDockWidth] = useState<number>(380);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [resolvedUiModel, setResolvedUiModel] = useState<ResolvedUiModel | null>(null);
  const [bootstrapContract, setBootstrapContract] = useState<UiBootstrapContract | null>(null);
  const [desktopSurface, setDesktopSurface] = useState<string>("dashboard");
  const [toggleChatSignal, setToggleChatSignal] = useState(0);
  const [focusActionsSignal, setFocusActionsSignal] = useState(0);
  const sessionCacheRef = useRef<Record<string, GoogleStatusResponse | null>>({});
  const bootstrapCacheRef = useRef<Record<string, { contract: UiBootstrapContract; ui: ResolvedUiModel } | null>>({});
  const onboardingCacheRef = useRef<Record<string, boolean>>({});
  const looksLikeCodeIntent = useCallback((text: string) => {
    const lower = text.toLowerCase();
    const codeVerbs = [
      "scan",
      "analyze",
      "analyse",
      "inspect",
      "audit",
      "find",
      "show",
      "fix",
      "repair",
      "debug",
      "refactor",
      "implement",
      "change",
      "update",
      "rewrite",
      "review",
      "überprüf",
      "prüf",
      "prüf",
      "änd",
      "verbesser",
      "überarbeit",
      "bearbeit",
      "mach",
      "build",
      "fehler",
      "bug",
    ];
    const codeTargets = [
      "app",
      "ui",
      "frontend",
      "backend",
      "component",
      "feature",
      "error",
      "weather app",
      "wetter app",
      "surf",
      "mail app",
      "calendar app",
      "kalender",
      "task app",
      "todo",
      "intent line",
      "chat",
      "builder",
      "workflow",
      "code",
      "repo",
      "repository",
      "whole repo",
      "issues",
      "issue",
      "problem",
      "problems",
      "datei",
      "window",
      "typescript",
      "next js",
      "nextjs",
      "react",
    ];

    const hasVerb = codeVerbs.some((term) => lower.includes(term));
    const hasTarget = codeTargets.some((term) => lower.includes(term));
    const mentionsFilePath = /([\w-]+\/)+[\w.-]+\.(tsx|ts|js|jsx|css|md|json)/i.test(text);
    return (hasVerb && hasTarget) || mentionsFilePath;
  }, []);
  const looksLikeCodeReviewIntent = useCallback((text: string) => {
    const lower = text.toLowerCase();
    return (
      /\b(scan|review|analy[sz]e|analyse|inspect|audit|find|show)\b/.test(lower) &&
      /\b(repo|repository|codebase|whole repo|issues|issue|problems|problem|errors|fehler)\b/.test(lower)
    );
  }, []);
  const routeIntentTarget = useCallback((text: string, attachments: IntentAttachment[] = []): IntentRouteTarget => {
    const lower = text.toLowerCase();
    const hasImages = attachments.some((attachment) => attachment.mimeType.startsWith("image/"));

    const mentionsSlides =
      /\b(slide|slides|deck|presentation|pitch deck|pitchdeck|folien|folie|google slides)\b/i.test(text);
    const mentionsBuilder =
      /\b(builder|workflow|automation|pipeline|flow)\b/i.test(text);
    const mentionsMail =
      /\b(mail|email|gmail|inbox|draft reply|antworten)\b/i.test(text);
    const mentionsCalendar =
      /\b(calendar|kalender|event|meeting|schedule|plan my week|woche planen)\b/i.test(text);
    const mentionsTasks =
      /\b(task|tasks|todo|to-do|aufgabe|aufgaben)\b/i.test(text);
    const mentionsCode = looksLikeCodeIntent(text) || looksLikeCodeReviewIntent(text);

    if (mentionsSlides) return "slides";
    if (mentionsBuilder) return "builder";
    if (mentionsMail) return "mail";
    if (mentionsCalendar) return "calendar";
    if (mentionsTasks) return "tasks";
    if (mentionsCode) return "code";
    if (hasImages && /\b(ui|layout|screen|app|component|button|window|weather|chat|intent)\b/i.test(text)) {
      return "code";
    }
    return "general";
  }, [looksLikeCodeIntent]);
  const guessCodeTargetFiles = useCallback((text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes("weather") || lower.includes("wetter") || lower.includes("surf")) {
      return ["components/os/apps/weather/WeatherWindow.tsx"];
    }
    if (lower.includes("mail")) {
      return ["components/os/programs/MailProgram.tsx"];
    }
    if (lower.includes("calendar") || lower.includes("kalender")) {
      return ["components/os/programs/CalendarProgram.tsx"];
    }
    if (lower.includes("task") || lower.includes("todo") || lower.includes("aufgabe")) {
      return ["components/os/apps/tasks/TasksApp.tsx"];
    }
    if (lower.includes("builder") || lower.includes("workflow")) {
      return ["components/os/apps/builder/BuilderWindow.tsx"];
    }
    if (
      lower.includes("menu") ||
      lower.includes("dropdown") ||
      lower.includes("profile") ||
      lower.includes("account") ||
      lower.includes("namen") ||
      lower.includes("name")
    ) {
      return ["components/os/shell/IdentityMenu.tsx"];
    }
    if (
      lower.includes("intent") ||
      lower.includes("input") ||
      lower.includes("composer") ||
      lower.includes("prompt")
    ) {
      return ["components/os/shell/IntentLine.tsx"];
    }
    if (lower.includes("rail") || lower.includes("right rail")) {
      return ["components/agent/AIDock.tsx"];
    }
    return [];
  }, []);
  const forwardIntentToCode = useCallback(
    (text: string, attachments: IntentAttachment[]) => {
      const trimmed = text.trim();
      const reviewIntent = looksLikeCodeReviewIntent(trimmed);
      const selectedFiles = reviewIntent ? [] : guessCodeTargetFiles(trimmed);
      const shouldAutoExecute = reviewIntent || (attachments.length > 0 && trimmed.length > 0);
      const repoUrl = /\b(repo|repository|whole repo|codebase)\b/i.test(trimmed)
        ? "/Users/paulodak/Projects/elyra-core"
        : "/Users/paulodak/Projects/elyra-core/frontend";
      const payload = {
        task: trimmed,
        skill: (reviewIntent ? "review-code" : "custom") as "review-code" | "custom",
        repoUrl,
        ...(selectedFiles.length > 0 ? { selectedFiles } : {}),
        attachments,
        autoRun: true,
        ...(shouldAutoExecute ? { autoExecute: true } : {}),
      };
      window.localStorage.setItem("elyra_ai_task_queue", JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent("elyra:code-task-queued"));
      handleOpenApp("code");
    },
    [guessCodeTargetFiles, handleOpenApp, looksLikeCodeReviewIntent],
  );
  const forwardIntentToSlides = useCallback(
    (text: string, attachments: IntentLineAttachment[]) => {
      try {
        window.localStorage.setItem(
          "elyra_slides_quickstart",
          JSON.stringify({
            prompt: text.trim(),
            attachments,
          }),
        );
      } catch {
        // ignore quickstart persistence issues
      }
      handleOpenApp("slides");
    },
    [handleOpenApp],
  );
  const handleIntentLineSubmit = useCallback(
    (text: string, attachments: IntentAttachment[] = []) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;

      const target = routeIntentTarget(trimmed, attachments);

      if (target === "code") {
        forwardIntentToCode(trimmed, attachments);
        return;
      }
      if (target === "slides") {
        forwardIntentToSlides(trimmed, attachments);
        return;
      }
      if (target === "builder") {
        handleOpenApp("builder");
        submitIntent(trimmed, attachments);
        return;
      }
      if (target === "mail") {
        handleOpenApp("mail");
        submitIntent(trimmed, attachments);
        return;
      }
      if (target === "calendar") {
        handleOpenApp("calendar");
        submitIntent(trimmed, attachments);
        return;
      }
      if (target === "tasks") {
        handleOpenApp("tasks");
        submitIntent(trimmed, attachments);
        return;
      }

      submitIntent(trimmed, attachments);
    },
    [forwardIntentToCode, forwardIntentToSlides, handleOpenApp, routeIntentTarget, submitIntent],
  );
  const addLayer = useCallback((layer: Layer) => {
    setLayers((prev) => {
      const next = prev.filter((entry) => entry !== layer);
      return [...next, layer];
    });
  }, []);
  const removeLayer = useCallback((layer: Layer) => {
    setLayers((prev) => prev.filter((entry) => entry !== layer));
  }, []);
  const layersRef = useRef<Layer[]>([]);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  useEffect(() => {
    if (shortcutsOpen || needsOnboarding) {
      addLayer("modal");
    } else {
      removeLayer("modal");
    }
  }, [shortcutsOpen, needsOnboarding, addLayer, removeLayer]);
  // Tracking open overlays for ESC/order handling
  const closeAppLauncher = useCallback(() => setAppLauncherOpen(false), []);
  const closeIdentityMenu = useCallback(() => setIdentityMenuOpen(false), []);
  const closeModal = useCallback(() => {
    if (shortcutsOpen) {
      setShortcutsOpen(false);
      return;
    }
    if (needsOnboarding) {
      setNeedsOnboarding(false);
    }
  }, [needsOnboarding, shortcutsOpen]);
  const closeAllOverlays = useCallback(() => {
    setOverlayOpen(false);
    closeAppLauncher();
    closeIdentityMenu();
    closeModal();
  }, [setOverlayOpen, closeAppLauncher, closeIdentityMenu, closeModal]);

  // ── Orb panel ──────────────────────────────────────────────────────────────
  const openOrbMenu = useCallback(() => {
    setAppLauncherOpen(false);
    setIdentityMenuOpen(false);
    setOverlayOpen(true);
  }, [setOverlayOpen]);

  const closeOrbMenu = useCallback(() => {
    setOverlayOpen(false);
    setIdentityMenuOpen(false);
  }, [setOverlayOpen]);

  const focusIntentLine = useCallback(() => {
    intentLineRef.current?.focus();
  }, []);

  // ── App launcher ──────────────────────────────────────────────────────────
  const toggleAppLauncher = useCallback(() => {
    setAppLauncherOpen((prev) => {
      const next = !prev;
      if (next) {
        setOverlayOpen(false);
        setIdentityMenuOpen(false);
      }
      return next;
    });
  }, [setOverlayOpen]);

  const toggleIdentityMenu = useCallback(() => {
    if (identityMenuOpen) {
      setIdentityMenuOpen(false);
      return;
    }
    setOverlayOpen(false);
    setAppLauncherOpen(false);
    setIdentityMenuOpen(true);
  }, [identityMenuOpen, setOverlayOpen]);

  const handleLogout = useCallback(async () => {
    closeAllOverlays();
    try {
      await supabaseBrowserClient.auth.signOut();
    } catch (error) {
      console.warn("Logout: supabase signOut failed", error);
    }
    try {
      await fetch(getLogoutEndpoint(), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } catch (error) {
      console.warn("Logout: assistant endpoint failed", error);
    }
    router.replace("/signin");
  }, [closeAllOverlays, router]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const topWindow = useMemo(
    () =>
      [...activeWindows]
        .filter((w) => !w.minimized)
        .sort((a, b) => b.zIndex - a.zIndex)[0],
    [activeWindows],
  );

  const settingsSection = parseSettingsSection(pathname);
  const settingsOpen = settingsSection !== null;
  useEffect(() => {
    if (settingsOpen) {
      addLayer("settings");
    } else {
      removeLayer("settings");
    }
  }, [settingsOpen, addLayer, removeLayer]);
  const activeRole = roleFromWorkspaceKind(activeWorkspace.kind);

  const openSettings = useCallback(
    (section = "profile") => {
      router.push(section ? `/os/settings/${section}` : "/os/settings", { scroll: false });
    },
    [router],
  );

  const closeSettings = useCallback(() => {
    router.push("/os", { scroll: false });
  }, [router]);

  const closeTopLayer = useCallback(() => {
    const topLayer = layersRef.current[layersRef.current.length - 1];
    if (!topLayer) return;
    switch (topLayer) {
      case "apps":
        closeAppLauncher();
        closeOrbMenu();
        return;
      case "orb":
        setOverlayOpen(false);
        return;
      case "identityMenu":
        closeIdentityMenu();
        return;
      case "modal":
        closeModal();
        return;
      case "settings":
        closeSettings();
        return;
      default:
        return;
    }
  }, [
    closeAppLauncher,
    closeIdentityMenu,
    closeOrbMenu,
    closeModal,
    closeSettings,
    setOverlayOpen,
  ]);

  const isPointerEventInsideLayer = useCallback((event: PointerEvent) => {
    const path = event.composedPath ? event.composedPath() : [];
    for (const entry of path) {
      if (entry instanceof Element && entry.hasAttribute(SHELL_LAYER_DATA_ATTR)) {
        return true;
      }
    }
    if (event.target instanceof Element && event.target.closest(`[${SHELL_LAYER_DATA_ATTR}]`)) {
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (layersRef.current.length === 0) return;
      if (isPointerEventInsideLayer(event)) return;
      closeTopLayer();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [closeTopLayer, isPointerEventInsideLayer]);

  // ── Window cycling (⌘Tab) ─────────────────────────────────────────────────
  const cycleWindows = useCallback(
    (backward: boolean) => {
      const visible = activeWindows.filter((w) => !w.minimized);
      if (visible.length < 2) return;
      const sorted = [...visible].sort((a, b) => b.zIndex - a.zIndex);
      const target = backward ? sorted[sorted.length - 1] : sorted[1];
      if (target) focusWindow(target.id);
    },
    [activeWindows, focusWindow],
  );

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => setElyPanelVisible(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const routedApp = parseRoutedApp(pathname);
    if (!routedApp) { lastRoutedAppRef.current = null; return; }
    // Use "appId:workspaceId" as the guard key so we re-open the window when the
    // workspace switches while the user is already on a routed app URL.
    const key = `${routedApp}:${normalizedActiveWorkspaceId}`;
    if (lastRoutedAppRef.current === key) return;
    lastRoutedAppRef.current = key;
    openApp(routedApp);
  }, [normalizedActiveWorkspaceId, openApp, pathname]);

  // When a routed app window is explicitly closed, navigate the URL back to /os so the URL
  // doesn't permanently show /os/code (or /os/mail etc.) after the user closes the window.
  const routedWindowEverOpenRef = useRef(false);
  // Reset the "ever open" tracker when workspace switches so the close-detection effect below
  // doesn't falsely navigate back to /os when the new workspace has no window yet.
  useEffect(() => { routedWindowEverOpenRef.current = false; }, [normalizedActiveWorkspaceId]);
  useEffect(() => {
    const currentRoutedApp = parseRoutedApp(pathname);
    if (!currentRoutedApp) { routedWindowEverOpenRef.current = false; return; }
    const routedWindowOpen = activeWindows.some((w) => w.appId === currentRoutedApp);
    if (routedWindowOpen) {
      routedWindowEverOpenRef.current = true;
      return;
    }
    // Navigate back to /os only when the window was previously open (i.e. explicitly closed)
    if (routedWindowEverOpenRef.current) {
      routedWindowEverOpenRef.current = false;
      router.replace(
        `/os?workspaceId=${encodeURIComponent(normalizedActiveWorkspaceId)}`,
        { scroll: false },
      );
    }
  }, [activeWindows, normalizedActiveWorkspaceId, pathname, router]);

  // URL → state: when the browser URL changes (back/forward, deep link), sync to kernel state.
  // Uses normalizedActiveWorkspaceIdRef (not the value directly) so this effect only fires
  // on URL changes — NOT on workspace-state changes caused by tab clicks. Without the ref,
  // a tab click updates state before the URL is updated, which causes Effect B below to
  // re-read the OLD URL and revert the click.
  useEffect(() => {
    const requestedWorkspaceIdRaw = searchParams.get("workspace_id") || searchParams.get("workspaceId");
    const requestedWorkspaceId = normalizeWorkspaceId(requestedWorkspaceIdRaw) ?? requestedWorkspaceIdRaw;
    if (!requestedWorkspaceId || requestedWorkspaceId === normalizedActiveWorkspaceIdRef.current) return;
    const requested = WORKSPACES.find((workspace) => workspace.id === requestedWorkspaceId);
    if (!requested) return;
    setActiveWorkspace(requested.id);
  }, [searchParams, setActiveWorkspace]);

  // Keep workspaceId URL param in sync when the active workspace changes (e.g. tab click).
  useEffect(() => {
    if (!urlSyncInitializedRef.current) return;
    const currentId = normalizeWorkspaceId(
      searchParams.get("workspaceId") || searchParams.get("workspace_id"),
    );
    if (currentId === normalizedActiveWorkspaceId) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("workspace_id");
    next.set("workspaceId", normalizedActiveWorkspaceId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [normalizedActiveWorkspaceId, pathname, router, searchParams]);

  useEffect(() => {
    const requestedSurface = parseDesktopSurface(searchParams.get("surface"));
    if (!requestedSurface) return;
    setDesktopSurface((previous) => (previous === requestedSurface ? previous : requestedSurface));
  }, [searchParams]);

  const refreshSessionStatus = useCallback(async () => {
    try {
      const payload = await fetchGoogleStatus(normalizedActiveWorkspaceId);
      setSessionStatus(payload);
      setSessionError(null);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to load user status.");
      setSessionStatus(null);
    }
  }, [normalizedActiveWorkspaceId]);

  const fetchBootstrapPayload = useCallback(async (): Promise<{ contract: UiBootstrapContract; ui: ResolvedUiModel } | null> => {
    try {
      const headers = await withSupabaseAuthorization({
        "x-workspace-id": normalizedActiveWorkspaceId,
      });
      const response = await fetch(`/api/os/bootstrap?workspace_id=${encodeURIComponent(normalizedActiveWorkspaceId)}`, {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      const payload = (await response.json()) as BootstrapApiResponse;
      if (!response.ok || !payload.ok) return null;
      const next = {
        contract: payload.contract,
        ui: payload.ui,
      };
      bootstrapCacheRef.current[normalizedActiveWorkspaceId] = next;
      return next;
    } catch {
      return null;
    }
  }, [normalizedActiveWorkspaceId]);

  const loadBootstrap = useCallback(async () => {
    const payload = await fetchBootstrapPayload();
    if (!payload) {
      setResolvedUiModel(null);
      setBootstrapContract(null);
      return;
    }
    setResolvedUiModel(payload.ui);
    setBootstrapContract(payload.contract);
  }, [fetchBootstrapPayload]);

  useEffect(() => {
    let cancelled = false;

    const bootWorkspace = async () => {
      const cachedSession = sessionCacheRef.current[normalizedActiveWorkspaceId];
      if (cachedSession) {
        setSessionStatus(cachedSession);
        setSessionError(null);
      }

      const cachedBootstrap = bootstrapCacheRef.current[normalizedActiveWorkspaceId];
      if (cachedBootstrap) {
        setResolvedUiModel(cachedBootstrap.ui);
        setBootstrapContract(cachedBootstrap.contract);
      }

      if (typeof onboardingCacheRef.current[normalizedActiveWorkspaceId] === "boolean") {
        setNeedsOnboarding(onboardingCacheRef.current[normalizedActiveWorkspaceId]!);
      }

      const token = await ensureSupabaseToken().catch(() => null);
      const [googleResult, bootstrapResult, brainResult] = await Promise.allSettled([
        fetchGoogleStatus(normalizedActiveWorkspaceId),
        fetchBootstrapPayload(),
        token
          ? fetch(
              `/api/v1/workspace-brain/?workspaceId=${encodeURIComponent(normalizedActiveWorkspaceId)}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
              },
            ).then((response) => (response.ok ? response.json() : null))
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      if (googleResult.status === "fulfilled") {
        setSessionStatus(googleResult.value);
        setSessionError(null);
        sessionCacheRef.current[normalizedActiveWorkspaceId] = googleResult.value;
      } else {
        if (!cachedSession) {
          setSessionStatus(null);
          setSessionError(
            googleResult.reason instanceof Error
              ? googleResult.reason.message
              : "Unable to load user status.",
          );
        }
      }

      if (bootstrapResult.status === "fulfilled" && bootstrapResult.value) {
        setResolvedUiModel(bootstrapResult.value.ui);
        setBootstrapContract(bootstrapResult.value.contract);
        bootstrapCacheRef.current[normalizedActiveWorkspaceId] = bootstrapResult.value;
      } else {
        if (!cachedBootstrap) {
          setResolvedUiModel(null);
          setBootstrapContract(null);
        }
      }

      if (brainResult.status === "fulfilled") {
        const payload = brainResult.value as { profile?: { purpose?: string } } | null;
        const purpose = typeof payload?.profile?.purpose === "string"
          ? payload.profile.purpose.trim()
          : "";
        const nextNeedsOnboarding = !purpose;
        onboardingCacheRef.current[normalizedActiveWorkspaceId] = nextNeedsOnboarding;
        setNeedsOnboarding(nextNeedsOnboarding);
      } else {
        if (typeof onboardingCacheRef.current[normalizedActiveWorkspaceId] !== "boolean") {
          setNeedsOnboarding(false);
        }
      }
    };

    void bootWorkspace();
    return () => {
      cancelled = true;
    };
  }, [fetchBootstrapPayload, normalizedActiveWorkspaceId]);

  useEffect(() => {
    const legacyFlag = searchParams.get("google_connected");
    if (!legacyFlag) return;
    void refreshSessionStatus();
    const next = new URLSearchParams(searchParams.toString());
    next.delete("google_connected");
    const nextQuery = next.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, refreshSessionStatus, router, searchParams]);

  const handleGoogleDisconnect = useCallback(async () => {
    try {
      await disconnectGoogle(normalizedActiveWorkspaceId);
      await refreshSessionStatus();
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Unable to disconnect Google."
      );
    }
  }, [normalizedActiveWorkspaceId, refreshSessionStatus]);

  const handleGoogleConnect = useCallback(() => {
    void startGoogleConnect(normalizedActiveWorkspaceId, "/os").catch((error) => {
      setSessionError(error instanceof Error ? error.message : "Unable to start Google connect.");
    });
  }, [normalizedActiveWorkspaceId]);

  useEffect(() => {
    const initialOpen = searchParams.get("orbPanel") === "open";
    if (urlSyncInitializedRef.current) return;
    urlSyncInitializedRef.current = true;
    if (initialOpen) openOrbMenu();
  }, [openOrbMenu, searchParams]);

  useEffect(() => {
    if (!urlSyncInitializedRef.current) return;
    const queryOpen = searchParams.get("orbPanel") === "open";
    if (queryOpen === state.overlayOpen) return;
    const next = new URLSearchParams(searchParams.toString());
    if (state.overlayOpen) { next.set("orbPanel", "open"); } else { next.delete("orbPanel"); }
    const nextQuery = next.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, state.overlayOpen]);

  useEffect(() => {
    const rightInset = elyPanelVisible ? dockWidth : 40;
    setWorkspaceViewportRightInset(rightInset);
    return () => setWorkspaceViewportRightInset(40);
  }, [elyPanelVisible, dockWidth]);

  useEffect(() => {
    setWorkspaceViewportBottomInset(INTENT_LINE_ZONE_PX);
    return () => setWorkspaceViewportBottomInset(0);
  }, []);

  useEffect(() => {
    return eventBus.on("orb:state", (data) => {
      setOrbActivityState(data.state);
    });
  }, []);

  useEffect(() => {
    return eventBus.on("overlay:close-all", () => {
      closeAllOverlays();
    });
  }, [closeAllOverlays]);

  useEffect(() => {
    if (!appLauncherOpen || !state.overlayOpen) return;
    setOverlayOpen(false);
  }, [appLauncherOpen, setOverlayOpen, state.overlayOpen]);

  useEffect(() => {
    if (state.overlayOpen) {
      addLayer("orb");
    } else {
      removeLayer("orb");
    }
  }, [state.overlayOpen, addLayer, removeLayer]);

  useEffect(() => {
    if (appLauncherOpen) {
      addLayer("apps");
      setIdentityMenuOpen(false);
    } else {
      removeLayer("apps");
    }
  }, [appLauncherOpen, addLayer, removeLayer]);

  useEffect(() => {
    if (identityMenuOpen) {
      addLayer("identityMenu");
    } else {
      removeLayer("identityMenu");
    }
  }, [identityMenuOpen, addLayer, removeLayer]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isTypingTarget(event.target)) return;
      if (layersRef.current.length === 0) return;
      closeTopLayer();
      event.preventDefault();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeTopLayer]);

  useEffect(() => {
    document.documentElement.setAttribute("data-elyra-workspace", normalizedActiveWorkspaceId);
    return () => {
      if (document.documentElement.getAttribute("data-elyra-workspace") === normalizedActiveWorkspaceId) {
        document.documentElement.removeAttribute("data-elyra-workspace");
      }
    };
  }, [normalizedActiveWorkspaceId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const hasMeta = event.metaKey || event.ctrlKey;

      // ⌘/ — focus IntentLine
      if (hasMeta && event.key === "/") {
        event.preventDefault();
        intentLineRef.current?.focus();
        return;
      }

      // ⌘? — open shortcut reference
      if (hasMeta && event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // ⌘J — toggle chat panel in AI dock
      if (hasMeta && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setToggleChatSignal((value) => value + 1);
        return;
      }

      // ⌘K — focus actions panel in AI dock
      if (hasMeta && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFocusActionsSignal((value) => value + 1);
        return;
      }

      // ⌘⇧K — App launcher
      if (hasMeta && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleAppLauncher();
        return;
      }

      // ⌘Space — Orb menu
      if (hasMeta && (event.code === "Space" || event.key === " ")) {
        event.preventDefault();
        if (state.overlayOpen) { closeOrbMenu(); } else { openOrbMenu(); }
        return;
      }

      if (hasMeta && event.key === ",") {
        event.preventDefault();
        openSettings("profile");
        return;
      }

      if (hasMeta && event.key.toLowerCase() === "w" && topWindow) {
        event.preventDefault();
        closeWindow(topWindow.id);
        return;
      }

      // ⌘Tab — cycle windows
      if (hasMeta && event.key === "Tab") {
        event.preventDefault();
        cycleWindows(event.shiftKey);
        return;
      }

      const appShortcut = APP_SHORTCUTS.find((item) => hasMeta && event.key === item.key);
      if (appShortcut) {
        event.preventDefault();
        handleOpenApp(appShortcut.appId);
        return;
      }

      if (!hasMeta && isTypingTarget(event.target)) return;
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    closeOrbMenu,
    closeWindow,
    cycleWindows,
    handleOpenApp,
    openOrbMenu,
    openSettings,
    state.overlayOpen,
    toggleAppLauncher,
    topWindow,
  ]);

  const onOpenArtifact = useCallback(
    (artifactId: string, artifactType: string) => {
      if (artifactType === "slides" || artifactType === "slides_deck_link") {
        handleOpenApp("slides");
      } else {
        handleOpenApp("files");
      }
      eventBus.emit("artifact:open", { artifactId, type: artifactType });
    },
    [handleOpenApp],
  );

  // ── Derived visuals ───────────────────────────────────────────────────────
  const kernelOrbState = state.orbState ?? "idle";
  const orbQuickActions = useMemo(() => {
    return resolvedUiModel?.orb_quick_actions ?? ([] as ResolvedQuickAction[]);
  }, [resolvedUiModel]);

  const orbQuickActionBindings = useMemo(
    () =>
      orbQuickActions.map((action) => {
        const toolFamily = action.tool_ref.split(".")[0] ?? "";
        const fallbackByLabel = action.label.toLowerCase();
        let openAppId: AppId | null = QUICK_ACTION_TO_APP[toolFamily] ?? null;
        if (!openAppId) {
          if (fallbackByLabel.includes("mail")) openAppId = "mail";
          else if (fallbackByLabel.includes("calendar")) openAppId = "calendar";
          else if (fallbackByLabel.includes("task")) openAppId = "tasks";
          else if (fallbackByLabel.includes("file") || fallbackByLabel.includes("drive")) openAppId = "files";
          else if (fallbackByLabel.includes("slide")) openAppId = "slides";
        }
        return {
          ...action,
          open_app_id: openAppId,
        };
      }),
    [orbQuickActions],
  );

  const orbVisualState: OrbMountState = (() => {
    if (state.overlayOpen) return "active";
    if (orbActivityState === "error" || orbActivityState === "degraded" || kernelOrbState === "degraded") {
      return "error";
    }
    if (orbActivityState === "success" || kernelOrbState === "success") return "success";
    if (orbActivityState === "waiting_for_auth" || orbActivityState === "waiting_for_approval") return "warning";
    if (
      orbActivityState === "thinking" ||
      orbActivityState === "executing" ||
      orbActivityState === "planning" ||
      orbActivityState === "listening" ||
      kernelOrbState === "planning" ||
      kernelOrbState === "listening" ||
      kernelOrbState === "executing"
    ) {
      return "thinking";
    }
    if (orbActivityState === "attention" || kernelOrbState === "attention") return "active";
    if (orbHover) return "hover";
    return "idle";
  })();
  const membershipRole = whoami?.membership?.role?.toLowerCase() ?? null;
  const platformAdminIds = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_PLATFORM_ADMIN_USER_IDS ?? "";
    return raw
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }, []);
  const isPlatformAdmin = Boolean(
    whoami?.user?.id && platformAdminIds.includes(whoami.user.id),
  );
  const workspaceRoleLabel = membershipRole
    ? membershipRole.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : "Member";
  const canAccessWorkspaceSettings =
    activeWorkspace.kind === "organization" ||
    activeWorkspace.kind === "platform" ||
    membershipRole === "owner" ||
    membershipRole === "manager";
  const canAccessMembers =
    membershipRole === "owner" ||
    membershipRole === "manager";
  const showPlatformAdmin = isPlatformAdmin && activeWorkspace.kind === "platform";
  const userDisplayName =
    whoami?.user?.email?.split("@")[0]?.replace(/[^\w]/g, "") || "Paul";
  const userEmail = whoami?.user?.email ?? sessionStatus?.user.email ?? "";
  const userInitials = buildUserInitials(whoami?.user?.email ?? null);
  const workspaceKindBadge = workspaceKindLabel(activeWorkspace.kind);
  const workspaceAccent = activeWorkspace.accent;
  const googleConnectionState = sessionStatus?.google.connectionState ?? "disconnected";
  const googleNeedsReauth =
    sessionStatus?.google.needsReauth === true || googleConnectionState === "needs_scope";
  const googleConnected = googleConnectionState === "connected";
  const googleConfigReady = sessionStatus?.google.config.ready ?? true;
  const googleStatusLabel = googleConfigReady
    ? googleNeedsReauth
      ? "Google Needs Reconnect"
      : googleConnectionState === "connected"
      ? "Google Connected"
      : googleConnectionState === "needs_auth"
          ? "Google Needs Auth"
          : "Google Disconnected"
    : "Google Config Missing";
  const googleError = searchParams.get("google_error");
  const edgeRailBadgesByApp = useMemo<Partial<Record<AppId, Array<"run" | "approval" | "error" | "auth">>>>(() => {
    const result: Partial<Record<AppId, Array<"run" | "approval" | "error" | "auth">>> = {};
    const openAppIds = new Set(activeWindows.map((window) => window.appId));
    const approvalPending = activeIntentState.steps.some(
      (step) => step.requiresConfirmation && step.status === "approval_required",
    );
    const runActive = activeIntentState.status === "running" || activeIntentState.status === "thinking";
    const runError = activeIntentState.status === "failed" || sessionError !== null;
    const authRequired = !googleConnected;
    const googleApps: AppId[] = ["mail", "calendar", "files", "slides"];

    openAppIds.forEach((appId) => {
      const badges: Array<"run" | "approval" | "error" | "auth"> = [];
      if (runActive) badges.push("run");
      if (approvalPending) badges.push("approval");
      if (runError) badges.push("error");
      if (authRequired && googleApps.includes(appId)) badges.push("auth");
      if (badges.length > 0) result[appId] = badges;
    });

    return result;
  }, [activeIntentState.status, activeIntentState.steps, activeWindows, googleConnected, sessionError]);

  const workspaceThemeStyle = useMemo(
    () =>
      ({
        background: "var(--os-bg-gradient)",
        "--os-workspace-accent": workspaceAccent,
        "--os-accent-color": workspaceAccent,
        "--os-accent-gradient": `linear-gradient(135deg, color-mix(in srgb, ${workspaceAccent} 88%, #ffffff 12%) 0%, color-mix(in srgb, ${workspaceAccent} 74%, #0b1222) 100%)`,
        "--os-accent-glow": withAlpha(workspaceAccent, 0.34),
        "--border-focus": withAlpha(workspaceAccent, 0.38),
        "--bg-surface-active": withAlpha(workspaceAccent, 0.2),
      }) as CSSProperties,
    [workspaceAccent],
  );

  const dockSurface: AIDockSurfaceId = useMemo(() => {
    if (topWindow) return mapWindowToSurface(topWindow.appId);
    return mapDesktopSurfaceToDock(desktopSurface);
  }, [desktopSurface, topWindow]);

  const dockContext: AIDockContext = useMemo(
    () => ({
      projectId: null,
      artifactId: activeArtifacts[0]?.id ?? null,
      runId: activeIntentState.runId ?? activeIntentState.foundationRunId ?? null,
      threadId: null,
    }),
    [activeArtifacts, activeIntentState.foundationRunId, activeIntentState.runId],
  );

  const headerHorizon = useMemo(
    () =>
      `linear-gradient(90deg, transparent 0%, ${withAlpha(workspaceAccent, 0.05)} 22%, ${withAlpha(workspaceAccent, 0.05)} 78%, transparent 100%)`,
    [workspaceAccent],
  );

  return (
    <div
      data-testid="os-shell-ready"
      className="elyra-os-theme relative h-screen min-h-screen overflow-hidden text-[color:var(--text-primary)]"
      style={workspaceThemeStyle}
    >
      <OrbMount accent={activeWorkspace.accent} state={orbVisualState} runtimeState={orbActivityState as import("@/components/os/windowing/windowTypes").OrbRuntimeState} />

      {/* ── Header ── */}
      <header
        className="fixed inset-x-0 top-0 flex h-14 items-center justify-between border-b border-[color:var(--os-border-soft)] px-6 transition-[border-color,background-color] duration-500"
        style={{ zIndex: SHELL_LAYERS.header, background: "color-mix(in srgb, var(--bg-elevated) 86%, transparent)" }}
      >
        <div className="flex items-center gap-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-secondary)]">ELYRA CORE</p>
          <div className="flex items-center gap-1.5">
            {WORKSPACES.map((workspace) => {
              const isActive = workspace.id === activeWorkspace.id;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => !isActive && setActiveWorkspace(workspace.id)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] transition-all duration-200 ${
                    isActive
                      ? "text-[color:var(--text-primary)]"
                      : "border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-secondary)]"
                  }`}
                  style={isActive
                    ? {
                        borderColor: `${workspace.accent}66`,
                        background: `${workspace.accent}22`,
                      }
                    : undefined}
                >
                  {workspace.label}
                </button>
              );
            })}
            <span className="ml-1 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              {workspaceKindBadge}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {googleConnected && !googleNeedsReauth ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-500/12 px-2.5 py-1 text-[11px] text-emerald-100">
              <CheckCircle2 size={12} />
              {googleStatusLabel}
            </span>
          ) : googleNeedsReauth ? (
            <button
              type="button"
              onClick={handleGoogleConnect}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-500/12 px-2.5 py-1 text-[11px] text-amber-100 transition hover:bg-amber-500/20"
            >
              Re-connect Google
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGoogleConnect}
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-[11px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)]"
            >
              <XCircle size={12} />
              {googleStatusLabel}
            </button>
          )}

          {/* Apps button (replaces ⌘K badge) */}
          <button
            type="button"
            onClick={toggleAppLauncher}
            aria-label="Toggle system launcher"
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-[11px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]"
          >
            <LayoutGrid size={13} />
            Apps
          </button>
          {activeWindows.length >= 2 ? (
            <button
              type="button"
              onClick={splitWindows}
              aria-label="Split windows side by side"
              title="Split windows side by side"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-[11px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]"
            >
              <Columns2 size={13} />
              Split
            </button>
          ) : null}
          <button
            type="button"
            ref={identityButtonRef}
            onClick={toggleIdentityMenu}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]"
            style={{
              background: identityMenuOpen ? "var(--bg-surface-active)" : "var(--bg-surface)",
              borderColor: identityMenuOpen ? "var(--border-focus)" : "var(--os-border-soft)",
            }}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--bg-surface-soft)] text-[11px] font-semibold text-[color:var(--text-primary)]">
              {userInitials}
            </span>
            <span className="hidden max-w-[120px] truncate text-[11px] text-[color:var(--text-secondary)] sm:inline">
              {userEmail}
            </span>
          </button>
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{ background: headerHorizon, transition: "background 500ms ease" }}
        />
      </header>
      <IdentityMenu
        open={identityMenuOpen}
        userName={userDisplayName}
        userEmail={userEmail}
        workspaceLabel={activeWorkspace.label}
        workspaceRoleLabel={workspaceRoleLabel}
        canAccessWorkspaceSettings={canAccessWorkspaceSettings}
        canAccessMembers={canAccessMembers}
        showPlatformAdmin={showPlatformAdmin}
        onClose={closeIdentityMenu}
        onLogout={handleLogout}
        activeWorkspaceId={activeWorkspace.id}
        onSwitchWorkspace={(id) => setActiveWorkspace(id)}
      />

      {/* ── Canvas ── */}
      <div
        className="absolute inset-x-0 top-14"
        style={{
          zIndex: SHELL_LAYERS.canvas,
          paddingRight: elyPanelVisible ? `${dockWidth}px` : "0px",
          bottom: `${INTENT_LINE_ZONE_PX}px`,
        }}
      >
        {/* Window layer — fills the full left canvas area */}
        <div className="relative h-full overflow-hidden">
          {isRoutedApp && routedAppId ? (
            /* Routed app — full-canvas view with minimal chrome bar (close button) */
            <div className="flex h-full flex-col">
              {/* Thin chrome strip: app title + close */}
              {(() => {
                const routedWin = activeWindows.find((w) => w.appId === routedAppId);
                const appLabel = ROUTED_APP_LABELS[routedAppId] ?? String(routedAppId);
                return (
                  <div
                    className="flex h-10 shrink-0 items-center justify-between border-b px-4"
                    style={{
                      borderColor: "var(--os-border-soft)",
                      background: "color-mix(in srgb, var(--bg-elevated) 60%, transparent)",
                    }}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--text-secondary)]">
                      {appLabel}
                    </span>
                    {routedWin ? (
                      <div className="flex items-center gap-1">
                        {/* Minimize — go to desktop, keep app alive */}
                        <button
                          type="button"
                          onClick={() => router.replace(`/os?workspaceId=${encodeURIComponent(normalizedActiveWorkspaceId)}`, { scroll: false })}
                          aria-label={`Minimize ${appLabel}`}
                          title="Minimize — go to desktop"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[color:var(--text-primary)]"
                        >
                          <Minus size={14} />
                        </button>
                        {/* Close — shut down app entirely */}
                        <button
                          type="button"
                          onClick={() => closeWindow(routedWin.id)}
                          aria-label={`Close ${appLabel}`}
                          title="Close"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--text-muted)] transition-colors hover:bg-white/10 hover:text-red-400"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
              {/* App content */}
              <div className="min-h-0 flex-1">
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading…</div>}>
                  {children}
                </Suspense>
              </div>
            </div>
          ) : (
            <>
              {/* Desktop surface (shown when no windows cover it) */}
              <div className="h-full px-6 pt-4" style={{ paddingBottom: `${INTENT_LINE_CONTENT_PAD_PX}px` }}>
                <DesktopSurface
                  accent={activeWorkspace.accent}
                  workspaceLabel={activeWorkspace.label}
                  workspaceId={activeWorkspace.id}
                  workspaceRole={membershipRole}
                  dashboardWidgetAppIds={resolvedUiModel?.dashboard_widgets.map((app) => app.app_id) ?? []}
                  visibleSurfaces={resolvedUiModel?.visible_surfaces ?? ["dashboard"]}
                  appsSurfaceApps={resolvedUiModel?.apps_surface_apps ?? []}
                  installedApps={bootstrapContract?.installed_apps ?? []}
                  orbQuickActions={orbQuickActions}
                  toolRegistry={bootstrapContract?.tool_registry ?? ([] as ToolRegistryItem[])}
                  workspaceCapabilities={bootstrapContract?.workspace_capabilities ?? null}
                  integrationStatus={bootstrapContract?.integration_status ?? []}
                  messages={activeMessages}
                  artifacts={activeArtifacts}
                  activeIntentState={activeIntentState}
                  onOpenApp={handleOpenApp}
                  onOpenAssistant={() => {
                    openOrbMenu();
                    focusIntentLine();
                  }}
                  onExecuteQuickAction={executeQuickAction}
                  onOpenGoals={() => {
                    handleOpenApp("tasks");
                  }}
                  onOpenSettings={() => openSettings("ai")}
                  onOpenRun={(runId) => {
                    router.push(`/os/code?workspaceId=${encodeURIComponent(normalizedActiveWorkspaceId)}&openRunId=${encodeURIComponent(runId)}`);
                  }}
                  onConfirmStep={confirmActiveIntentStep}
                  onDenyStep={denyActiveIntentStep}
                  onSurfaceChange={setDesktopSurface}
                  onConnectGoogle={handleGoogleConnect}
                  onDisconnectGoogle={handleGoogleDisconnect}
                  onSignOut={handleLogout}
                />
              </div>

              {/* Window chrome layer — utility/floating windows only (routed apps have their own page) */}
              <AnimatePresence>
                {activeWindows
                  .filter((w) => !w.minimized && !ROUTED_APP_PATHS[w.appId])
                  .map((w) => (
                    <WindowChrome
                      key={w.id}
                      window={w}
                      focused={topWindow?.id === w.id}
                      accent={activeWorkspace.accent}
                      onFocus={focusWindow}
                      onClose={closeWindow}
                      onMinimize={minimizeWindow}
                      onToggleMaximize={toggleWindowMaximized}
                      onMove={moveWindow}
                      onResize={resizeWindow}
                    >
                      {renderAppWindow(w.appId, w.id, activeWorkspace.id, activeWorkspace.accent)}
                    </WindowChrome>
                  ))}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>

      {/* ── ElyPanel ── */}
      <AgentConsoleRail
        intentState={activeIntentState}
        messages={activeMessages}
        artifacts={activeArtifacts}
        accent={activeWorkspace.accent}
        workspaceLabel={activeWorkspace.label}
        workspaceId={activeWorkspace.id}
        workspaceKind={activeWorkspace.kind}
        activeSurface={dockSurface}
        activeContext={dockContext}
        quickActions={orbQuickActionBindings}
        onExecuteQuickAction={executeQuickAction}
        toggleChatSignal={toggleChatSignal}
        focusActionsSignal={focusActionsSignal}
        userEmail={whoami?.user?.email ?? sessionStatus?.user.email ?? null}
        userAvatarUrl={sessionStatus?.user.avatarUrl ?? null}
        userInitials={whoami?.user?.email ? buildUserInitials(whoami.user.email) : (sessionStatus?.user.initials ?? "EC")}
        onConfirmStep={confirmActiveIntentStep}
        onDenyStep={denyActiveIntentStep}
        onOpenArtifact={onOpenArtifact}
        onCancel={cancelActiveIntent}
        onRetry={retryActiveIntent}
        onClear={clearActiveIntent}
        onWidthChange={setDockWidth}
      />

      {/* ── App Launcher Overlay (⌘K / Apps button) ── */}
      <AppLauncherOverlay
        open={appLauncherOpen}
        accent={activeWorkspace.accent}
        role={membershipRole}
        workspaceId={activeWorkspace.id}
        manifests={bootstrapContract?.app_manifest ?? []}
        installedApps={bootstrapContract?.installed_apps ?? []}
        toolRegistry={bootstrapContract?.tool_registry ?? []}
        integrationStatus={bootstrapContract?.integration_status ?? []}
        googleConnectionState={
          googleConnectionState === "connected" || googleConnectionState === "needs_auth" || googleConnectionState === "needs_scope"
            ? googleConnectionState
            : "disconnected"
        }
        openAppIds={activeWindows.map((w) => w.appId)}
        onOpenApp={(appId) => { handleOpenApp(appId); closeAppLauncher(); }}
        onFocusIntent={focusIntentLine}
        onClose={closeAppLauncher}
        onAppsChanged={loadBootstrap}
      />

      {/* ── Orb Area (⌘Space / Orb click) ── */}
      <OrbArea
        orbState={orbVisualState}
        panelOpen={state.overlayOpen}
        onTogglePanel={() => setOverlayOpen(!state.overlayOpen)}
        onFocusIntent={focusIntentLine}
        onOpenApp={handleOpenApp}
        onExecuteQuickAction={executeQuickAction}
        quickActions={orbQuickActionBindings}
        workspaceId={activeWorkspace.id}
        accent={activeWorkspace.accent}
        onHoverChange={setOrbHover}
      />

      {/* ── WindowDock (auto-hide left edge) ── */}
      <WindowDock
        workspaceId={activeWorkspace.id}
        windows={activeWindows}
        badgeByAppId={edgeRailBadgesByApp}
        focusedWindowId={topWindow?.id ?? null}
        accent={activeWorkspace.accent}
        onFocusWindow={focusWindow}
        onCloseWindow={closeWindow}
      />

      {/* ── Settings View ── */}
      <SettingsView
        open={settingsOpen}
        role={activeRole}
        section={settingsSection ?? "profile"}
        workspaceId={activeWorkspace.id}
        workspaceLabel={activeWorkspace.label}
        workspaceKind={activeWorkspace.kind}
        onSelectSection={openSettings}
        onClose={closeSettings}
        userName={userDisplayName}
        userEmail={userEmail}
        workspaceRoleLabel={workspaceRoleLabel}
        googleStatus={sessionStatus}
        onGoogleDisconnect={handleGoogleDisconnect}
      />

      {/* ── IntentLine ── */}
      <IntentLine
        ref={intentLineRef}
        onSubmit={handleIntentLineSubmit}
        onClear={clearActiveIntent}
        accent={activeWorkspace.accent}
        busy={state.thinking}
        rightInset={elyPanelVisible ? dockWidth : 0}
      />

      {needsOnboarding ? (
        <WorkspaceOnboardingWizard
          workspaceId={activeWorkspace.id}
          workspaceKind={activeWorkspace.kind}
          workspaceName={activeWorkspace.label}
          accent={activeWorkspace.accent}
          onComplete={() => setNeedsOnboarding(false)}
        />
      ) : null}

      {/* ── Keyboard shortcuts modal ── */}
      {shortcutsOpen ? (
        <div
          className="fixed inset-0 grid place-items-center bg-black/20 px-4"
          style={{ zIndex: SHELL_LAYERS.modal }}
          {...{ [SHELL_LAYER_DATA_ATTR]: "modal" }}
        >
          <section className="w-full max-w-[560px] rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/95 p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">Keyboard Shortcuts</h2>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="h-8 w-8 rounded-full border border-[color:var(--os-border-soft)] text-sm text-[color:var(--text-secondary)]"
                aria-label="Close shortcuts"
              >
                ×
              </button>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-[color:var(--text-secondary)]">
              <li>⌘K — Focus AI Actions panel</li>
              <li>⌘J — Toggle Chat panel</li>
              <li>⌘⇧K — App Launcher</li>
              <li>⌘Space — Orb Panel</li>
              <li>⌘/ — Focus IntentLine</li>
              <li>⌘, — Open Settings</li>
              <li>⌘? — Show this shortcuts card</li>
              <li>⌘1…6 — Mail / Calendar / Tasks / Files / Builder / Slides</li>
              <li>⌘W — Close top window</li>
              <li>⌘Tab — Next window · ⌘Shift+Tab — Previous window</li>
              <li>Esc — Close overlay or settings</li>
            </ul>
          </section>
        </div>
      ) : null}

      {/* ── Plan Mode Overlay ── */}
      {state.orbState === "planning" && activeIntentState.kind === "mutation" && activeIntentState.steps.length > 0 && (
        <PlanModeOverlay
          intentState={activeIntentState}
          onConfirmAll={() => {
            activeIntentState.steps.forEach((step) => {
              if (step.status === "approval_required") {
                confirmActiveIntentStep();
              }
            });
          }}
          onDeny={() => {
            denyActiveIntentStep();
          }}
          onClose={() => {
            clearActiveIntent();
          }}
        />
      )}

      {/* ── Error toasts ── */}
      {googleError || sessionError ? (
        <div
          className="pointer-events-none fixed right-4 top-16 rounded-lg border border-rose-300/35 bg-rose-500/15 px-3 py-2 text-xs text-rose-100"
          style={{ zIndex: SHELL_LAYERS.modal }}
        >
          {googleError ?? sessionError}
        </div>
      ) : null}
    </div>
  );
}

export default function WorkspaceOS({ whoami, children }: { whoami: WhoamiResponse | null; children?: ReactNode }) {
  return (
    <KernelProvider>
      {/* LocaleProvider mounts here so all OS-shell routes (including /os/code) have
          access to useLocale(). It uses useWorkspaceDataOptional() and falls back to
          browser locale when WorkspaceProvider is not in the tree. */}
      <LocaleProvider>
        <WorkspaceOSInner whoami={whoami}>{children}</WorkspaceOSInner>
      </LocaleProvider>
    </KernelProvider>
  );
}
