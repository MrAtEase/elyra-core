import { ensureSupabaseToken } from "@/lib/supabase/browser";
import type { AppId, IntentAttachment, WorkspaceArtifact, WorkspaceKind } from "@/components/os/kernel/types";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8788";

type IntentResponse = {
  runId: string;
  intentId?: string;
  foundationRunId?: string;
  plan: { summary: string; steps: Array<{ label: string }> };
};

type SSEHandler = {
  onStepStarted?: (data: { stepId: string; index: number; label: string }) => void;
  onStepCompleted?: (data: { stepId: string; status: string; output: Record<string, unknown> | null }) => void;
  onApprovalRequired?: (data: { stepId: string; label: string; description: string }) => void;
  onArtifactCreated?: (data: {
    id: string;
    type: string;
    title: string;
    runId: string | null;
    intentId: string | null;
    payloadRef: string | null;
  }) => void;
  onRunCompleted?: (data: {
    runId: string;
    assistantText: string;
    actionCards?: Array<{ id: string; title: string; detail: string; openApp?: AppId; artifactId?: string }>;
  }) => void;
  onRunFailed?: (data: { runId: string; error: string }) => void;
  onOrbState?: (data: { state: string }) => void;
};

type SubmitIntentOptions = {
  token?: string;
  openApps?: string[];
  activeView?: string | null;
  attachments?: IntentAttachment[];
};

export type WorkspaceBrainProfile = {
  kind: WorkspaceKind;
  purpose?: string;
  goals?: string[];
  operatingRules?: string[];
  preferences?: {
    language?: string;
    tone?: string;
    /** C-suite AI persona (COO/CFO/CMO/CTO/CPO) for company workspaces. */
    aiRole?: string;
  };
  displayName?: string;
  organizationName?: string;
  roleFocus?: string;
  operatingRhythm?: string;
  platformName?: string;
  governanceMode?: string;
  priority?: string;
};

export type WorkspaceBrainResponse = {
  workspace: {
    id: string;
    slug: string | null;
    name: string;
    kind: WorkspaceKind;
  };
  profile: WorkspaceBrainProfile;
};

type ArtifactsResponse = {
  workspaceId: string;
  artifacts: WorkspaceArtifact[];
};

type ArtifactDetailResponse = {
  workspaceId: string;
  artifact: WorkspaceArtifact;
};

export type QuickActionExecutionStatus = "succeeded" | "waiting_for_auth" | "waiting_for_approval";

export type QuickActionExecutionResponse = {
  ok: boolean;
  run_id: string;
  action_id: string;
  execution: {
    status: QuickActionExecutionStatus;
    tool_call_id?: string;
    result?: Record<string, unknown>;
    error_code?: string;
    reason?: string;
    ui_card_hint?: string;
  };
  artifacts: Array<{
    id: string;
    workspace_id: string;
    run_id: string;
    tool_call_id: string;
    artifact_type: string;
    title: string;
    ui_card_hint: string;
    link_url: string | null;
    payload_json: Record<string, unknown>;
    metadata_json: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
  error_code?: string;
  message?: string;
  degraded_mode?: boolean;
  local_execution_allowed?: boolean;
};

export type LatestIntentPayload = {
  workspaceId: string;
  bundle: {
    intent: {
      id: string;
      text: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    };
    messages: Array<{
      id: string;
      intentId: string;
      workspaceId: string;
      role: "user" | "assistant" | "system";
      content: string;
      createdAt: string;
      metaJson?: Record<string, unknown>;
    }>;
    run: {
      id: string;
      aiRunId: string | null;
      status: string;
      summary: string | null;
      startedAt: string;
      completedAt: string | null;
      durationMs: number | null;
    } | null;
    steps: Array<{
      id: string;
      stepKey: string;
      title: string;
      detail: string | null;
      status: string;
      requiresApproval: boolean;
      updatedAt: string;
    }>;
  } | null;
};

export type RunEventsPayload = {
  ok: boolean;
  workspace_id: string;
  run_id: string;
  events: Array<{
    id: string;
    event_type: string;
    tool_call_id: string | null;
    payload_json: Record<string, unknown>;
    created_at: string;
  }>;
  read_model: {
    status: string;
    last_event_at: string | null;
    timeline: Array<{ at: string; type: string; summary: string; tool_call_id: string | null }>;
  };
};

type BehaviorEventPayload = {
  eventType: "approve_step" | "deny_step" | "edit_output" | "run_completed";
  runId?: string | null;
  intentId?: string | null;
  fieldName?: string | null;
  metadata?: Record<string, unknown>;
};

async function resolveToken(token?: string): Promise<string> {
  if (token && token.trim()) return token.trim();
  try {
    return await ensureSupabaseToken();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[aiClient] using dev fallback token", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return "dev-fallback-token";
    }
    throw error;
  }
}

