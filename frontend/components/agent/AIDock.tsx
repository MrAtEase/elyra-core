"use client";

import { setActiveThreadHistory } from "@/lib/chat/activeThreadHistory";
import ChatMarkdown from "@/components/agent/ChatMarkdown";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BookText,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  FileText,
  Flag,
  Globe2,
  Languages,
  Loader2,
  Mail,
  MessageSquare,
  Network,
  PenLine,
  Presentation,
  RotateCcw,
  Sparkles,
  Copy,
  FolderKanban,
  Sun,
  Plus,
  SquarePen,
  StopCircle,
  Trash2,
  XCircle,
  ChevronLeft,
  Zap,
  Check,
  X,
  PanelRightOpen,
  Pin,
} from "lucide-react";

const ACTION_ICON_MAP: Record<string, React.ElementType> = {
  mail: Mail,
  calendar: Calendar,
  task: CheckSquare,
  tasks: CheckSquare,
  translate: Languages,
  research: Globe2,
  web: Globe2,
  draft: PenLine,
  write: PenLine,
  summarize: BookText,
  summary: BookText,
  pitchdeck: Presentation,
  pitch: Presentation,
  presentation: Presentation,
  slides: Presentation,
  elli_assistant: Sparkles,
  // daily_planner actions
  daily_planner: Sun,
  morning: Sun,
  brief: Sun,
  tagesplan: Calendar,
  startpunkt: Flag,
  start: Flag,
  next: Zap,
  was: Zap,
  // company_builder actions
  company_builder: Building2,
  aufbauplan: Building2,
  build: Building2,
  prozess: ClipboardList,
  process: ClipboardList,
  dokument: FileText,
  document: FileText,
  review: RotateCcw,
  wochenreview: RotateCcw,
};
import type {
  ActiveIntentState,
  IntentMessage,
  IntentStep,
  UiQuickAction,
  WorkspaceArtifact,
  WorkspaceKind,
} from "@/components/os/kernel/types";
import { eventBus } from "@/components/os/kernel/eventBus";
import type { AIDockContext, AIDockSurfaceId } from "@/components/agent/aidock/types";
import { useAIDockState } from "@/components/agent/aidock/useAIDockState";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { SHELL_LAYERS } from "@/components/os/shell/layers";
import { ensureSupabaseToken } from "@/lib/supabase/browser";
import ArtifactResultCard from "@/components/os/shell/cards/ArtifactResultCard";
import { resolveShortcutsForSurface } from "@/lib/os/shortcuts/registry";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import OrganicSphere from "@/components/orb2035/OrganicSphere";

