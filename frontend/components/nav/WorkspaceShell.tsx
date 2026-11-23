"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppWindow,
  Briefcase,
  ChevronDown,
  LayoutGrid,
  Settings,
  ShoppingBag,
  TerminalSquare,
  UserCircle2,
} from "lucide-react";
import { WorkspaceProvider, useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ElliProvider } from "@/components/providers/ElliProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
// primitives no longer needed — replaced with Tailwind
import { applyWorkspacePolicy } from "@/lib/workspace/workspacePolicy";
import { buildWorkspaceStorageKey } from "@/lib/workspace/workspaceAccessMap";
import {
  canAccessSystemPlatform,
  classifyWorkspaceScope,
  normalizeAppRole,
  roleLabel,
  scopeLabel,
  workspaceNameLabel,
  workspaceTypeLabel,
} from "@/lib/workspace/workspaceModel";
import { resolveWorkspaceRuntime } from "@/lib/workspace/runtime";
import IntentLine from "@/components/intent/IntentLine";
import OrchestratorPanel, { type OrchestratorStep } from "@/components/orchestrator/OrchestratorPanel";
import { Orb } from "@/components/Orb";
import type { CodeTaskContract } from "@/types/taskContract";
import { isCodeIntent, mapChiefCodeSteps, type ChiefCodePhase } from "@/lib/orb-os/orchestrator/chiefCode";

type WorkspaceShellProps = {
  children: React.ReactNode;
};

const BASE_DOCK_ITEMS = [
  { id: "desktop", label: "Desktop", icon: LayoutGrid, route: "" },
  { id: "agent", label: "Agent", icon: UserCircle2, route: "agent" },
  { id: "work", label: "Work", icon: Briefcase, route: "work" },
  { id: "build", label: "Build", icon: TerminalSquare, route: "build" },
  { id: "marketplace", label: "Marketplace", icon: ShoppingBag, route: "marketplace" },
  { id: "settings", label: "Settings", icon: Settings, route: "settings" },
] as const;

type DockItem = (typeof BASE_DOCK_ITEMS)[number];

function getDockItemsForWorkspace(type: "personal" | "team" | "system"): readonly DockItem[] {
  if (type === "personal") {
    return BASE_DOCK_ITEMS.filter((item) => item.id !== "marketplace");
  }
  if (type === "team") {
    return BASE_DOCK_ITEMS;
  }
  return BASE_DOCK_ITEMS;
}

const QUICK_ROUTE_LABELS: Record<string, string> = {
  mail: "Mail",
  calendar: "Calendar",
  planner: "Tasks",
  docs: "Docs",
  build: "Build",
  marketplace: "Integrations",
  settings: "Settings",
};

const routeCommandMap: Record<string, string> = {
  "/mail": "mail",
  "/calendar": "calendar",
  "/schedule": "calendar",
  "/inbox": "mail",
  "/tasks": "planner",
  "/build": "build",
  "/marketplace": "marketplace",
};

const quickPlanTemplate: OrchestratorStep[] = [
  { id: "u1", kind: "context", title: "Understand current context", status: "done", detail: "Workspace, intent and active view mapped" },
  { id: "p1", kind: "email", title: "Draft suggested response", status: "needs-confirm", detail: "Editable before external send" },
  { id: "r1", kind: "task", title: "Create follow-up task", status: "ready", detail: "Attach owner and due date" },
];

type ChiefCodePlanResponse = {
  ok: boolean;
  runId?: string;
  phase?: "plan" | "execute";
  summary?: string;
  error?: string;
  contract?: CodeTaskContract;
  executor?: { label?: string; dispatchPath?: string };
  artifact?: {
    summary?: string;
    executionApplied?: boolean;
    buildReport?: { success?: boolean };
  };
};

const read = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function openCodeRun(runId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("elyra_pending_code_run_id", runId);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("elyra:open-code-run", { detail: { runId } }));
}