export async function submitIntent(
  prompt: string,
  workspaceId: string,
  options: SubmitIntentOptions = {},
): Promise<IntentResponse> {
  const token = await resolveToken(options.token);
  const res = await fetch(`${AI_SERVICE_URL}/v1/intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({
      prompt,
      workspaceId,
      openApps: options.openApps ?? [],
      activeView: options.activeView ?? null,
      attachments: options.attachments,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<IntentResponse>;
}

export function streamRun(
  runId: string,
  workspaceId: string,
  token: string,
  handlers: SSEHandler,
): () => void {
  const url = new URL(`${AI_SERVICE_URL}/v1/runs/${runId}/stream`);
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("access_token", token);

  const eventSource = new EventSource(url.toString());

  eventSource.addEventListener("step.started", (event) => {
    handlers.onStepStarted?.(JSON.parse((event as MessageEvent).data));
  });

  eventSource.addEventListener("step.completed", (event) => {
    handlers.onStepCompleted?.(JSON.parse((event as MessageEvent).data));
  });

  eventSource.addEventListener("step.approval_required", (event) => {
    handlers.onApprovalRequired?.(JSON.parse((event as MessageEvent).data));
  });

  eventSource.addEventListener("artifact.created", (event) => {
    handlers.onArtifactCreated?.(JSON.parse((event as MessageEvent).data));
  });

  eventSource.addEventListener("run.completed", (event) => {
    handlers.onRunCompleted?.(JSON.parse((event as MessageEvent).data));
    eventSource.close();
  });

  eventSource.addEventListener("run.failed", (event) => {
    handlers.onRunFailed?.(JSON.parse((event as MessageEvent).data));
    eventSource.close();
  });

  eventSource.addEventListener("orb.state", (event) => {
    handlers.onOrbState?.(JSON.parse((event as MessageEvent).data));
  });

  eventSource.onerror = () => {
    eventSource.close();
  };

  return () => eventSource.close();
}

export async function approveStep(
  runId: string,
  stepId: string,
  action: "approve" | "reject",
  workspaceId: string,
  token?: string,
): Promise<void> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`${AI_SERVICE_URL}/v1/runs/${runId}/approve`);
  url.searchParams.set("workspaceId", workspaceId);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedToken}`,
    },
    body: JSON.stringify({ stepId, action }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Approval request failed" }));
    throw new Error((payload as { message?: string }).message ?? `HTTP ${response.status}`);
  }
}

export async function fetchLatestIntentBundle(
  workspaceId: string,
  token?: string,
): Promise<LatestIntentPayload> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`${AI_SERVICE_URL}/v1/intents/latest`);
  url.searchParams.set("workspaceId", workspaceId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Failed to load latest intent" }));
    throw new Error((payload as { message?: string }).message ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<LatestIntentPayload>;
}

export async function recordBehaviorEvent(
  workspaceId: string,
  payload: BehaviorEventPayload,
  token?: string,
): Promise<void> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`${AI_SERVICE_URL}/v1/behavior-events`);
  url.searchParams.set("workspaceId", workspaceId);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "Behavior event failed" }));
    throw new Error((err as { message?: string }).message ?? `HTTP ${response.status}`);
  }
}