export type AIDockProps = {
  intentState: ActiveIntentState;
  messages: IntentMessage[];
  artifacts: WorkspaceArtifact[];
  accent?: string;
  workspaceLabel: string;
  workspaceKind: WorkspaceKind;
  userEmail: string | null;
  userAvatarUrl: string | null;
  userInitials: string;
  workspaceId: string;
  activeSurface: AIDockSurfaceId;
  activeContext: AIDockContext;
  quickActions: UiQuickAction[];
  onExecuteQuickAction: (action: UiQuickAction) => Promise<void>;
  onConfirmStep: (stepId?: string) => void;
  onDenyStep: (stepId?: string) => void;
  onOpenArtifact: (artifactId: string, artifactType: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onClear: () => void;
  onWidthChange?: ((width: number) => void) | undefined;
  toggleChatSignal?: number;
  focusActionsSignal?: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type IntentListItem = {
  id: string;
  title: string;
  status: "idle" | "running" | "awaiting" | "failed";
  updatedAt: number;
  archived?: boolean;
};

type ChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

type ProjectItem = {
  id: string;
  workspace_id: string;
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

type ExternalRunStep = {
  id: string;
  label: string;
  status: IntentStep["status"];
  detail: string;
  updatedAt: number;
  requiresConfirmation?: boolean;
};

type ExternalRunState = {
  text: string;
  status: "idle" | "running" | "failed" | "completed";
  steps: ExternalRunStep[];
} | null;

type LocalAgentRunSummary = {
  id: string;
  app: "code" | "orchestrator";
  agent: string;
  task: string;
  stage: "playground" | "dev" | "prod";
  status: "planning" | "running" | "failed" | "completed";
  updatedAt: number;
  previewUrl?: string;
};

const defaultThreadId = "default";
const LOCAL_RUN_LEDGER_KEY = "elyra_agent_runs";
const SURFACE_LABEL: Record<AIDockSurfaceId, string> = {
  home: "Startseite",
  agent: "Agent",
  goals: "Ziele",
  apps: "Apps",
  system: "System",
  mail: "Mail",
  calendar: "Kalender",
  tasks: "Aufgaben",
  drive: "Drive",
  slides: "Folien",
  docs: "Dokumente",
  research: "Recherche",
  weather: "Wetter",
  translate: "Übersetzen",
};

function statusDot(status: IntentListItem["status"]) {
  if (status === "running") return "bg-emerald-500";
  if (status === "awaiting") return "bg-amber-500";
  if (status === "failed") return "bg-rose-500";
  return "bg-slate-400";
}

function mapIntentStatus(status: ActiveIntentState["status"]): IntentListItem["status"] {
  if (status === "running" || status === "thinking") return "running";
  if (status === "failed") return "failed";
  if (status === "idle") return "idle";
  return "awaiting";
}

function openCodeRun(runId: string, workspaceId?: string) {
  if (typeof window === "undefined") return;
  const pendingKey = "elyra_pending_code_run_id";
  try {
    window.localStorage.setItem(pendingKey, runId);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("elyra:open-code-run", { detail: { runId } }));
  const params = new URLSearchParams();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId?.trim()) ?? workspaceId?.trim();
  if (normalizedWorkspaceId) {
    params.set("workspaceId", normalizedWorkspaceId);
  }
  params.set("openRunId", runId);
  const target = `/os/code?${params.toString()}`;
  if (window.location.pathname.startsWith("/os/code")) {
    window.history.replaceState(null, "", target);
  } else {
    window.location.assign(target);
  }
}

function stepStatusTone(status: IntentStep["status"]): string {
  if (status === "completed") return "border-emerald-300/60 bg-emerald-50 text-emerald-800";
  if (status === "running") return "border-blue-300/60 bg-blue-50 text-blue-800";
  if (status === "failed") return "border-rose-300/60 bg-rose-50 text-rose-800";
  if (status === "approval_required") return "border-amber-300/60 bg-amber-50 text-amber-800";
  return "border-slate-300/60 bg-[color:var(--bg-surface)] text-[color:var(--text-secondary)]";
}

function stepIcon(step: IntentStep) {
  if (step.status === "running") return <Loader2 size={13} className="animate-spin text-blue-600" />;
  if (step.status === "completed") return <CheckCircle2 size={13} className="text-emerald-600" />;
  if (step.status === "failed") return <AlertTriangle size={13} className="text-rose-600" />;
  if (step.status === "approval_required") return <AlertTriangle size={13} className="text-amber-600" />;
  if (step.status === "skipped") return <XCircle size={13} className="text-[color:var(--text-muted)]" />;
  return <span className="h-2 w-2 rounded-full bg-slate-400" />;
}

function formatTime(value: number | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export default function AIDock({
  intentState,
  messages,
  artifacts,
  accent,
  userEmail,
  userAvatarUrl,
  workspaceId,
  activeSurface,
  activeContext,
  quickActions,
  onExecuteQuickAction,
  onConfirmStep,
  onDenyStep,
  onOpenArtifact,
  onCancel,
  onRetry,
  onClear,
  onWidthChange,
  toggleChatSignal = 0,
  focusActionsSignal = 0,
}: AIDockProps) {
  const dock = useAIDockState(workspaceId);
  const [railHovered, setRailHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const railVisible = dock.pinned || railHovered || resizing;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showRail = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setRailHovered(true); };
  const hideRailSoon = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRailHovered(false), 300);
  };

  // Fixed: the app makes room for the rail. Auto: the rail floats over the app.
  useEffect(() => {
    onWidthChange?.(dock.pinned ? dock.width : 0);
  }, [dock.pinned, dock.width, onWidthChange]);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizing(true);
    const onMove = (e: PointerEvent) => dock.setWidth(window.innerWidth - e.clientX);
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [dock]);

  const intentStorageKey = `elyra:intents:${workspaceId}:${userEmail ?? "anon"}`;
  const threadStorageKey = `elyra:threads:${workspaceId}:${userEmail ?? "anon"}`;

  const [intents, setIntents] = useState<IntentListItem[]>([]);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);

  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>(defaultThreadId);
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState<"chat" | "plan" | "runs" | "artifacts" | "shortcuts" | "project">("chat");
  // thread view mode: "list" shows all threads, "thread" shows selected thread messages
  const [chatView, setChatView] = useState<"list" | "thread">("thread");

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [selectedStep, setSelectedStep] = useState<IntentStep | null>(null);
  const [externalRun, setExternalRun] = useState<ExternalRunState>(null);
  const [localRuns, setLocalRuns] = useState<LocalAgentRunSummary[]>([]);

  const prevToggleChatSignal = useRef(toggleChatSignal);
  const prevFocusActionsSignal = useRef(focusActionsSignal);

  const chatServiceUrl =
    (process.env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:8788") + "/v1/chat";

  const activeThread = useMemo(
    () => chatThreads.find((thread) => thread.id === selectedThreadId) ?? chatThreads[0] ?? null,
    [chatThreads, selectedThreadId],
  );

  // The chat view shows only the selected thread – "+ New" really starts empty.
  const timeline = useMemo(
    () => (activeThread?.messages ?? []).slice(-40).map((m) => ({ role: m.role, text: m.content, createdAt: m.createdAt })),
    [activeThread],
  );

  useEffect(() => {
    if (toggleChatSignal === prevToggleChatSignal.current) return;
    prevToggleChatSignal.current = toggleChatSignal;
    dock.togglePanel("chat");
    setActiveTab("chat");
  }, [dock, toggleChatSignal]);

  useEffect(() => {
    if (focusActionsSignal === prevFocusActionsSignal.current) return;
    prevFocusActionsSignal.current = focusActionsSignal;
    dock.openPanel("actions");
    setActiveTab("shortcuts");
  }, [dock, focusActionsSignal]);

  useEffect(() => {
    const restoredIntents = loadJSON<IntentListItem[]>(intentStorageKey, []);
    const currentIntentId = intentState.runId ?? intentState.foundationRunId ?? "intent-current";
    const currentIntent: IntentListItem = {
      id: currentIntentId,
      title: intentState.text?.slice(0, 48) || "New intent",
      status: mapIntentStatus(intentState.status),
      updatedAt: Date.now(),
    };

    const merged = [
      currentIntent,
      ...restoredIntents.filter((item) => item.id !== currentIntentId),
    ].slice(0, 20);

    setIntents(merged);
    setSelectedIntentId(currentIntentId);
  }, [intentState.foundationRunId, intentState.runId, intentState.status, intentState.text, intentStorageKey]);

  useEffect(() => {
    saveJSON(intentStorageKey, intents);
  }, [intentStorageKey, intents]);

  // The storage key changes while the page loads (email arrives after first render). The save
  // effect below must not write the previous key's threads under the new key – that overwrote
  // deleted chats with a stale copy. So saving pauses until the new key's threads are in state.
  const threadsRestoredForKeyRef = useRef<string | null>(null);
  const skipNextThreadSaveRef = useRef(false);

  useEffect(() => {
    skipNextThreadSaveRef.current = true;
    threadsRestoredForKeyRef.current = threadStorageKey;
    const restoredThreads = loadJSON<ChatThread[]>(threadStorageKey, []);
    if (restoredThreads.length > 0) {
      setChatThreads(restoredThreads);
      setSelectedThreadId(restoredThreads[0]?.id ?? defaultThreadId);
    } else {
      setChatThreads([{ id: defaultThreadId, title: "General", updatedAt: Date.now(), messages: [] }]);
      setSelectedThreadId(defaultThreadId);
    }
    setChatHistoryLoaded(false);
    setSelectedStep(null);
    eventBus.emit("orb:state", { state: "idle" });
  }, [threadStorageKey]);

  useEffect(() => {
    if (skipNextThreadSaveRef.current) { skipNextThreadSaveRef.current = false; return; }
    if (threadsRestoredForKeyRef.current !== threadStorageKey) return;
    // Do not persist the anonymous placeholder before the user is known.
    if (!userEmail) return;
    saveJSON(threadStorageKey, chatThreads);
  }, [threadStorageKey, chatThreads, userEmail]);

  useEffect(() => {
    const onCodeRunUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            clear?: boolean;
            text?: string;
            status?: "running" | "failed" | "completed";
            steps?: Array<{ id: string; label: string; status: IntentStep["status"]; detail?: string }>;
          }
        | undefined;

      if (detail?.clear) {
        setExternalRun(null);
        return;
      }

      if (!detail?.text || !detail.status) return;

      setExternalRun({
        text: detail.text,
        status: detail.status,
        steps: Array.isArray(detail.steps)
          ? detail.steps.map((step) => ({
              ...step,
              detail: step.detail ?? "",
              updatedAt: Date.now(),
              ...(step.status === "approval_required" ? { requiresConfirmation: true } : {}),
            }))
          : [],
      });
      setActiveTab("runs");
      dock.openPanel("actions");
    };

    window.addEventListener("elyra:code-run-update", onCodeRunUpdate);
    return () => window.removeEventListener("elyra:code-run-update", onCodeRunUpdate);
  }, [dock]);

  useEffect(() => {
    const syncLocalRuns = () => {
      const stored = loadJSON<LocalAgentRunSummary[]>(LOCAL_RUN_LEDGER_KEY, [])
        .filter((item) => item?.app === "code" || item?.app === "orchestrator")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6);
      setLocalRuns(stored);
    };

    syncLocalRuns();
    window.addEventListener("elyra:run-ledger-updated", syncLocalRuns);
    return () => window.removeEventListener("elyra:run-ledger-updated", syncLocalRuns);
  }, []);

  const fetchProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const token = await ensureSupabaseToken().catch(() => null);
      if (!token) {
        setProjects([]);
        return;
      }
      const response = await fetch(`/api/os/projects?workspace_id=${encodeURIComponent(workspaceId)}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-workspace-id": workspaceId,
        },
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; projects?: ProjectItem[] } | null;
      if (!response.ok || !payload?.ok) return;
      const nextProjects = payload.projects ?? [];
      setProjects(nextProjects);
      setSelectedProjectId((current) => current ?? nextProjects[0]?.id ?? null);
    } finally {
      setProjectLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!dock.panelOpen.chat || chatHistoryLoaded) return;
    let cancelled = false;

    async function loadHistory() {
      try {
        const token = await ensureSupabaseToken().catch(() => null);
        if (!token) {
          if (!cancelled) setChatHistoryLoaded(true);
          return;
        }
        const historyUrl = chatServiceUrl.replace(/\/v1\/chat$/, "/v1/chat/history");
        const response = await fetch(`${historyUrl}?workspaceId=${encodeURIComponent(workspaceId)}&limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          if (!cancelled) setChatHistoryLoaded(true);
          return;
        }

        const payload = (await response.json()) as {
          messages?: Array<{
            role?: string;
            content?: string;
            created_at?: string;
          }>;
        };

        if (cancelled || !Array.isArray(payload.messages)) {
          if (!cancelled) setChatHistoryLoaded(true);
          return;
        }

        const restored: ChatMessage[] = payload.messages
          .filter((message) => typeof message.content === "string")
          .map((message) => {
            const parsedCreatedAt = Date.parse(message.created_at ?? "");
            return {
              role: message.role === "assistant" ? "assistant" : "user",
              content: message.content ?? "",
              createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
            };
          });

        setChatThreads((current) =>
          current.map((thread) =>
            thread.id === defaultThreadId && thread.messages.length === 0
              ? { ...thread, messages: restored.slice(-50), updatedAt: Date.now() }
              : thread,
          ),
        );
      } catch {
        // ignore
      } finally {
        if (!cancelled) setChatHistoryLoaded(true);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [chatHistoryLoaded, chatServiceUrl, dock.panelOpen.chat, workspaceId]);

  // Kernel messages are one global stream per workspace. Only NEW messages are
  // appended to the currently selected thread — otherwise "+ New" would get the
  // whole old conversation copied into it again.
  const selectedThreadIdRef = useRef(selectedThreadId);
  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);
  const processedMessageCountRef = useRef<number | null>(null);

  // Publish the open thread's history so the kernel sends only this thread's context to Elly.
  useEffect(() => {
    const thread = chatThreads.find((t) => t.id === selectedThreadId);
    setActiveThreadHistory(
      selectedThreadId,
      (thread?.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
    );
  }, [chatThreads, selectedThreadId]);

  useEffect(() => {
    const nextMessages: ChatMessage[] = messages
      .filter((message) => typeof message.text === "string" && message.text.trim().length > 0)
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.text,
        createdAt: message.createdAt,
      }));

    // Wait for the first non-empty stream (server hydration) before establishing a baseline.
    if (processedMessageCountRef.current === null && nextMessages.length === 0) return;
    const isFirstRun = processedMessageCountRef.current === null;
    let processed = processedMessageCountRef.current ?? 0;
    if (nextMessages.length < processed) processed = 0; // stream was cleared/reset
    const fresh = nextMessages.slice(processed);
    processedMessageCountRef.current = nextMessages.length;
    if (fresh.length === 0) {
      const last = nextMessages[nextMessages.length - 1];
      if (!last) return;
      setChatThreads((current) =>
        current.map((thread) => {
          if (thread.id !== selectedThreadIdRef.current) return thread;
          const idx = thread.messages.findIndex(
            (m) => m.role === last.role && m.createdAt === last.createdAt && m.content !== last.content,
          );
          if (idx < 0) return thread;
          const messagesCopy = [...thread.messages];
          messagesCopy[idx] = { ...thread.messages[idx]!, content: last.content };
          return { ...thread, messages: messagesCopy };
        }),
      );
      return;
    }

    setChatThreads((current) => {
      const currentThread =
        current.find((thread) => thread.id === selectedThreadIdRef.current) ?? current[0] ?? null;
      if (!currentThread) return current;
      // On first mount, don't duplicate into a thread that was already restored from history.
      if (isFirstRun && currentThread.messages.length > 0) return current;

      // A thread created via "+ New" only takes messages written after it was created
      // (server hydration replays older ones with their original timestamps).
      const createdMatch = /^thread-(\d+)$/.exec(currentThread.id);
      const threadCreatedAt = createdMatch ? Number(createdMatch[1]) : 0;
      const toAppend = fresh.filter(
        (message) =>
          (message.createdAt ?? 0) >= threadCreatedAt &&
          !currentThread.messages.some(
            (existing) =>
              existing.role === message.role &&
              existing.content === message.content &&
              Math.abs((existing.createdAt ?? 0) - (message.createdAt ?? 0)) < 120_000,
          ),
      );
      if (toAppend.length === 0) return current;

      const merged = [...currentThread.messages, ...toAppend].slice(-50);
      const updatedAt = toAppend[toAppend.length - 1]?.createdAt ?? Date.now();
      const firstUser = merged.find((m) => m.role === "user")?.content.trim() ?? "";
      const title =
        currentThread.title === "Neuer Chat" && firstUser
          ? firstUser.length > 40 ? `${firstUser.slice(0, 40)}…` : firstUser
          : currentThread.title;
      return current.map((thread) =>
        thread.id === currentThread.id ? { ...thread, title, messages: merged, updatedAt } : thread,
      );
    });
  }, [messages]);

  const copyText = useCallback(async (content: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // ignore
    }
  }, []);

  const createThread = useCallback(() => {
    const id = `thread-${Date.now()}`;
    const newThread: ChatThread = { id, title: "Neuer Chat", updatedAt: Date.now(), messages: [] };
    setChatThreads((current) => [newThread, ...current]);
    setSelectedThreadId(id);
    setChatView("thread");
  }, []);

  const deleteThread = useCallback((threadId: string) => {
    const removed = chatThreads.find((t) => t.id === threadId);
    // A fresh id (thread-<now>) so neither the server history nor the kernel's message
    // stream refills the replacement chat with the deleted conversation after a reload.
    const replacement: ChatThread = { id: `thread-${Date.now()}`, title: "Neuer Chat", updatedAt: Date.now(), messages: [] };
    const remaining = chatThreads.filter((t) => t.id !== threadId);
    const next = remaining.length === 0 ? [replacement] : remaining;
    setChatThreads(next);
    setSelectedThreadId((current) => (current !== threadId ? current : next[0]?.id ?? replacement.id));
    setChatView("list");

    // Remove the messages on the server too – otherwise they come back on the next load.
    if (removed && removed.messages.length > 0) {
      void (async () => {
        try {
          const headers = await withSupabaseAuthorization({ "content-type": "application/json" });
          await fetch("/api/v1/chat/history", {
            method: "DELETE",
            credentials: "include",
            headers,
            body: JSON.stringify({
              workspaceId,
              messages: removed.messages.map((m) => ({ content: m.content, createdAt: m.createdAt })),
            }),
          });
        } catch {
          // best effort – the chat is already gone locally
        }
      })();
    }
  }, [chatThreads, workspaceId]);

  const renameThread = useCallback((threadId: string) => {
    const name = window.prompt("Thread umbenennen");
    if (!name?.trim()) return;
    setChatThreads((current) =>
      current.map((t) => (t.id === threadId ? { ...t, title: name.trim(), updatedAt: Date.now() } : t))
    );
  }, []);

  const visibleThreads = useMemo(() => [...chatThreads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20), [chatThreads]);

  const contextualActions = useMemo(() => {
    return resolveShortcutsForSurface(quickActions, activeSurface).slice(0, 8);
  }, [activeSurface, quickActions]);

  const latestRunArtifacts = useMemo(() => {
    const runKey = intentState.foundationRunId ?? intentState.runId;
    if (!runKey) return artifacts.slice(0, 6);
    const scoped = artifacts.filter((artifact) => artifact.runId === runKey);
    return (scoped.length > 0 ? scoped : artifacts).slice(0, 6);
  }, [artifacts, intentState.foundationRunId, intentState.runId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const runStatus = externalRun?.status ?? intentState.status;
  const runText = externalRun?.text ?? intentState.text;
  const runSteps = externalRun?.steps ?? intentState.steps;
  const activeRunLabel = runStatus === "idle" ? null : runStatus;

  // ── Status helpers ─────────────────────────────────────────────────────────
  const isRunning = runStatus === "running" || runStatus === "thinking";
  const hasPlan = runSteps.length > 0;
  const hasApprovalStep = runSteps.some((s) => s.status === "approval_required");
  // Plan and run history live in one "Ablauf" tab. Badges only signal something to do.
  const TABS = [
    { id: "chat" as const, label: "Chat", icon: MessageSquare, badge: 0 },
    { id: "plan" as const, label: "Ablauf", icon: Network, badge: hasApprovalStep ? 1 : 0 },
    { id: "shortcuts" as const, label: "Aktionen", icon: Sparkles, badge: 0 },
    { id: "artifacts" as const, label: "Dateien", icon: FileText, badge: 0 },
    { id: "project" as const, label: "Projekte", icon: FolderKanban, badge: 0 },
  ];

  useEffect(() => {
    if (activeTab === "runs") setActiveTab("plan");
  }, [activeTab]);

  const statusText = isRunning ? "Arbeitet …" : hasApprovalStep ? "Wartet auf deine Freigabe" : "Bereit";

  return (
    <>
      {!railVisible ? (
        <button
          type="button"
          onClick={showRail}
          onMouseEnter={showRail}
          className="fixed right-0 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-xl border border-r-0 px-1.5 py-3 text-[10px] font-semibold transition hover:pr-2.5 lg:flex"
          style={{
            zIndex: SHELL_LAYERS.elyPanel,
            borderColor: "var(--os-border-soft)",
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
          }}
          title="Elly öffnen"
          aria-label="Elly öffnen"
        >
          <PanelRightOpen size={14} />
          <span style={{ writingMode: "vertical-rl" }}>Elly</span>
        </button>
      ) : null}
    <aside
      className={`fixed bottom-0 right-0 top-14 hidden lg:flex lg:flex-col overflow-hidden ${resizing ? "" : "transition-transform duration-200"}`}
      style={{
        zIndex: SHELL_LAYERS.elyPanel,
        width: `${dock.width}px`,
        borderLeft: "1px solid var(--os-border-faint)",
        background: "color-mix(in srgb, var(--bg-elevated) 95%, transparent)",
        backdropFilter: "blur(24px) saturate(1.12)",
        transform: railVisible ? "translateX(0)" : "translateX(100%)",
        pointerEvents: railVisible ? "auto" : "none",
      }}
      aria-label="Elly"
      onMouseEnter={showRail}
      onMouseLeave={() => { if (!dock.pinned) hideRailSoon(); }}
    >
      {/* Drag to resize; double-click resets the width. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite ändern"
        title="Ziehen, um die Breite zu ändern · Doppelklick: Standardbreite"
        onPointerDown={startResize}
        onDoubleClick={() => dock.resetWidth()}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-[color:var(--os-accent)]/40"
        style={resizing ? { background: "color-mix(in srgb, var(--os-accent) 40%, transparent)" } : undefined}
      />
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: "var(--os-border-faint)" }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accent ?? "rgba(108,156,252,1)"}22`, color: accent ?? "var(--os-accent)" }}
        >
          <Sparkles size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Elly</p>
          <p className="flex items-center gap-1.5 truncate text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {isRunning ? (
              <Loader2 size={10} className="shrink-0 animate-spin" style={{ color: "#4ade80" }} />
            ) : (
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasApprovalStep ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
            )}
            <span className="truncate">{statusText} · {SURFACE_LABEL[activeSurface]}</span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { createThread(); setActiveTab("chat"); }}
            className="grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/8"
            style={{ color: "var(--text-tertiary)" }}
            title="Neuer Chat"
            aria-label="Neuer Chat"
          >
            <SquarePen size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !dock.pinned;
              dock.setPinned(next);
              if (!next) setRailHovered(false);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition hover:bg-white/8"
            style={{
              color: dock.pinned ? "var(--text-primary)" : "var(--text-tertiary)",
              borderColor: dock.pinned ? "var(--os-border-soft)" : "var(--os-border-faint)",
            }}
            title={dock.pinned ? "Fixiert – klicken, damit Elly sich automatisch ausblendet" : "Auto – klicken, um Elly fest anzuheften"}
            aria-label={dock.pinned ? "Elly automatisch ausblenden" : "Elly fixieren"}
          >
            <Pin size={12} />
            <span>{dock.pinned ? "Fixed" : "Auto"}</span>
          </button>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <nav
        className="flex shrink-0 gap-0.5 px-2 py-2 border-b"
        style={{ borderColor: "var(--os-border-faint)" }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 px-1 transition-all"
              style={{
                background: active ? "var(--bg-elevated)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                border: active ? "1px solid var(--os-border-soft)" : "1px solid transparent",
              }}
              title={tab.label}
            >
              <Icon size={13} />
              <span className="text-[10px] font-medium" style={{ letterSpacing: "0.02em" }}>
                {tab.label}
              </span>
              {tab.badge > 0 && (
                <span
                  className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold"
                  style={{ background: tab.id === "plan" && hasApprovalStep ? "#f59e0b" : "var(--os-accent)", color: "#fff" }}
                >
                  {tab.id === "plan" ? "!" : tab.badge > 9 ? "9+" : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ── Chat ── */}
        {activeTab === "chat" && (
          <div className="flex h-full flex-col">
            {/* Thread header */}
            <div className="flex shrink-0 items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--os-border-faint)" }}>
              {chatView === "thread" && (
                <button
                  type="button"
                  onClick={() => setChatView("list")}
                  className="rounded-lg p-1 transition hover:bg-white/8"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <ChevronLeft size={13} />
                </button>
              )}
              <p className="flex-1 truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                {chatView === "list" ? "Unterhaltungen" : (activeThread?.title === "General" ? "Allgemein" : activeThread?.title ?? "Chat")}
              </p>
              <button
                type="button"
                onClick={createThread}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition hover:bg-white/8"
                style={{ color: "var(--text-tertiary)", border: "1px solid var(--os-border-faint)" }}
              >
                <Plus size={11} /> Neu
              </button>
            </div>

            {/* Thread list */}
            {chatView === "list" ? (
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {visibleThreads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <MessageSquare size={24} className="mb-2 opacity-20" style={{ color: "var(--text-muted)" }} />
                    <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Noch keine Unterhaltungen</p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>Schreib unten, was Elly tun soll ↓</p>
                  </div>
                ) : visibleThreads.map((thread) => (
                  <div key={thread.id} className="group flex items-center gap-1 rounded-xl px-2.5 py-2 transition hover:bg-white/5">
                    <button
                      type="button"
                      onClick={() => { setSelectedThreadId(thread.id); setChatView("thread"); }}
                      className="min-w-0 flex-1 truncate text-left text-[12px]"
                      style={{ color: selectedThreadId === thread.id ? "var(--text-primary)" : "var(--text-secondary)" }}
                    >
                      {thread.title}
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button type="button" onClick={() => renameThread(thread.id)} className="rounded p-1 hover:bg-white/8" style={{ color: "var(--text-muted)" }}>
                        <SquarePen size={10} />
                      </button>
                      <button type="button" onClick={() => deleteThread(thread.id)} className="rounded p-1 hover:text-rose-400" style={{ color: "var(--text-muted)" }}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Messages */
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {timeline.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center relative h-full">
                    <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none" style={{ mixBlendMode: "screen", filter: "blur(20px)" }}>
                       <div className="w-48 h-48 rounded-full" style={{ background: "radial-gradient(circle, rgba(108,156,252,0.4) 0%, rgba(108,156,252,0) 70%)" }} />
                    </div>
                    <div className="mb-6 relative z-10 w-32 h-32 md:w-40 md:h-40 pointer-events-none drop-shadow-2xl">
                       <OrganicSphere />
                    </div>
                    {isRunning ? (
                      <p className="text-[13px] font-medium tracking-wide" style={{ color: "var(--os-accent)" }}>Analysiere den Kontext …</p>
                    ) : (
                      <>
                        <p className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>Hi, ich bin Elly.</p>
                        <p className="text-[12px] mt-1" style={{ color: "var(--text-secondary)" }}>Vollgas! Wie kann ich dir helfen?</p>
                      </>
                    )}
                  </div>
                ) : timeline.map((message, index) => {
                  const isAssistant = message.role === "assistant";
                  return (
                    <div
                      key={`chat-${index}`}
                      className="group rounded-2xl px-3 py-2.5"
                      style={{
                        background: isAssistant ? "var(--bg-elevated)" : "rgba(108,156,252,0.1)",
                        border: `1px solid ${isAssistant ? "var(--os-border-faint)" : "rgba(108,156,252,0.2)"}`,
                      }}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide"
                          style={{ color: isAssistant ? "var(--os-accent)" : "rgba(108,156,252,0.8)" }}
                        >
                          {isAssistant ? "Elly" : "Du"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyText(message.text)}
                          className="rounded p-0.5 opacity-0 transition group-hover:opacity-100"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <Copy size={10} />
                        </button>
                      </div>
                      {isAssistant ? (
                        <div className="text-[12px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                          <ChatMarkdown text={message.text} />
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                          {message.text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Plan ── (mindmap / intent steps) */}
        {activeTab === "plan" && (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--os-border-faint)" }}>
              <Zap size={12} style={{ color: "#f59e0b" }} />
              <p className="flex-1 text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {hasPlan ? runText || "Aktueller Plan" : "Aktueller Ablauf"}
              </p>
              {hasPlan && (
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-medium uppercase"
                  style={{
                    background: isRunning ? "rgba(74,222,128,0.15)" : hasApprovalStep ? "rgba(245,158,11,0.15)" : "var(--bg-elevated)",
                    color: isRunning ? "#4ade80" : hasApprovalStep ? "#fbbf24" : "var(--text-tertiary)",
                    border: `1px solid ${isRunning ? "rgba(74,222,128,0.3)" : hasApprovalStep ? "rgba(245,158,11,0.3)" : "var(--os-border-faint)"}`,
                  }}
                >
                  {isRunning ? "Läuft" : hasApprovalStep ? "Freigabe" : runStatus}
                </span>
              )}
            </div>

            {hasPlan ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {/* Visual step pipeline */}
                <div className="relative">
                  {runSteps.map((step, i) => {
                    const isLast = i === runSteps.length - 1;
                    const stepColor =
                      step.status === "completed" ? "#22c55e"
                      : step.status === "running" ? "#60a5fa"
                      : step.status === "approval_required" ? "#f59e0b"
                      : step.status === "failed" ? "#ef4444"
                      : step.status === "skipped" ? "#6b7280"
                      : "var(--os-border-soft)";
                    return (
                      <div key={step.id} className="relative pl-7">
                        {/* Connector line */}
                        {!isLast && (
                          <div className="absolute left-[13px] top-7 bottom-0 w-px" style={{ background: "var(--os-border-faint)" }} />
                        )}
                        {/* Node dot */}
                        <div
                          className="absolute left-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full border-2"
                          style={{ borderColor: stepColor, background: `${stepColor}22` }}
                        >
                          {step.status === "completed" && <Check size={9} style={{ color: stepColor }} />}
                          {step.status === "running" && <Loader2 size={9} className="animate-spin" style={{ color: stepColor }} />}
                          {step.status === "failed" && <X size={9} style={{ color: stepColor }} />}
                          {step.status === "approval_required" && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: stepColor }} />}
                        </div>
                        {/* Step card */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedStep(selectedStep?.id === step.id ? null : step)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedStep(selectedStep?.id === step.id ? null : step);
                            }
                          }}
                          className="mb-2 w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5"
                          style={{ border: `1px solid ${selectedStep?.id === step.id ? stepColor : "var(--os-border-faint)"}`, background: "var(--bg-elevated)" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{step.label}</span>
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                              style={{
                                background: `${stepColor}18`,
                                color: stepColor,
                                border: `1px solid ${stepColor}40`,
                              }}
                            >
                              {step.status.replace("_", " ")}
                            </span>
                          </div>
                          {selectedStep?.id === step.id && step.detail && (
                            <p className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                              {step.detail}
                            </p>
                          )}
                          {step.status === "approval_required" && (
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onConfirmStep(step.id); }}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition"
                                style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }}
                              >
                                <Check size={10} /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onDenyStep(step.id); }}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition"
                                style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
                              >
                                <X size={10} /> Deny
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Plan controls */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition"
                    style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
                  >
                    <StopCircle size={12} /> Stop
                  </button>
                  <button
                    type="button"
                    onClick={onClear}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--os-border-faint)" }}
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 px-4 py-10 text-center">
                <div
                  className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
                >
                  <Network size={24} style={{ color: "rgba(245,158,11,0.6)" }} />
                </div>
                <p className="text-[13px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                  Kein aktiver Plan
                </p>
                <p className="text-[11px] leading-relaxed mb-3" style={{ color: "var(--text-tertiary)" }}>
                  Plan-Modus startet <strong style={{ color: "var(--text-secondary)" }}>automatisch</strong>{" "}
                  wenn du Elly bittest etwas zu erstellen, zu ändern oder zu löschen.
                  Die Schritte erscheinen hier und warten auf deine Bestätigung.
                </p>
                <div
                  className="w-full rounded-xl px-3 py-2.5 text-left mb-4"
                  style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)" }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "rgba(245,158,11,0.7)" }}>
                    Beispiele zum Ausprobieren
                  </p>
                  {[
                    "Erstelle eine Aufgabe für das Onboarding",
                    "Plane ein Team-Meeting für Freitag",
                    "Schreibe eine Antwort auf die letzte E-Mail",
                    "Neues Event morgen um 10 Uhr erstellen",
                  ].map((prompt) => (
                    <p key={prompt} className="text-[11px] py-0.5" style={{ color: "var(--text-secondary)" }}>
                      → {prompt}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Letzte Läufe (Teil von „Ablauf") ── */}
        {activeTab === "plan" && localRuns.length > 0 && (
          <div className="flex flex-col p-3 gap-3 border-t" style={{ borderColor: "var(--os-border-faint)" }}>
            {runStatus !== "idle" && !isRunning ? (
              <button
                type="button"
                onClick={onRetry}
                className="self-start rounded-lg px-2 py-0.5 text-[10px] transition hover:bg-white/8"
                style={{ color: "var(--text-muted)", border: "1px solid var(--os-border-faint)" }}
              >
                Erneut ausführen
              </button>
            ) : null}
            {/* Steps list */}
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {localRuns.length > 0 ? (
                <div className="pt-2">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                    Letzte Läufe
                  </p>
                  <div className="space-y-1.5">
                    {localRuns.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-xl px-3 py-2"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--os-border-faint)" }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                            style={{
                              background:
                                run.status === "completed"
                                  ? "rgba(74,222,128,0.12)"
                                  : run.status === "failed"
                                    ? "rgba(239,68,68,0.12)"
                                    : "rgba(96,165,250,0.12)",
                              color:
                                run.status === "completed"
                                  ? "#4ade80"
                                  : run.status === "failed"
                                    ? "#f87171"
                                    : "#60a5fa",
                            }}
                          >
                            {run.stage}
                          </span>
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ background: "var(--bg-surface)", color: "var(--text-tertiary)", border: "1px solid var(--os-border-faint)" }}>
                            {run.app}
                          </span>
                          <span className="flex-1 truncate text-[11px]" style={{ color: "var(--text-primary)" }}>
                            {run.task}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                          <span className="truncate">{run.status}</span>
                          <span>{formatTime(run.updatedAt)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openCodeRun(run.id, workspaceId)}
                          className="mt-1 inline-flex text-[10px] font-medium transition-opacity hover:opacity-80"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          Lauf öffnen
                        </button>
                        {run.previewUrl ? (
                          <a
                            href={run.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-[10px] font-medium"
                            style={{ color: "var(--os-accent)" }}
                          >
                            Vorschau öffnen
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        {activeTab === "shortcuts" && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
              Aktionen · {SURFACE_LABEL[activeSurface]}
            </p>
            {contextualActions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Sparkles size={20} className="mb-2 opacity-20" style={{ color: "var(--text-muted)" }} />
                <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Für diese Ansicht gibt es keine Aktionen</p>
              </div>
            ) : contextualActions.map((action) => {
              const disabled = action.state !== "ready";
              return (
                <button
                  key={`${action.app_id}:${action.action_id}`}
                  type="button"
                  onClick={() => void onExecuteQuickAction(action)}
                  disabled={disabled}
                  title={disabled ? "Bald verfügbar" : action.intent}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ border: "1px solid var(--os-border-faint)", background: "var(--bg-elevated)" }}
                >
                  {(() => {
                    const key = action.label.toLowerCase().split(" ")[0] ?? "";
                    const ActionIcon = ACTION_ICON_MAP[key] ?? ACTION_ICON_MAP[action.app_id] ?? Sparkles;
                    return (
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: disabled ? "rgba(100,100,100,0.1)" : "rgba(108,156,252,0.1)", color: disabled ? "var(--text-muted)" : "var(--os-accent)" }}
                      >
                        <ActionIcon size={13} />
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{action.label}</p>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-tertiary)" }}>{action.intent}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Artifacts ── */}
        {activeTab === "artifacts" && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
              Letzte Dateien
            </p>
            {latestRunArtifacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileText size={20} className="mb-2 opacity-20" style={{ color: "var(--text-muted)" }} />
                <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Noch keine Dateien</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>Was Elly erstellt, erscheint hier</p>
              </div>
            ) : latestRunArtifacts.map((artifact) => (
              <ArtifactResultCard key={artifact.id} artifact={artifact} compact onOpen={onOpenArtifact} />
            ))}
          </div>
        )}

        {/* ── Projects ── */}
        {activeTab === "project" && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--os-border-faint)" }}>
              <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>Projekte</p>
              <button
                type="button"
                onClick={async () => {
                  const name = window.prompt("Name des Projekts");
                  if (!name?.trim()) return;
                  const token = await ensureSupabaseToken().catch(() => null);
                  if (!token) return;
                  await fetch(`/api/os/projects?workspace_id=${encodeURIComponent(workspaceId)}`, {
                    method: "POST",
                    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-workspace-id": workspaceId },
                    body: JSON.stringify({ name: name.trim() }),
                    credentials: "include",
                  });
                  await fetchProjects();
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition hover:bg-white/8"
                style={{ color: "var(--text-tertiary)", border: "1px solid var(--os-border-faint)" }}
              >
                <Plus size={11} /> Neu
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {projectLoading ? (
                <p className="py-6 text-center text-[12px]" style={{ color: "var(--text-secondary)" }}>Lädt …</p>
              ) : projects.filter((p) => !p.archived).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FolderKanban size={20} className="mb-2 opacity-20" style={{ color: "var(--text-muted)" }} />
                  <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Noch keine Projekte</p>
                </div>
              ) : projects.filter((project) => !project.archived).map((project) => (
                <div
                  key={project.id}
                  className="group flex items-center gap-2 rounded-xl px-3 py-2.5 transition hover:bg-white/5"
                  style={{
                    background: selectedProjectId === project.id ? "var(--bg-elevated)" : "transparent",
                    border: `1px solid ${selectedProjectId === project.id ? "var(--os-border-soft)" : "transparent"}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className="min-w-0 flex-1 truncate text-left text-[12px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {project.name}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={async () => {
                        const next = window.prompt("Umbenennen", project.name);
                        if (!next?.trim()) return;
                        const token = await ensureSupabaseToken().catch(() => null);
                        if (!token) return;
                        await fetch(`/api/os/projects?workspace_id=${encodeURIComponent(workspaceId)}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-workspace-id": workspaceId },
                          body: JSON.stringify({ id: project.id, action: "rename", name: next.trim() }),
                          credentials: "include",
                        });
                        await fetchProjects();
                      }}
                      className="rounded p-1 hover:bg-white/8"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <SquarePen size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const token = await ensureSupabaseToken().catch(() => null);
                        if (!token) return;
                        await fetch(`/api/os/projects?workspace_id=${encodeURIComponent(workspaceId)}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-workspace-id": workspaceId },
                          body: JSON.stringify({ id: project.id, action: "archive" }),
                          credentials: "include",
                        });
                        await fetchProjects();
                      }}
                      className="rounded p-1 hover:text-rose-400"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Archive size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
    </>
  );
}