function detectDockId(pathname: string): DockItem["id"] {
  const section = pathname.split("/").filter(Boolean)[2] ?? "";
  if (!section) return "desktop";
  if (["agent"].includes(section)) return "agent";
  if (["work", "mail", "calendar", "docs", "planner", "tasks"].includes(section)) return "work";
  if (["build"].includes(section)) return "build";
  if (["marketplace", "integrations"].includes(section)) return "marketplace";
  if (["settings"].includes(section)) return "settings";
  return "desktop";
}

export default function WorkspaceShell({ children }: WorkspaceShellProps) {
  const pathname = usePathname();
  const workspaceSlug = useMemo(() => {
    if (!pathname) return "active";
    const match = pathname.match(/^\/w\/([^/]+)/);
    return match?.[1] ?? "active";
  }, [pathname]);

  return (
    <AuthProvider>
      <WorkspaceProvider key={workspaceSlug}>
        <ElliProvider key={workspaceSlug}>
          <LocaleProvider>
            <WorkspaceShellContent>{children}</WorkspaceShellContent>
          </LocaleProvider>
        </ElliProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}

function WorkspaceShellContent({ children }: WorkspaceShellProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const {
    data,
    loading,
    authState,
    authRequiredFromWhoami,
    loginUrl,
    setActiveWorkspace,
    setResolvedActiveWorkspaceId,
    sendAssistantChatMessage,
  } = useWorkspaceData();

  const [intent, setIntent] = useState("");
  const [isInspectorOpen, setInspectorOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [orchTab, setOrchTab] = useState<"Understand" | "Plan" | "Run">("Understand");
  const [steps, setSteps] = useState<OrchestratorStep[]>(quickPlanTemplate);
  const [orbState, setOrbState] = useState<"idle" | "thinking" | "planning" | "executing" | "error">("idle");
  const [chiefCodePhase, setChiefCodePhase] = useState<ChiefCodePhase>("idle");
  const [chiefCodeContract, setChiefCodeContract] = useState<CodeTaskContract | null>(null);
  const [chiefCodeRunId, setChiefCodeRunId] = useState<string | null>(null);
  const [chiefCodeSummary, setChiefCodeSummary] = useState<string | null>(null);
  const [chiefCodeError, setChiefCodeError] = useState<string | null>(null);
  const [chiefCodeExecutorLabel, setChiefCodeExecutorLabel] = useState<string | null>(null);

  const workspaces = data?.workspaces ?? [];
  const activeWorkspace = data?.activeWorkspace ?? null;
  const identityStorageKey = useMemo(
    () => buildWorkspaceStorageKey({ id: data?.user?.id ?? null, email: data?.user?.email ?? null }),
    [data?.user?.id, data?.user?.email]
  );
  const [storedWorkspaceId, setStoredWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !identityStorageKey) return;
    setStoredWorkspaceId(window.localStorage.getItem(identityStorageKey));
  }, [identityStorageKey]);

  const workspacePolicy = useMemo(
    () =>
      applyWorkspacePolicy({
        identityEmail: data?.user?.email ?? null,
        workspaces,
        activeWorkspaceId: activeWorkspace?.id ?? null,
        storedWorkspaceId,
      }),
    [data?.user?.email, workspaces, activeWorkspace?.id, storedWorkspaceId]
  );

  const resolvedActiveWorkspace = workspacePolicy.activeWorkspace;

  useEffect(() => {
    setResolvedActiveWorkspaceId(resolvedActiveWorkspace?.id ?? null);
  }, [resolvedActiveWorkspace?.id, setResolvedActiveWorkspaceId]);

  useEffect(() => {
    if (typeof window === "undefined" || !identityStorageKey || !resolvedActiveWorkspace?.id) return;
    window.localStorage.setItem(identityStorageKey, resolvedActiveWorkspace.id);
  }, [identityStorageKey, resolvedActiveWorkspace?.id]);

  useEffect(() => {
    if (!workspacePolicy.shouldSwitchActiveWorkspace || !workspacePolicy.nextWorkspaceId) return;
    void setActiveWorkspace(workspacePolicy.nextWorkspaceId);
  }, [workspacePolicy.shouldSwitchActiveWorkspace, workspacePolicy.nextWorkspaceId, setActiveWorkspace]);

  useEffect(() => {
    if (!pathname.startsWith("/w/")) return;
    const routeSlug = pathname.split("/")[2] ?? "active";
    if (!routeSlug || routeSlug === "active") return;
    const target = workspaces.find((workspace) => workspace.slug === routeSlug);
    if (target && target.id !== resolvedActiveWorkspace?.id) {
      void setActiveWorkspace(target.id);
    }
  }, [pathname, workspaces, resolvedActiveWorkspace?.id, setActiveWorkspace]);

  useEffect(() => {
    if (loading) return;
    const needsAuth = authState === "unauthenticated" && authRequiredFromWhoami;
    if (needsAuth && (pathname.startsWith("/w") || pathname.startsWith("/system") || pathname.startsWith("/admin"))) {
      router.replace(loginUrl || "/signin");
    }
  }, [loading, authState, authRequiredFromWhoami, pathname, router, loginUrl]);

  const scope = classifyWorkspaceScope(resolvedActiveWorkspace, data?.user?.email);
  const role = normalizeAppRole(data?.membership?.role, data?.user?.email, scope);
  const runtime = resolveWorkspaceRuntime({
    workspaceType: resolvedActiveWorkspace?.type ?? null,
    membershipRole: data?.membership?.role ?? null,
    capabilities: data?.capabilities ?? [],
  });
  const canSystem = canAccessSystemPlatform(role);
  const roleDisplay = roleLabel(role);
  const workspaceKind = workspaceTypeLabel(resolvedActiveWorkspace, data?.user?.email);
  const workspaceName = workspaceNameLabel(resolvedActiveWorkspace, data?.user?.email);

  const routeSlug = pathname.startsWith("/w/") ? pathname.split("/")[2] ?? "active" : "active";
  const shellSlug = routeSlug || "active";
  const activeDockId = useMemo(() => detectDockId(pathname), [pathname]);
  const dockItems = useMemo(
    () => getDockItemsForWorkspace(runtime.workspaceType),
    [runtime.workspaceType]
  );
  const logoUrl = read(resolvedActiveWorkspace?.brand?.logoUrl);

  const callChiefCodeOrchestrator = useCallback(async (phase: "plan" | "execute", input: string, runId?: string | null) => {
    const workspaceId = resolvedActiveWorkspace?.id ?? "";
    const response = await fetch("/api/os/orchestrator/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        workspaceId,
        intent: input,
        task: input,
        repoUrl: "",
        branch: "main",
        folderPath: "",
        selectedFiles: [],
        stage: "playground",
        terminalAccess: true,
        useReasoning: false,
        executionMode: "adaptive",
        autoCommit: false,
        skill: "custom",
        phase,
        ...(runId ? { runId } : {}),
      }),
      cache: "no-store",
    });
    return (await response.json().catch(() => null)) as ChiefCodePlanResponse | null;
  }, [resolvedActiveWorkspace?.id]);

  const runChiefCodePlan = useCallback(async (input: string) => {
    setChiefCodeRunId(null);
    setChiefCodeContract(null);
    setChiefCodeExecutorLabel(null);
    setChiefCodeError(null);
    setChiefCodeSummary("Chief orchestrator is analyzing the request and building a coding contract.");
    setChiefCodePhase("planning");
    setOrchTab("Understand");
    setSteps(mapChiefCodeSteps({ contract: null, phase: "planning" }));

    const payload = await callChiefCodeOrchestrator("plan", input, null);
    if (!payload?.ok || !payload.contract) {
      const message = payload?.error || "Chief orchestrator plan failed.";
      setChiefCodePhase("failed");
      setChiefCodeError(message);
      setChiefCodeSummary(message);
      setSteps(mapChiefCodeSteps({ contract: null, phase: "failed", error: message }));
      setOrbState("error");
      setOrchTab("Run");
      return;
    }

    setChiefCodeRunId(payload.runId ?? null);
    setChiefCodeContract(payload.contract);
    setChiefCodeExecutorLabel(payload.executor?.label ?? "Coding Agent");
    setChiefCodePhase("plan_ready");
    setChiefCodeSummary(payload.summary ?? "Chief orchestrator contract created.");
    setSteps(
      mapChiefCodeSteps({
        contract: payload.contract,
        phase: "plan_ready",
        executorLabel: payload.executor?.label ?? "Coding Agent",
      }),
    );
    setOrchTab("Plan");
    setOrbState("planning");
  }, [callChiefCodeOrchestrator]);

  const runChiefCodeExecute = useCallback(async () => {
    const input = intent.trim();
    if (!input) return;
    setChiefCodeError(null);
    setChiefCodePhase("executing");
    setChiefCodeSummary("Chief orchestrator dispatched the contract to the coding agent.");
    setSteps(
      mapChiefCodeSteps({
        contract: chiefCodeContract,
        phase: "executing",
        executorLabel: chiefCodeExecutorLabel,
      }),
    );
    setOrchTab("Run");
    setOrbState("executing");

    const payload = await callChiefCodeOrchestrator("execute", input, chiefCodeRunId);
    if (!payload?.ok) {
      const message = payload?.error || "Chief orchestrator execution failed.";
      setChiefCodePhase("failed");
      setChiefCodeError(message);
      setChiefCodeSummary(message);
      setSteps(
        mapChiefCodeSteps({
          contract: chiefCodeContract,
          phase: "failed",
          executorLabel: chiefCodeExecutorLabel,
          error: message,
        }),
      );
      setOrbState("error");
      return;
    }

    if (payload.runId) {
      setChiefCodeRunId(payload.runId);
      openCodeRun(payload.runId);
    }
    const buildOk = payload.artifact?.buildReport?.success === true;
    const applied = payload.artifact?.executionApplied === true;
    const summary =
      payload.artifact?.summary ||
      `Coding agent completed the contract (${applied ? "changes applied" : "no changes applied"}, build ${buildOk ? "ok" : "failed"}).`;
    setChiefCodePhase("done");
    setChiefCodeSummary(summary);
    setSteps(
      mapChiefCodeSteps({
        contract: chiefCodeContract,
        phase: "done",
        executorLabel: chiefCodeExecutorLabel,
      }),
    );
    setOrbState("idle");
  }, [callChiefCodeOrchestrator, chiefCodeContract, chiefCodeExecutorLabel, intent]);

  const runIntent = () => {
    const input = intent.trim();
    if (!input) return;
    setInspectorOpen(true);
    setSpotlightOpen(false);
    setOrbState("thinking");
    setOrchTab("Understand");
    setChiefCodeError(null);

    const command = (input.split(" ")[0] ?? "").toLowerCase();
    const target = routeCommandMap[command];
    void sendAssistantChatMessage(input).catch((error) => {
      console.error("[workspace-shell] intent dispatch failed", error);
      setOrbState("error");
    });

    if (isCodeIntent(input)) {
      void runChiefCodePlan(input);
      return;
    }

    window.setTimeout(() => {
      setOrchTab("Plan");
      setOrbState("planning");
      setSteps(
        quickPlanTemplate.map((step) =>
          step.id === "p1" && (command === "/mail" || command === "/inbox")
            ? { ...step, status: "needs-confirm" }
            : step
        )
      );
    }, 180);

    window.setTimeout(() => {
      setOrbState("executing");
      if (target) {
        router.push(`/w/${shellSlug}/${target}`);
      }
    }, 380);

    window.setTimeout(() => {
      setOrbState("idle");
      setOrchTab("Run");
    }, 700);
  };

  const jumpTo = (route: string) => {
    router.push(`/w/${shellSlug}/${route}`);
    setSpotlightOpen(false);
  };

  const openChiefCodeLogs = useCallback(() => {
    if (!chiefCodeRunId) return;
    openCodeRun(chiefCodeRunId);
    router.push(`/os/code?workspaceId=${encodeURIComponent(resolvedActiveWorkspace?.id ?? "")}&openRunId=${encodeURIComponent(chiefCodeRunId)}`);
  }, [chiefCodeRunId, resolvedActiveWorkspace?.id, router]);

  const quickRoutes = runtime.quickRoutes.map((route) => ({
    route,
    label: QUICK_ROUTE_LABELS[route] ?? route,
  }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSpotlightOpen((prev) => !prev);
        setInspectorOpen(true);
        window.setTimeout(() => {
          const input = document.getElementById("ec-intent-input") as HTMLInputElement | null;
          input?.focus();
        }, 20);
      }
      if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        const idx = Number(event.key) - 1;
        const item = dockItems[idx];
        if (!item) return;
        const base = `/w/${shellSlug}`;
        const href = item.route ? `${base}/${item.route}` : base;
        router.push(href);
      }
      if (event.key === "Escape") {
        setInspectorOpen(false);
        setProfileOpen(false);
        setWorkspaceSwitcherOpen(false);
        setSpotlightOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, shellSlug, dockItems]);

  if (loading) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center text-sm"
        style={{ background: "var(--bg-canvas, #050810)", color: "rgba(255,255,255,0.4)" }}
      >
        Loading workspace...
      </div>
    );
  }

  if (authState !== "authenticated") {
    return (
      <div
        className="flex min-h-dvh items-center justify-center p-8"
        style={{ background: "var(--bg-canvas, #050810)" }}
      >
        <div
          className="w-full max-w-sm rounded-2xl border p-6"
          style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}
        >
          <h1 className="text-xl font-semibold text-white">Sign in required</h1>
          <p className="mt-2 text-sm text-white/60">This workspace route needs an active session.</p>
          <button
            type="button"
            onClick={() => router.push(loginUrl || "/signin")}
            className="mt-5 flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-medium text-white transition hover:brightness-110"
            style={{ background: "var(--os-accent, #6C9CFC)" }}
          >
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh" data-orb-state={orbState} style={{ background: "var(--bg-canvas, #050810)" }}>

      {/* ─── TopBar ─────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-[88] flex h-12 items-center justify-between border-b border-white/8 px-4 backdrop-blur-2xl" style={{ background: "var(--os-panel-strong, rgba(9,13,26,0.88))" }}>

        {/* Brand */}
        <div className="flex items-center gap-2.5">
          {logoUrl ? (
            <span className="relative h-6 w-6 flex-shrink-0 overflow-hidden rounded-lg">
              <Image src={logoUrl} alt="Logo" fill sizes="24px" />
            </span>
          ) : (
            <span className="text-xs font-semibold tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.70)" }}>elyra core</span>
          )}
          <div className="hidden sm:block">
            <p className="text-xs font-medium leading-tight" style={{ color: "rgba(255,255,255,0.85)" }}>{workspaceName}</p>
            <p className="text-[10px] leading-tight" style={{ color: "rgba(255,255,255,0.38)" }}>{scopeLabel(scope)}</p>
          </div>
        </div>

        {/* Right side: badges + orb + workspace switcher + profile */}
        <div className="flex items-center gap-1.5">
          <span className="hidden rounded-full border px-2 py-0.5 text-[10px] sm:inline" style={{ borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }}>
            {workspaceKind}
          </span>
          {canSystem && (
            <span className="hidden rounded-full border px-2 py-0.5 text-[10px] sm:inline" style={{ borderColor: "rgba(245,158,11,0.25)", background: "rgba(245,158,11,0.08)", color: "rgba(253,230,138,0.9)" }}>
              {roleDisplay}
            </span>
          )}

          {/* Orb */}
          <button
            type="button"
            className="ec-orb-wrap ec-orb-wrap--live flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/8"
            aria-label="Open command spotlight"
            onClick={() => setSpotlightOpen((prev) => !prev)}
          >
            <Orb className="ec-orb" />
          </button>

          {/* Workspace switcher */}
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition hover:bg-white/8"
              style={{ borderColor: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)" }}
              onClick={() => setWorkspaceSwitcherOpen((prev) => !prev)}
              aria-expanded={workspaceSwitcherOpen}
            >
              <AppWindow size={12} />
              <span className="hidden sm:inline">Workspace</span>
              <ChevronDown size={11} />
            </button>
            {workspaceSwitcherOpen ? (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setWorkspaceSwitcherOpen(false)} />
                <div
                  className="absolute right-0 top-full z-[91] mt-2 min-w-[220px] overflow-hidden rounded-2xl border shadow-2xl"
                  style={{ background: "rgba(13,20,32,0.94)", backdropFilter: "blur(24px)", borderColor: "rgba(255,255,255,0.1)" }}
                >
                  <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>Switch Workspace</p>
                  </div>
                  <div className="p-2">
                    {workspacePolicy.visibleWorkspaces.map((workspace) => {
                      const isCurrent = workspace.id === resolvedActiveWorkspace?.id;
                      return (
                        <button
                          key={workspace.id}
                          type="button"
                          onClick={() => { setWorkspaceSwitcherOpen(false); void setActiveWorkspace(workspace.id); }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/8"
                          style={{ color: isCurrent ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                        >
                          <span>{workspace.name || workspace.slug}</span>
                          {isCurrent && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "rgba(92,255,236,0.15)", color: "#5cffec" }}>
                              active
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Profile */}
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition hover:bg-white/8"
              style={{ borderColor: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)" }}
              onClick={() => setProfileOpen((prev) => !prev)}
            >
              <UserCircle2 size={14} />
              <span className="hidden max-w-[110px] truncate sm:inline">
                {data?.user?.email?.split("@")[0] ?? "profile"}
              </span>
            </button>
            {profileOpen ? (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setProfileOpen(false)} />
                <div
                  className="absolute right-0 top-full z-[91] mt-2 min-w-[220px] overflow-hidden rounded-2xl border shadow-2xl"
                  style={{ background: "rgba(13,20,32,0.94)", backdropFilter: "blur(24px)", borderColor: "rgba(255,255,255,0.1)" }}
                >
                  <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                    <p className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.9)" }}>{data?.user?.email ?? "Profile"}</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>{roleDisplay}</p>
                  </div>
                  <div className="p-2">
                    {canSystem && (
                      <Link
                        href="/system"
                        onClick={() => setProfileOpen(false)}
                        className="flex w-full items-center rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/8"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        System Platform
                      </Link>
                    )}
                    <Link
                      href={`/w/${shellSlug}/settings`}
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/8"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      Workspace Settings
                    </Link>
                    <div className="my-1 border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }} />
                    <Link
                      href="/signout"
                      onClick={() => setProfileOpen(false)}
                      className="flex w-full items-center rounded-xl px-3 py-2.5 text-sm transition hover:bg-white/8"
                      style={{ color: "rgba(239,68,68,0.8)" }}
                    >
                      Sign out
                    </Link>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* ─── Main layout ────────────────────────────────────── */}
      <div className="flex min-h-dvh pt-12">

        {/* Left sidebar */}
        <aside
          className="fixed inset-y-0 left-0 z-[85] hidden w-48 flex-col border-r border-white/8 pt-12 backdrop-blur-2xl sm:flex"
          style={{ background: "var(--os-panel-strong, rgba(9,13,26,0.88))" }}
        >
          <div className="flex-1 overflow-y-auto p-2">
            <p className="px-3 pb-1.5 pt-3 text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.30)" }}>
              Workspace
            </p>
            {dockItems.map((item) => {
              const Icon = item.icon;
              const href = item.route ? `/w/${shellSlug}/${item.route}` : `/w/${shellSlug}`;
              const isActive = activeDockId === item.id;
              return (
                <Link
                  key={item.id}
                  href={href}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition"
                  style={{
                    background: isActive ? "rgba(255,255,255,0.10)" : "transparent",
                    color: isActive ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.50)",
                  }}
                >
                  <Icon size={14} />
                  {item.label}
                </Link>
              );
            })}

            {quickRoutes.length > 0 && (
              <>
                <p className="mt-3 px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.30)" }}>
                  Quick Launch
                </p>
                {quickRoutes.map((item) => (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => jumpTo(item.route)}
                    className="flex w-full items-center rounded-xl px-3 py-1.5 text-left text-xs transition hover:bg-white/8"
                    style={{ color: "rgba(255,255,255,0.38)" }}
                  >
                    {item.label}
                  </button>
                ))}
              </>
            )}

            <div className="mt-4 border-t border-white/8 px-3 pt-3">
              <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.22)" }}>⌘K Spotlight · ⌘1–5 Dock</p>
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:ml-48">
          {children}
        </section>

        {/* Inspector panel (xl screens only) */}
        {isInspectorOpen ? (
          <div
            className="hidden w-[340px] flex-shrink-0 border-l border-white/8 xl:block"
            style={{ background: "var(--bg-elevated, rgba(255,255,255,0.02))" }}
          >
            <OrchestratorPanel
              tab={orchTab}
              onTab={setOrchTab}
              steps={steps}
              onRun={() => void runChiefCodeExecute()}
              summary={chiefCodeSummary}
              error={chiefCodeError}
              runBusy={chiefCodePhase === "planning" || chiefCodePhase === "executing"}
              runDisabled={chiefCodePhase !== "plan_ready" && chiefCodePhase !== "failed"}
              onRetry={chiefCodePhase === "failed" ? () => void runChiefCodePlan(intent.trim()) : undefined}
              onOpenLogs={chiefCodeRunId ? openChiefCodeLogs : undefined}
              contractTitle={chiefCodeContract?.title ?? null}
              contractScope={
                chiefCodeContract
                  ? [
                      chiefCodeContract.scope.selectedFiles?.length
                        ? `${chiefCodeContract.scope.selectedFiles.length} selected file(s)`
                        : chiefCodeContract.scope.folderPath?.trim()
                          ? `folder: ${chiefCodeContract.scope.folderPath}`
                          : "repo scope",
                      `stage: ${chiefCodeContract.constraints.stage ?? "playground"}`,
                      chiefCodeExecutorLabel ?? "Coding Agent",
                    ].join(" · ")
                  : null
              }
              contractDone={chiefCodeContract?.definitionOfDone}
              contractVerification={chiefCodeContract?.verification}
            />
          </div>
        ) : null}
      </div>

      {/* ─── Command Spotlight ──────────────────────────────── */}
      {spotlightOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center pt-24"
          style={{ background: "rgba(0,0,0,0.48)", backdropFilter: "blur(8px)" }}
          role="presentation"
          onClick={() => setSpotlightOpen(false)}
        >
          <div
            className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border shadow-[0_32px_96px_rgba(0,0,0,0.6)]"
            style={{ background: "rgba(13,20,32,0.97)", backdropFilter: "blur(24px)", borderColor: "rgba(255,255,255,0.12)" }}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.32)" }}>Intent Spotlight</p>
            </div>
            <div className="p-3">
              <IntentLine
                inputId="ec-intent-input"
                value={intent}
                onChange={setIntent}
                onOpen={() => setInspectorOpen(true)}
                onSubmit={runIntent}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Bottom Dock ────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-4 z-[95] flex justify-center px-4" aria-label="Workspace dock">
        <div
          className="flex items-center gap-1 overflow-x-auto rounded-[24px] border px-2.5 py-2 shadow-[0_20px_64px_rgba(5,8,18,0.5)]"
          style={{ background: "var(--glass-bg, rgba(13,20,32,0.88))", backdropFilter: "blur(20px)", borderColor: "rgba(255,255,255,0.10)" }}
        >
          {dockItems.map((item, index) => {
            const Icon = item.icon;
            const href = item.route ? `/w/${shellSlug}/${item.route}` : `/w/${shellSlug}`;
            const isActive = activeDockId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(href)}
                className="flex items-center gap-2 rounded-[18px] border px-3 py-2 text-xs font-medium tracking-wide transition hover:scale-[1.04]"
                style={{
                  background: isActive ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)",
                  borderColor: isActive ? "rgba(255,255,255,0.24)" : "transparent",
                  color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.50)",
                }}
                aria-label={`${item.label} (⌘${index + 1})`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