export async function fetchWorkspaceBrain(
  workspaceId: string,
  token?: string,
): Promise<WorkspaceBrainResponse> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`/api/v1/workspace-brain/`, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  url.searchParams.set("workspaceId", workspaceId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Failed to load workspace brain" }));
    throw new Error((payload as { message?: string }).message ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<WorkspaceBrainResponse>;
}

export async function saveWorkspaceBrain(
  workspaceId: string,
  profile: Omit<WorkspaceBrainProfile, "kind"> & { kind?: WorkspaceKind },
  token?: string,
): Promise<{ workspaceId: string; profile: WorkspaceBrainProfile }> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`/api/v1/workspace-brain/`, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  url.searchParams.set("workspaceId", workspaceId);

  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedToken}`,
    },
    body: JSON.stringify({
      profile,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Failed to save workspace brain" }));
    throw new Error((payload as { message?: string }).message ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<{ workspaceId: string; profile: WorkspaceBrainProfile }>;
}

export async function fetchArtifacts(
  workspaceId: string,
  options: {
    type?: string;
    runId?: string;
    limit?: number;
  } = {},
  token?: string,
): Promise<WorkspaceArtifact[]> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`${AI_SERVICE_URL}/v1/artifacts`);
  url.searchParams.set("workspaceId", workspaceId);
  if (options.type) {
    url.searchParams.set("type", options.type);
  }
  if (options.runId) {
    url.searchParams.set("runId", options.runId);
  }
  if (typeof options.limit === "number") {
    url.searchParams.set("limit", String(options.limit));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Failed to load artifacts" }));
    throw new Error((payload as { message?: string }).message ?? `HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ArtifactsResponse;
  return payload.artifacts ?? [];
}

export async function fetchArtifactById(
  artifactId: string,
  workspaceId: string,
  token?: string,
): Promise<WorkspaceArtifact> {
  const resolvedToken = await resolveToken(token);
  const url = new URL(`${AI_SERVICE_URL}/v1/artifacts/${encodeURIComponent(artifactId)}`);
  url.searchParams.set("workspaceId", workspaceId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${resolvedToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: "Failed to load artifact" }));
    throw new Error((payload as { message?: string }).message ?? `HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ArtifactDetailResponse;
  return payload.artifact;
}

export async function executeQuickAction(input: {
  workspaceId: string;
  runId?: string;
  actionId: string;
  actionLabel: string;
  intent: string;
  toolName: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  approvalGranted?: boolean;
}): Promise<QuickActionExecutionResponse> {
  const headers = await withSupabaseAuthorization({
    "Content-Type": "application/json",
  });
  const response = await fetch("/api/os/runs/quick-action", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      run_id: input.runId,
      action_id: input.actionId,
      action_label: input.actionLabel,
      intent: input.intent,
      tool_name: input.toolName,
      args: input.args,
      idempotency_key: input.idempotencyKey,
      approval_granted: input.approvalGranted,
    }),
  });

  const payload = (await response.json().catch(() => null)) as QuickActionExecutionResponse | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.message ?? payload?.error_code ?? `HTTP ${response.status}`);
  }
  if (!payload.ok) {
    if (payload.degraded_mode || payload.error_code === "BACKBONE_UNAVAILABLE") {
      throw new Error("Degraded mode: Worker backbone unavailable. Local execution is disabled.");
    }
    throw new Error(payload.message ?? payload.error_code ?? "Quick action failed");
  }
  return payload;
}

export async function checkAiServiceHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${AI_SERVICE_URL}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getRunEvents(runId: string): Promise<RunEventsPayload> {
  const headers = await withSupabaseAuthorization();
  const response = await fetch(`/api/os/runs/${encodeURIComponent(runId)}/events`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers,
  });
  const payload = (await response.json().catch(() => null)) as RunEventsPayload | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(`Unable to load run events (${response.status})`);
  }
  return payload;
}

// ── Direct Gemini chat ────────────────────────────────────────────────────────
// Calls the local /api/ai/chat Next.js route which proxies to Google Gemini
// 2.0 Flash with Google Search grounding. Requires GEMINI_API_KEY in .env.local.
// Used as a fallback when the primary AI service (localhost:8788) is unreachable.
export async function chatWithGemini(
  message: string,
  opts: { workspaceName?: string; history?: Array<{ role: string; text: string }> } = {},
): Promise<{ text: string; model?: string }> {
  const preferences =
    typeof window !== "undefined"
      ? (() => {
          try {
            const raw = window.localStorage.getItem("elyra_ai_preferences");
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            return parsed && typeof parsed === "object" ? parsed : null;
          } catch {
            return null;
          }
        })()
      : null;
  const resp = await fetch("/api/ai/chat/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      workspaceName: opts.workspaceName,
      history: opts.history,
      preferences,
    }),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({ error: "Gemini route failed" }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Gemini route: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<{ text: string; model?: string }>;
}
