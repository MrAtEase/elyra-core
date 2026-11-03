"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  arrangeSplitView,
  closeWindow,
  focusWindow,
  hasWindowGeometryChanges,
  minimizeWindow,
  moveWindow,
  normalizeWindowsForViewport,
  openWindow,
  resizeWindow,
  saveWorkspaceLayout,
  safeLoadWorkspaceLayout,
  toggleWindowMaximized,
} from "@/components/os/kernel/windowManager";
import { WORKSPACES, getWorkspace } from "@/components/os/kernel/workspaceModel";
import { routeIntent } from "@/components/os/kernel/intentRouter";
import {
  approveStep as apiApproveStep,
  executeQuickAction as apiExecuteQuickAction,
  fetchArtifacts,
  fetchLatestIntentBundle,
  recordBehaviorEvent,
  submitIntent as apiSubmitIntent,
  streamRun,
} from "@/components/os/kernel/aiClient";
import { eventBus } from "@/components/os/kernel/eventBus";
import { ensureSupabaseToken } from "@/lib/supabase/browser";
import type {
  ActiveIntentState,
  AppId,
  IntentAttachment,
  IntentMessage,
  IntentStep,
  KernelState,
  NotificationItem,
  OrbVisualState,
  UiQuickAction,
  WorkspaceArtifact,
  WindowRecord,
  Workspace,
} from "@/components/os/kernel/types";

type Action =
  | { type: "SET_WORKSPACE"; workspaceId: string }
  | { type: "SET_OVERLAY"; open: boolean }
  | { type: "SET_ORB_STATE"; state: OrbVisualState }
  | { type: "SET_THINKING"; thinking: boolean }
  | { type: "SET_WINDOWS"; workspaceId: string; windows: WindowRecord[] }
  | { type: "SET_MESSAGES"; workspaceId: string; messages: IntentMessage[] }
  | { type: "ADD_MESSAGE"; workspaceId: string; message: IntentMessage }
  | { type: "ADD_NOTIFICATION"; workspaceId: string; notification: NotificationItem };

type BehaviorEventInput = {
  eventType: "approve_step" | "deny_step" | "edit_output" | "run_completed";
  fieldName?: string | null;
  runId?: string | null;
  intentId?: string | null;
  metadata?: Record<string, unknown>;
};

const initialWorkspaceId = WORKSPACES[0]!.id;

const initialState: KernelState = {
  activeWorkspaceId: initialWorkspaceId,
  overlayOpen: false,
  orbState: "idle",
  thinking: false,
  windowsByWorkspace: {
    [initialWorkspaceId]: [],
  },
  messagesByWorkspace: {
    [initialWorkspaceId]: [],
  },
  notificationsByWorkspace: {
    [initialWorkspaceId]: [],
  },
};

function createEmptyIntentState(): ActiveIntentState {
  return {
    runId: null,
    foundationRunId: null,
    intentId: null,
    text: "",
    kind: "read_only",
    status: "idle",
    model: "Gemini",
    startedAt: null,
    updatedAt: null,
    steps: [],
    logs: [],
  };
}

function pushLog(logs: string[], line: string): string[] {
  return [...logs, line].slice(-120);
}

function touchStep(step: IntentStep, status: IntentStep["status"], detail?: string): IntentStep {
  return {
    ...step,
    status,
    detail: detail ?? step.detail,
    updatedAt: Date.now(),
  };
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStepStatus(status: string): IntentStep["status"] {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "approval_required") return "approval_required";
  if (status === "skipped") return "skipped";
  return "pending";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function reducer(state: KernelState, action: Action): KernelState {
  switch (action.type) {
    case "SET_WORKSPACE":
      return {
        ...state,
        activeWorkspaceId: action.workspaceId,
        overlayOpen: false,
        orbState: "idle",
      };
    case "SET_OVERLAY":
      return { ...state, overlayOpen: action.open };
    case "SET_ORB_STATE":
      return { ...state, orbState: action.state };
    case "SET_THINKING":
      return { ...state, thinking: action.thinking };
    case "SET_WINDOWS":
      return {
        ...state,
        windowsByWorkspace: {
          ...state.windowsByWorkspace,
          [action.workspaceId]: action.windows,
        },
      };
    case "SET_MESSAGES":
      return {
        ...state,
        messagesByWorkspace: {
          ...state.messagesByWorkspace,
          [action.workspaceId]: action.messages.slice(-60),
        },
      };
    case "ADD_MESSAGE": {
      const prev = state.messagesByWorkspace[action.workspaceId] ?? [];
      return {
        ...state,
        messagesByWorkspace: {
          ...state.messagesByWorkspace,
          [action.workspaceId]: [...prev, action.message].slice(-60),
        },
      };
    }
    case "ADD_NOTIFICATION": {
      const prev = state.notificationsByWorkspace[action.workspaceId] ?? [];
      return {
        ...state,
        notificationsByWorkspace: {
          ...state.notificationsByWorkspace,
          [action.workspaceId]: [action.notification, ...prev].slice(0, 20),
        },
      };
    }
    default:
      return state;
  }
}

type KernelContextValue = {
  state: KernelState;
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  activeWindows: WindowRecord[];
  activeMessages: IntentMessage[];
  activeArtifacts: WorkspaceArtifact[];
  activeIntentState: ActiveIntentState;
  openApp: (appId: AppId) => void;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  minimizeWindow: (windowId: string) => void;
  toggleWindowMaximized: (windowId: string) => void;
  moveWindow: (windowId: string, x: number, y: number) => void;
  resizeWindow: (windowId: string, width: number, height: number) => void;
  splitWindows: () => void;
  setActiveWorkspace: (workspaceId: string) => void;
  setOverlayOpen: (open: boolean) => void;
  submitIntent: (text: string, attachments?: IntentAttachment[]) => void;
  executeQuickAction: (action: UiQuickAction) => Promise<void>;
  confirmActiveIntentStep: (stepId?: string) => void;
  denyActiveIntentStep: (stepId?: string) => void;
  cancelActiveIntent: () => void;
  retryActiveIntent: () => void;
  clearActiveIntent: () => void;
  logBehaviorEvent: (input: BehaviorEventInput) => void;
};

const KernelContext = createContext<KernelContextValue | null>(null);

export function KernelProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [intentStateByWorkspace, setIntentStateByWorkspace] = useState<Record<string, ActiveIntentState>>({
    [initialWorkspaceId]: createEmptyIntentState(),
  });
  const [artifactsByWorkspace, setArtifactsByWorkspace] = useState<Record<string, WorkspaceArtifact[]>>({
    [initialWorkspaceId]: [],
  });
  const lastIntentByWorkspaceRef = useRef<Record<string, string>>({});
  const pendingQuickActionApprovalRef = useRef<
    Record<
      string,
      {
        stepId: string;
        runId: string;
        action: UiQuickAction;
        idempotencyKey: string;
      }
    >
  >({});

  const activeWorkspace = useMemo(
    () => getWorkspace(state.activeWorkspaceId),
    [state.activeWorkspaceId],
  );

  const activeWindows = state.windowsByWorkspace[state.activeWorkspaceId] ?? [];
  const activeMessages = state.messagesByWorkspace[state.activeWorkspaceId] ?? [];
  const activeArtifacts = artifactsByWorkspace[state.activeWorkspaceId] ?? [];
  const activeIntentState = intentStateByWorkspace[state.activeWorkspaceId] ?? createEmptyIntentState();

  const updateIntentState = useCallback(
    (workspaceId: string, updater: (previous: ActiveIntentState) => ActiveIntentState) => {
      setIntentStateByWorkspace((previous) => {
        const current = previous[workspaceId] ?? createEmptyIntentState();
        return {
          ...previous,
          [workspaceId]: updater(current),
        };
      });
    },
    [],
  );

  const refreshArtifacts = useCallback(async (workspaceId: string) => {
    try {
      const artifacts = await fetchArtifacts(workspaceId, { limit: 20 });
      setArtifactsByWorkspace((previous) => ({
        ...previous,
        [workspaceId]: artifacts,
      }));
    } catch {
      // Non-blocking; artifact list should not break intent flow.
    }
  }, []);

  const logBehaviorEventInternal = useCallback(
    (input: BehaviorEventInput) => {
      const workspaceId = state.activeWorkspaceId;
      const intent = intentStateByWorkspace[workspaceId] ?? createEmptyIntentState();
      const payload = {
        eventType: input.eventType,
        fieldName: input.fieldName ?? null,
        runId: input.runId ?? intent.foundationRunId ?? intent.runId,
        intentId: input.intentId ?? intent.intentId,
        metadata: input.metadata ?? {},
      };

      void recordBehaviorEvent(workspaceId, payload).catch(() => {
        // Non-blocking: behavior tracking must not break the shell.
      });
    },
    [intentStateByWorkspace, state.activeWorkspaceId],
  );

  // Window layouts are intentionally NOT auto-restored on mount so workspaces start
  // with a clean desktop. Layouts are still saved on every change for history purposes.
  // Users can re-open previous runs via the AGENT tab history.

  useEffect(() => {
    saveWorkspaceLayout(state.activeWorkspaceId, activeWindows);
  }, [activeWindows, state.activeWorkspaceId]);

  useEffect(() => {
    const normalized = normalizeWindowsForViewport(activeWindows);
    if (!hasWindowGeometryChanges(activeWindows, normalized)) return;

    dispatch({
      type: "SET_WINDOWS",
      workspaceId: state.activeWorkspaceId,
      windows: normalized,
    });
  }, [activeWindows, state.activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const payload = await fetchLatestIntentBundle(state.activeWorkspaceId);
        if (cancelled) return;

        if (!payload.bundle) {
          dispatch({ type: "SET_MESSAGES", workspaceId: state.activeWorkspaceId, messages: [] });
          updateIntentState(state.activeWorkspaceId, () => createEmptyIntentState());
          return;
        }

        const nextMessages: IntentMessage[] = payload.bundle.messages.map((message) => {
          const actionCards = Array.isArray(message.metaJson?.actionCards)
            ? (message.metaJson?.actionCards as Array<{ id: string; title: string; detail: string }>)
            : null;

          return {
            id: message.id,
            role: message.role,
            text: message.content,
            createdAt: toTimestamp(message.createdAt) ?? Date.now(),
            ...(actionCards ? { actionCards } : {}),
          };
        });

        const nextSteps: IntentStep[] = payload.bundle.steps.map((step) => ({
          id: step.stepKey,
          label: step.title,
          detail: step.detail ?? "",
          status: toStepStatus(step.status),
          requiresConfirmation: step.requiresApproval,
          updatedAt: toTimestamp(step.updatedAt) ?? Date.now(),
        }));

        dispatch({ type: "SET_MESSAGES", workspaceId: state.activeWorkspaceId, messages: nextMessages });
        updateIntentState(state.activeWorkspaceId, (previous) => ({
          ...previous,
          runId: payload.bundle?.run?.aiRunId ?? null,
          foundationRunId: payload.bundle?.run?.id ?? null,
          intentId: payload.bundle?.intent.id ?? null,
          text: payload.bundle?.intent.text ?? "",
          status:
            payload.bundle?.run?.status === "failed"
              ? "failed"
              : payload.bundle?.run?.status === "completed"
                ? "completed"
                : payload.bundle?.run?.status === "running" || payload.bundle?.run?.status === "awaiting_approval"
                  ? "running"
                  : "idle",
          startedAt: toTimestamp(payload.bundle?.run?.startedAt ?? payload.bundle?.intent.createdAt) ?? null,
          updatedAt: toTimestamp(payload.bundle?.intent.updatedAt) ?? null,
          steps: nextSteps,
          logs: pushLog([], "Hydrated latest intent from workspace history."),
        }));
      } catch {
        if (cancelled) return;
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [state.activeWorkspaceId, updateIntentState]);

  useEffect(() => {
    void refreshArtifacts(state.activeWorkspaceId);
  }, [refreshArtifacts, state.activeWorkspaceId]);

  const setWindows = useCallback(
    (nextWindows: WindowRecord[]) => {
      dispatch({ type: "SET_WINDOWS", workspaceId: state.activeWorkspaceId, windows: nextWindows });
    },
    [state.activeWorkspaceId],
  );

  const onOpenApp = useCallback(
    (appId: AppId) => {
      setWindows(openWindow(activeWindows, appId, state.activeWorkspaceId));
      dispatch({ type: "SET_ORB_STATE", state: "idle" });
      dispatch({ type: "SET_OVERLAY", open: false });
    },
    [activeWindows, setWindows, state.activeWorkspaceId],
  );

  const onCloseWindow = useCallback(
    (windowId: string) => setWindows(closeWindow(activeWindows, windowId)),
    [activeWindows, setWindows],
  );

  const onFocusWindow = useCallback(
    (windowId: string) => setWindows(focusWindow(activeWindows, windowId)),
    [activeWindows, setWindows],
  );

  const onMinimizeWindow = useCallback(
    (windowId: string) => setWindows(minimizeWindow(activeWindows, windowId)),
    [activeWindows, setWindows],
  );

  const onToggleWindowMaximized = useCallback(
    (windowId: string) => setWindows(toggleWindowMaximized(activeWindows, windowId)),
    [activeWindows, setWindows],
  );

  const onMoveWindow = useCallback(
    (windowId: string, x: number, y: number) =>
      setWindows(moveWindow(activeWindows, windowId, { x, y }, state.activeWorkspaceId)),
    [activeWindows, setWindows, state.activeWorkspaceId],
  );

  const onResizeWindow = useCallback(
    (windowId: string, width: number, height: number) =>
      setWindows(resizeWindow(activeWindows, windowId, { width, height }, state.activeWorkspaceId)),
    [activeWindows, setWindows, state.activeWorkspaceId],
  );

  const onSplitWindows = useCallback(
    () => setWindows(arrangeSplitView(activeWindows)),
    [activeWindows, setWindows],
  );

  const onSetActiveWorkspace = useCallback((workspaceId: string) => {
    dispatch({ type: "SET_WORKSPACE", workspaceId });
    // Do NOT restore the saved window layout — workspace switches start clean.
    setIntentStateByWorkspace((previous) => {
      if (previous[workspaceId]) return previous;
      return {
        ...previous,
        [workspaceId]: createEmptyIntentState(),
      };
    });
    setArtifactsByWorkspace((previous) => {
      if (previous[workspaceId]) return previous;
      return {
        ...previous,
        [workspaceId]: [],
      };
    });
  }, []);

  const onSubmitIntent = useCallback(
    (text: string, attachments: IntentAttachment[] = []) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const workspaceId = state.activeWorkspaceId;
      const now = Date.now();
      const routed = routeIntent(trimmed);

      lastIntentByWorkspaceRef.current[workspaceId] = trimmed;

      dispatch({
        type: "ADD_MESSAGE",
        workspaceId,
        message: {
          id: `u-${now}`,
          role: "user",
          text: trimmed,
          createdAt: now,
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      });
      dispatch({ type: "SET_THINKING", thinking: true });
      dispatch({ type: "SET_ORB_STATE", state: "thinking" });

      updateIntentState(workspaceId, () => {
        const steps = routed.timeline.map((step, index) => ({
          id: step.id,
          label: step.label,
          detail: step.detail,
          status: index === 0 ? "running" : "pending",
          updatedAt: now,
          ...(step.requiresConfirmation ? { requiresConfirmation: true } : {}),
        })) satisfies IntentStep[];

        return {
          runId: null,
          foundationRunId: null,
          intentId: null,
          text: trimmed,
          kind: routed.intentKind,
          status: "thinking",
          model: "Gemini",
          startedAt: now,
          updatedAt: now,
          steps,
          ...(attachments.length > 0 ? { attachments } : {}),
          logs: [
            `Intent received: ${trimmed}`,
            `Type: ${routed.intentKind === "read_only" ? "READ_ONLY" : "MUTATION"}`,
          ],
        };
      });

      const runLocal = (delayMs = 260) => {
        window.setTimeout(() => {
          if (routed.openApp) {
            const existing = state.windowsByWorkspace[workspaceId] ?? [];
            dispatch({ type: "SET_WINDOWS", workspaceId, windows: openWindow(existing, routed.openApp, workspaceId) });
          }

          let becameCompleted = false;
          let runDurationMs: number | null = null;

          updateIntentState(workspaceId, (previous) => {
            const nextSteps = previous.steps.map((step) => {
              if (routed.intentKind === "mutation" && step.requiresConfirmation) {
                return touchStep(step, "approval_required");
              }
              return touchStep(step, "completed");
            });

            const runningStatus = routed.intentKind === "mutation" ? "running" : "completed";
            const logs =
              routed.intentKind === "mutation"
                ? pushLog(previous.logs, "Mutation guard active. Waiting for confirmation.")
                : pushLog(previous.logs, "Read-only run completed automatically.");

            if (runningStatus === "completed") {
              becameCompleted = true;
              runDurationMs = previous.startedAt ? Date.now() - previous.startedAt : null;
            }

            return {
              ...previous,
              status: runningStatus,
              steps: nextSteps,
              updatedAt: Date.now(),
              logs,
            };
          });

          dispatch({
            type: "ADD_MESSAGE",
            workspaceId,
            message: {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: routed.assistantText,
              createdAt: Date.now(),
              ...(routed.actionCards ? { actionCards: routed.actionCards } : {}),
            },
          });

          dispatch({ type: "SET_THINKING", thinking: false });
          dispatch({ type: "SET_ORB_STATE", state: routed.intentKind === "mutation" ? "planning" : "idle" });

          const notification: NotificationItem = {
            id: `n-${Date.now()}`,
            workspaceId,
            level: "info",
            text: routed.intentKind === "mutation" ? "Intent ready for confirmation" : "Intent executed",
            createdAt: Date.now(),
          };
          dispatch({ type: "ADD_NOTIFICATION", workspaceId, notification });
          eventBus.emit("notification:new", notification);

          if (becameCompleted) {
            logBehaviorEventInternal({
              eventType: "run_completed",
              metadata: {
                durationMs: runDurationMs,
                source: "local-fallback",
                status: "completed",
              },
            });
          }
        }, delayMs);
      };

      const tryAiService = async () => {
        try {
          const token = await ensureSupabaseToken();
          const openApps = activeWindows.map((window) => window.appId);
          const { runId, intentId, foundationRunId } = await apiSubmitIntent(trimmed, workspaceId, {
            token,
            openApps,
            activeView: state.overlayOpen ? "launcher" : "desktop",
            attachments,
          });

          updateIntentState(workspaceId, (previous) => ({
            ...previous,
            runId,
            intentId: intentId ?? previous.intentId,
            foundationRunId: foundationRunId ?? previous.foundationRunId,
            status: "running",
            updatedAt: Date.now(),
            logs: pushLog(previous.logs, `Remote run started (${runId}).`),
          }));

          streamRun(runId, workspaceId, token, {
            onOrbState: (data) => {
              dispatch({ type: "SET_ORB_STATE", state: data.state as OrbVisualState });
            },
            onStepStarted: (data) => {
              updateIntentState(workspaceId, (previous) => {
                const existingIndex = previous.steps.findIndex((item) => item.id === data.stepId);
                const nextStep: IntentStep = {
                  id: data.stepId,
                  label: data.label,
                  detail: "Running",
                  status: "running",
                  updatedAt: Date.now(),
                };
                const nextSteps =
                  existingIndex >= 0
                    ? previous.steps.map((item, index) => (index === existingIndex ? nextStep : item))
                    : [...previous.steps, nextStep];

                return {
                  ...previous,
                  status: "running",
                  updatedAt: Date.now(),
                  steps: nextSteps,
                  logs: pushLog(previous.logs, `Step started: ${data.label}`),
                };
              });
            },
            onStepCompleted: (data) => {
              updateIntentState(workspaceId, (previous) => {
                const mappedStatus =
                  data.status === "failed"
                    ? "failed"
                    : data.status === "skipped"
                      ? "skipped"
                      : "completed";
                const outputPreview = data.output ? JSON.stringify(data.output).slice(0, 140) : "Completed";
                const nextSteps = previous.steps.map((step) => {
                  if (step.id !== data.stepId) return step;
                  return touchStep(step, mappedStatus, outputPreview);
                });
                return {
                  ...previous,
                  status: mappedStatus === "failed" ? "failed" : previous.status,
                  updatedAt: Date.now(),
                  steps: nextSteps,
                  logs: pushLog(previous.logs, `Step completed: ${data.stepId}`),
                };
              });
            },
            onApprovalRequired: (data) => {
              updateIntentState(workspaceId, (previous) => {
                const existingIndex = previous.steps.findIndex((item) => item.id === data.stepId);
                const nextStep: IntentStep = {
                  id: data.stepId,
                  label: data.label,
                  detail: data.description,
                  status: "approval_required",
                  requiresConfirmation: true,
                  updatedAt: Date.now(),
                };

                const nextSteps =
                  existingIndex >= 0
                    ? previous.steps.map((item, index) => (index === existingIndex ? nextStep : item))
                    : [...previous.steps, nextStep];

                return {
                  ...previous,
                  status: "running",
                  updatedAt: Date.now(),
                  steps: nextSteps,
                  logs: pushLog(previous.logs, `Approval required: ${data.label}`),
                };
              });
              dispatch({ type: "SET_THINKING", thinking: false });
              dispatch({ type: "SET_ORB_STATE", state: "attention" });
            },
            onArtifactCreated: (data) => {
              setArtifactsByWorkspace((previous) => {
                const current = previous[workspaceId] ?? [];
                const existingIndex = current.findIndex((artifact) => artifact.id === data.id);
                const nextArtifact: WorkspaceArtifact = {
                  id: data.id,
                  workspaceId,
                  intentId: data.intentId ?? null,
                  runId: data.runId,
                  type: data.type,
                  title: data.title,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  createdBy: null,
                  latestVersion: 1,
                  payloadRef: data.payloadRef,
                  payloadJson: {},
                };

                if (existingIndex >= 0) {
                  return {
                    ...previous,
                    [workspaceId]: current.map((artifact, index) =>
                      index === existingIndex ? { ...artifact, ...nextArtifact } : artifact,
                    ),
                  };
                }

                return {
                  ...previous,
                  [workspaceId]: [nextArtifact, ...current].slice(0, 20),
                };
              });

              updateIntentState(workspaceId, (previous) => ({
                ...previous,
                logs: pushLog(previous.logs, `Artifact ready: ${data.title}`),
              }));
            },
            onRunCompleted: (data) => {
              dispatch({
                type: "ADD_MESSAGE",
                workspaceId,
                message: {
                  id: `a-${Date.now()}`,
                  role: "assistant",
                  text: data.assistantText,
                  createdAt: Date.now(),
                  ...(data.actionCards ? { actionCards: data.actionCards } : {}),
                },
              });

              updateIntentState(workspaceId, (previous) => {
                const nextSteps = previous.steps.map((step) =>
                  step.status === "running" || step.status === "pending" ? touchStep(step, "completed") : step,
                );
                return {
                  ...previous,
                  status: "completed",
                  updatedAt: Date.now(),
                  steps: nextSteps,
                  logs: pushLog(previous.logs, "Run completed successfully."),
                };
              });

              dispatch({ type: "SET_THINKING", thinking: false });
              dispatch({ type: "SET_ORB_STATE", state: data.actionCards ? "attention" : "idle" });
              void refreshArtifacts(workspaceId);
            },
            onRunFailed: (data) => {
              dispatch({
                type: "ADD_MESSAGE",
                workspaceId,
                message: {
                  id: `err-${Date.now()}`,
                  role: "assistant",
                  text: `Something went wrong: ${data.error}`,
                  createdAt: Date.now(),
                },
              });

              updateIntentState(workspaceId, (previous) => {
                return {
                  ...previous,
                  status: "failed",
                  updatedAt: Date.now(),
                  steps: previous.steps.map((step) =>
                    step.status === "running" ? touchStep(step, "failed", data.error) : step,
                  ),
                  logs: pushLog(previous.logs, `Run failed: ${data.error}`),
                };
              });

              dispatch({ type: "SET_THINKING", thinking: false });
              dispatch({ type: "SET_ORB_STATE", state: "degraded" });
            },
          });
        } catch (aiError) {
          console.warn("[KernelProvider] Primary AI service unavailable:", aiError);
          // ── Gemini fallback ─────────────────────────────────────────────────
          // Try the /api/ai/chat route (Google Gemini) before falling back to
          // the local golden-path. Requires GEMINI_API_KEY in .env.local.
          try {
            const { chatWithGemini } = await import("@/components/os/kernel/aiClient");
            const gemRes = await chatWithGemini(trimmed);
            dispatch({
              type: "ADD_MESSAGE",
              workspaceId,
              message: {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: gemRes.text,
                createdAt: Date.now(),
              },
            });
            updateIntentState(workspaceId, (previous) => ({
              ...previous,
              status: "completed",
              updatedAt: Date.now(),
              steps: previous.steps.map((step) => touchStep(step, "completed")),
              logs: pushLog(previous.logs, "Answered via Gemini fallback."),
            }));
            dispatch({ type: "SET_THINKING", thinking: false });
            dispatch({ type: "SET_ORB_STATE", state: "idle" });
          } catch {
            // Both AI service and Gemini unavailable — use local golden path
            runLocal(280);
          }
        }
      };

      // ── Optimistic app open from routing ────────────────────────────────────
      // Open the target window immediately from intent routing so that e.g.
      // "wie wird das Wetter" always opens WeatherWindow — regardless of what
      // the remote AI service eventually responds with.
      if (routed.openApp) {
        const existing = state.windowsByWorkspace[workspaceId] ?? [];
        dispatch({
          type: "SET_WINDOWS",
          workspaceId,
          windows: openWindow(existing, routed.openApp, workspaceId),
        });
      }

      void tryAiService();
    },
    [
      activeWindows,
      logBehaviorEventInternal,
      refreshArtifacts,
      state.activeWorkspaceId,
      state.overlayOpen,
      state.windowsByWorkspace,
      updateIntentState,
    ],
  );

  const onExecuteQuickAction = useCallback(
    async (action: UiQuickAction) => {
      if (action.state === "disabled" || action.state === "policy_blocked") return;

      const workspaceId = state.activeWorkspaceId;
      const startedAt = Date.now();
      const runId = crypto.randomUUID();
      const idempotencyKey = `${workspaceId}:${action.action_id}:${startedAt}`;
      const stepId = `tool:${action.tool_ref}`;
      const runLabel = action.label || action.intent;
      lastIntentByWorkspaceRef.current[workspaceId] = action.intent;
      delete pendingQuickActionApprovalRef.current[workspaceId];

      dispatch({
        type: "ADD_MESSAGE",
        workspaceId,
        message: {
          id: `u-qa-${startedAt}`,
          role: "user",
          text: action.intent,
          createdAt: startedAt,
        },
      });
      dispatch({ type: "SET_THINKING", thinking: true });
      dispatch({ type: "SET_ORB_STATE", state: "executing" });

      updateIntentState(workspaceId, () => ({
        runId,
        foundationRunId: runId,
        intentId: null,
        text: action.intent,
        kind: "read_only",
        status: "running",
        model: "Gemini",
        startedAt,
        updatedAt: startedAt,
        steps: [
          {
            id: stepId,
            label: runLabel,
            detail: `Executing ${action.tool_ref}`,
            status: "running",
            requiresConfirmation: action.requires_approval,
            updatedAt: startedAt,
          },
        ],
        logs: [`Quick action started: ${action.label}`, `Tool: ${action.tool_ref}`],
      }));

      try {
        const response = await apiExecuteQuickAction({
          workspaceId,
          runId,
          actionId: action.action_id,
          actionLabel: action.label,
          intent: action.intent,
          toolName: action.tool_ref,
          args: {},
          idempotencyKey,
        });

        if (response.execution.status === "waiting_for_auth") {
          updateIntentState(workspaceId, (previous) => ({
            ...previous,
            status: "running",
            updatedAt: Date.now(),
            steps: previous.steps.map((step) =>
              step.id === stepId
                ? touchStep(step, "pending", response.execution.reason ?? "Authentication required")
                : step,
            ),
            logs: pushLog(previous.logs, response.execution.reason ?? "Waiting for integration auth."),
          }));
          dispatch({ type: "SET_THINKING", thinking: false });
          dispatch({ type: "SET_ORB_STATE", state: "waiting_for_auth" });
          return;
        }

        if (response.execution.status === "waiting_for_approval") {
          const waitingStepId = response.execution.tool_call_id ?? stepId;
          pendingQuickActionApprovalRef.current[workspaceId] = {
            stepId: waitingStepId,
            runId: response.run_id,
            action,
            idempotencyKey,
          };
          updateIntentState(workspaceId, (previous) => ({
            ...previous,
            runId: response.run_id,
            foundationRunId: response.run_id,
            status: "running",
            updatedAt: Date.now(),
            steps: [
              {
                id: waitingStepId,
                label: runLabel,
                detail: response.execution.reason ?? "Approval required",
                status: "approval_required",
                requiresConfirmation: true,
                updatedAt: Date.now(),
              },
            ],
            logs: pushLog(previous.logs, response.execution.reason ?? "Waiting for approval."),
          }));
          dispatch({ type: "SET_THINKING", thinking: false });
          dispatch({ type: "SET_ORB_STATE", state: "waiting_for_approval" });
          return;
        }

        const nextArtifacts: WorkspaceArtifact[] = response.artifacts.map((artifact) => ({
          id: artifact.id,
          workspaceId: artifact.workspace_id,
          intentId: null,
          runId: artifact.run_id,
          toolCallId: artifact.tool_call_id,
          type: artifact.artifact_type,
          uiCardHint: artifact.ui_card_hint,
          linkUrl: artifact.link_url,
          title: artifact.title,
          createdAt: artifact.created_at,
          updatedAt: artifact.updated_at,
          createdBy: null,
          latestVersion: 1,
          payloadRef: artifact.link_url,
          payloadJson: asRecord(artifact.payload_json),
        }));

        if (nextArtifacts.length > 0) {
          setArtifactsByWorkspace((previous) => ({
            ...previous,
            [workspaceId]: [...nextArtifacts, ...(previous[workspaceId] ?? [])].slice(0, 30),
          }));
        }

        updateIntentState(workspaceId, (previous) => ({
          ...previous,
          runId: response.run_id,
          foundationRunId: response.run_id,
          status: "completed",
          updatedAt: Date.now(),
          steps: previous.steps.map((step) =>
            step.id === stepId
              ? touchStep(
                  step,
                  "completed",
                  response.execution.ui_card_hint ?? "Completed",
                )
              : step,
          ),
          logs: pushLog(previous.logs, `Quick action completed (${action.label}).`),
        }));

        dispatch({
          type: "ADD_MESSAGE",
          workspaceId,
          message: {
            id: `a-qa-${Date.now()}`,
            role: "assistant",
            text: `Completed: ${action.label}`,
            createdAt: Date.now(),
          },
        });
        dispatch({ type: "SET_THINKING", thinking: false });
        dispatch({ type: "SET_ORB_STATE", state: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Quick action failed";
        updateIntentState(workspaceId, (previous) => ({
          ...previous,
          status: "failed",
          updatedAt: Date.now(),
          steps: previous.steps.map((step) =>
            step.id === stepId ? touchStep(step, "failed", message) : step,
          ),
          logs: pushLog(previous.logs, `Quick action failed: ${message}`),
        }));
        dispatch({
          type: "ADD_MESSAGE",
          workspaceId,
          message: {
            id: `err-qa-${Date.now()}`,
            role: "assistant",
            text: `Quick action failed: ${message}`,
            createdAt: Date.now(),
          },
        });
        dispatch({ type: "SET_THINKING", thinking: false });
        dispatch({ type: "SET_ORB_STATE", state: "degraded" });
      }
    },
    [state.activeWorkspaceId, updateIntentState],
  );

  const onConfirmActiveIntentStep = useCallback(
    (stepId?: string) => {
      const workspaceId = state.activeWorkspaceId;
      const pendingQuickApproval = pendingQuickActionApprovalRef.current[workspaceId];
      if (pendingQuickApproval) {
        const selectedStepId = stepId ?? activeIntentState.steps.find((step) => step.status === "approval_required")?.id;
        if (selectedStepId && selectedStepId !== pendingQuickApproval.stepId) {
          return;
        }

        dispatch({ type: "SET_THINKING", thinking: true });
        dispatch({ type: "SET_ORB_STATE", state: "executing" });

        void (async () => {
          try {
            const approved = await apiExecuteQuickAction({
              workspaceId,
              runId: pendingQuickApproval.runId,
              actionId: pendingQuickApproval.action.action_id,
              actionLabel: pendingQuickApproval.action.label,
              intent: pendingQuickApproval.action.intent,
              toolName: pendingQuickApproval.action.tool_ref,
              args: {},
              idempotencyKey: `${pendingQuickApproval.idempotencyKey}:approved`,
              approvalGranted: true,
            });

            const nextArtifacts: WorkspaceArtifact[] = approved.artifacts.map((artifact) => ({
              id: artifact.id,
              workspaceId: artifact.workspace_id,
              intentId: null,
              runId: artifact.run_id,
              toolCallId: artifact.tool_call_id,
              type: artifact.artifact_type,
              uiCardHint: artifact.ui_card_hint,
              linkUrl: artifact.link_url,
              title: artifact.title,
              createdAt: artifact.created_at,
              updatedAt: artifact.updated_at,
              createdBy: null,
              latestVersion: 1,
              payloadRef: artifact.link_url,
              payloadJson: asRecord(artifact.payload_json),
            }));
            if (nextArtifacts.length > 0) {
              setArtifactsByWorkspace((previous) => ({
                ...previous,
                [workspaceId]: [...nextArtifacts, ...(previous[workspaceId] ?? [])].slice(0, 30),
              }));
            }

            updateIntentState(workspaceId, (previous) => ({
              ...previous,
              runId: approved.run_id,
              foundationRunId: approved.run_id,
              status: "completed",
              updatedAt: Date.now(),
              steps: previous.steps.map((step) =>
                step.id === pendingQuickApproval.stepId
                  ? touchStep(step, "completed", "Approved and applied")
                  : step,
              ),
              logs: pushLog(previous.logs, `Approved: ${pendingQuickApproval.action.label}`),
            }));
            dispatch({
              type: "ADD_MESSAGE",
              workspaceId,
              message: {
                id: `confirm-qa-${Date.now()}`,
                role: "assistant",
                text: `${pendingQuickApproval.action.label} approved and executed.`,
                createdAt: Date.now(),
              },
            });
            dispatch({ type: "SET_THINKING", thinking: false });
            dispatch({ type: "SET_ORB_STATE", state: "success" });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Approval execution failed";
            updateIntentState(workspaceId, (previous) => ({
              ...previous,
              status: "failed",
              updatedAt: Date.now(),
              steps: previous.steps.map((step) =>
                step.id === pendingQuickApproval.stepId ? touchStep(step, "failed", message) : step,
              ),
              logs: pushLog(previous.logs, `Approval failed: ${message}`),
            }));
            dispatch({ type: "SET_THINKING", thinking: false });
            dispatch({ type: "SET_ORB_STATE", state: "degraded" });
          } finally {
            delete pendingQuickActionApprovalRef.current[workspaceId];
          }
        })();

        return;
      }

      let confirmed = false;
      let confirmedLabel = "step";
      let confirmedStepId: string | null = null;
      let runId: string | null = null;
      let foundationRunId: string | null = null;
      let intentId: string | null = null;
      let runDurationMs: number | null = null;

      updateIntentState(workspaceId, (previous) => {
        const target =
          previous.steps.find((step) => step.id === stepId) ??
          previous.steps.find((step) => step.status === "approval_required");

        if (!target) return previous;

        confirmed = true;
        confirmedLabel = target.label;
        confirmedStepId = target.id;
        runId = previous.runId;
        foundationRunId = previous.foundationRunId;
        intentId = previous.intentId;

        const nextSteps = previous.steps.map((step) => {
          if (step.id !== target.id) return step;
          return touchStep(step, "completed", "Confirmed and applied");
        });

        const hasOpenApproval = nextSteps.some((step) => step.status === "approval_required");
        const nextStatus = hasOpenApproval ? "running" : "completed";
        if (nextStatus === "completed") {
          runDurationMs = previous.startedAt ? Date.now() - previous.startedAt : null;
        }

        return {
          ...previous,
          status: nextStatus,
          updatedAt: Date.now(),
          steps: nextSteps,
          logs: pushLog(previous.logs, `Confirmed: ${target.label}`),
        };
      });

      if (!confirmed) return;

      if (runId && confirmedStepId) {
        void apiApproveStep(runId, confirmedStepId, "approve", workspaceId).catch(() => {
          logBehaviorEventInternal({
            eventType: "approve_step",
            fieldName: confirmedStepId,
            runId: foundationRunId ?? runId,
            intentId,
            metadata: {
              source: "ely-rail-fallback",
              stepLabel: confirmedLabel,
            },
          });
        });
      } else {
        logBehaviorEventInternal({
          eventType: "approve_step",
          fieldName: confirmedStepId,
          runId: foundationRunId ?? runId,
          intentId,
          metadata: {
            source: "ely-rail",
            stepLabel: confirmedLabel,
          },
        });
      }

      dispatch({
        type: "ADD_MESSAGE",
        workspaceId,
        message: {
          id: `confirm-${Date.now()}`,
          role: "assistant",
          text: `${confirmedLabel} confirmed. Mutation applied successfully.`,
          createdAt: Date.now(),
        },
      });
      dispatch({ type: "SET_THINKING", thinking: false });
      dispatch({ type: "SET_ORB_STATE", state: "idle" });

      if (runDurationMs !== null) {
        logBehaviorEventInternal({
          eventType: "run_completed",
          runId: foundationRunId ?? runId,
          intentId,
          metadata: {
            durationMs: runDurationMs,
            status: "completed",
            source: "approval-confirmation",
          },
        });
      }
    },
    [activeIntentState.steps, logBehaviorEventInternal, state.activeWorkspaceId, updateIntentState],
  );

  const onDenyActiveIntentStep = useCallback(
    (stepId?: string) => {
      const workspaceId = state.activeWorkspaceId;
      const pendingQuickApproval = pendingQuickActionApprovalRef.current[workspaceId];
      if (pendingQuickApproval) {
        const selectedStepId = stepId ?? activeIntentState.steps.find((step) => step.status === "approval_required")?.id;
        if (!selectedStepId || selectedStepId === pendingQuickApproval.stepId) {
          delete pendingQuickActionApprovalRef.current[workspaceId];
        }
      }
      let denied = false;
      let deniedLabel = "step";
      let deniedStepId: string | null = null;
      let runId: string | null = null;
      let foundationRunId: string | null = null;
      let intentId: string | null = null;

      updateIntentState(workspaceId, (previous) => {
        const target =
          previous.steps.find((step) => step.id === stepId) ??
          previous.steps.find((step) => step.status === "approval_required");

        if (!target) return previous;

        denied = true;
        deniedLabel = target.label;
        deniedStepId = target.id;
        runId = previous.runId;
        foundationRunId = previous.foundationRunId;
        intentId = previous.intentId;

        const nextSteps = previous.steps.map((step) => {
          if (step.id !== target.id) return step;
          return touchStep(step, "failed", "Denied by user");
        });

        return {
          ...previous,
          status: "failed",
          updatedAt: Date.now(),
          steps: nextSteps,
          logs: pushLog(previous.logs, `Denied: ${target.label}`),
        };
      });

      if (!denied) return;

      if (runId && deniedStepId) {
        void apiApproveStep(runId, deniedStepId, "reject", workspaceId).catch(() => {
          logBehaviorEventInternal({
            eventType: "deny_step",
            fieldName: deniedStepId,
            runId: foundationRunId ?? runId,
            intentId,
            metadata: {
              source: "ely-rail-fallback",
              stepLabel: deniedLabel,
            },
          });
        });
      } else {
        logBehaviorEventInternal({
          eventType: "deny_step",
          fieldName: deniedStepId,
          runId: foundationRunId ?? runId,
          intentId,
          metadata: {
            source: "ely-rail",
            stepLabel: deniedLabel,
          },
        });
      }

      dispatch({
        type: "ADD_MESSAGE",
        workspaceId,
        message: {
          id: `deny-${Date.now()}`,
          role: "assistant",
          text: `${deniedLabel} denied. Run stopped before applying changes.`,
          createdAt: Date.now(),
        },
      });
      dispatch({ type: "SET_THINKING", thinking: false });
      dispatch({ type: "SET_ORB_STATE", state: "degraded" });

    },
    [activeIntentState.steps, logBehaviorEventInternal, state.activeWorkspaceId, updateIntentState],
  );

  const onCancelActiveIntent = useCallback(() => {
    const workspaceId = state.activeWorkspaceId;

    updateIntentState(workspaceId, (previous) => ({
      ...previous,
      status: "failed",
      updatedAt: Date.now(),
      steps: previous.steps.map((step) =>
        step.status === "running" || step.status === "approval_required" ? touchStep(step, "failed", "Cancelled") : step,
      ),
      logs: pushLog(previous.logs, "Intent cancelled."),
    }));

    dispatch({
      type: "ADD_MESSAGE",
      workspaceId,
      message: {
        id: `cancel-${Date.now()}`,
        role: "assistant",
        text: "Intent was cancelled.",
        createdAt: Date.now(),
      },
    });

    dispatch({ type: "SET_THINKING", thinking: false });
    dispatch({ type: "SET_ORB_STATE", state: "degraded" });
  }, [state.activeWorkspaceId, updateIntentState]);

  const onClearActiveIntent = useCallback(() => {
    const workspaceId = state.activeWorkspaceId;
    updateIntentState(workspaceId, () => createEmptyIntentState());
    dispatch({ type: "SET_MESSAGES", workspaceId, messages: [] });
    dispatch({ type: "SET_THINKING", thinking: false });
    dispatch({ type: "SET_ORB_STATE", state: "idle" });
  }, [state.activeWorkspaceId, updateIntentState]);

  const onRetryActiveIntent = useCallback(() => {
    const workspaceId = state.activeWorkspaceId;
    const candidate = lastIntentByWorkspaceRef.current[workspaceId] ?? activeIntentState.text;
    if (!candidate) return;
    onSubmitIntent(candidate);
  }, [activeIntentState.text, onSubmitIntent, state.activeWorkspaceId]);

  const setOverlayOpen = useCallback((open: boolean) => {
    queueMicrotask(() => {
      dispatch({ type: "SET_OVERLAY", open });
    });
  }, [dispatch]);

  const value = useMemo<KernelContextValue>(
    () => ({
      state,
      workspaces: WORKSPACES,
      activeWorkspace,
      activeWindows,
      activeMessages,
      activeArtifacts,
      activeIntentState,
      openApp: onOpenApp,
      closeWindow: onCloseWindow,
      focusWindow: onFocusWindow,
      minimizeWindow: onMinimizeWindow,
      toggleWindowMaximized: onToggleWindowMaximized,
      moveWindow: onMoveWindow,
      resizeWindow: onResizeWindow,
      splitWindows: onSplitWindows,
      setActiveWorkspace: onSetActiveWorkspace,
      setOverlayOpen,
      submitIntent: onSubmitIntent,
      executeQuickAction: onExecuteQuickAction,
      confirmActiveIntentStep: onConfirmActiveIntentStep,
      denyActiveIntentStep: onDenyActiveIntentStep,
      cancelActiveIntent: onCancelActiveIntent,
      retryActiveIntent: onRetryActiveIntent,
      clearActiveIntent: onClearActiveIntent,
      logBehaviorEvent: logBehaviorEventInternal,
    }),
    [
      state,
      activeWorkspace,
      activeWindows,
      activeMessages,
      activeArtifacts,
      activeIntentState,
      onOpenApp,
      onCloseWindow,
      onFocusWindow,
      onMinimizeWindow,
      onToggleWindowMaximized,
      onMoveWindow,
      onResizeWindow,
      onSplitWindows,
      onSetActiveWorkspace,
      onSubmitIntent,
      onExecuteQuickAction,
      onConfirmActiveIntentStep,
      onDenyActiveIntentStep,
      onCancelActiveIntent,
      onRetryActiveIntent,
      onClearActiveIntent,
      logBehaviorEventInternal,
      setOverlayOpen,
    ],
  );

  return <KernelContext.Provider value={value}>{children}</KernelContext.Provider>;
}

export function useKernel() {
  const context = useContext(KernelContext);
  if (!context) {
    throw new Error("useKernel must be used within KernelProvider");
  }
  return context;
}
