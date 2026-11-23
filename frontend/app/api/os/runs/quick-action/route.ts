import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  executeToolCall,
  mapExecutionErrorToResponse,
  ToolExecutionError,
} from "@/lib/orb-os/tools/execution";
import { appendRunEvent } from "@/lib/orb-os/events/store";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import { enforceToolExecution } from "@/lib/orb-os/security/enforcement";
import { createWorkerBackboneClient, runToTerminalState } from "@/lib/orb-os/runtime/backbone";
import { isWorkerBackboneMode } from "@/lib/orb-os/runtime/workerProxy";
import { emitMetricSample } from "@/lib/orb-os/observability/store";
import { resolveWorkerAuthorizationHeader, resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

const quickActionRequestSchema = z.object({
  workspace_id: z.string().min(1),
  run_id: z.string().min(1).optional(),
  action_id: z.string().min(1),
  action_label: z.string().min(1),
  intent: z.string().min(1),
  tool_name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  idempotency_key: z.string().min(6).max(160),
  approval_granted: z.boolean().optional(),
});

type WhoamiIdentity = {
  workspaceId: string | null;
  userId: string | null;
};

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

function parseWhoamiIdentity(payload: WhoamiResponse): WhoamiIdentity {
  return {
    workspaceId: payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId || null,
    userId: payload.user?.id || payload.userId || payload.userKey || null,
  };
}

function collectWorkspaceCandidates(payload: WhoamiResponse): Set<string> {
  const values = new Set<string>();
  const add = (candidate: string | null | undefined) => {
    if (!candidate?.trim()) return;
    values.add(candidate);
    const normalized = normalizeWorkspaceId(candidate);
    if (normalized) values.add(normalized);
  };
  add(payload.activeWorkspace?.id);
  add(payload.activeWorkspace?.slug);
  add(payload.session?.activeWorkspaceId);
  add(payload.workspaceId);
  for (const workspace of payload.workspaces ?? []) {
    add(workspace.id);
    add(workspace.slug);
  }
  return values;
}

async function ensureRunRecord(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  intent: string;
  actionId: string;
  actionLabel: string;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const planJson = {
    source: "quick_action",
    action_id: input.actionId,
    action_label: input.actionLabel,
  };

  const existing = await supabase
    .from("orchestration_runs")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.runId)
    .maybeSingle();

  if (existing.data?.id) {
    await supabase
      .from("orchestration_runs")
      .update({
        status: "executing",
        current_step_id: input.actionId,
        updated_at: now,
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.runId);
    return;
  }

  await supabase.from("orchestration_runs").insert({
    id: input.runId,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    status: "executing",
    intent: input.intent,
    plan_json: planJson,
    current_step_id: input.actionId,
    started_at: now,
    updated_at: now,
  });
}

async function setRunStatus(input: {
  workspaceId: string;
  runId: string;
  status: "executing" | "done" | "failed";
  error?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  await supabase
    .from("orchestration_runs")
    .update({
      status: input.status,
      error: input.error ?? null,
      finished_at: input.status === "done" || input.status === "failed" ? now : null,
      updated_at: now,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.runId);
}

async function executeViaWorkerBackbone(input: {
  cookieHeader: string | null;
  authorizationHeader: string | null;
  actionId: string;
  intent: string;
  toolName: string;
  args: Record<string, unknown>;
}) {
  const client = createWorkerBackboneClient({
    cookieHeader: input.cookieHeader,
    authorizationHeader: input.authorizationHeader,
  });
  const created = await client.createRun({
    intent_text: input.intent,
    nodes: [
      {
        id: input.actionId,
        type: "tool",
        tool_name: input.toolName,
        input: input.args,
      },
    ],
  });

  const terminal = await runToTerminalState({
    client,
    runId: created.run.id,
    maxTicks: 15,
    tickDelayMs: 40,
  });
  const detail = await client.getRun(created.run.id);
  const toolCall = Array.isArray(detail.tool_calls) && detail.tool_calls.length > 0
    ? (detail.tool_calls[detail.tool_calls.length - 1] as Record<string, unknown>)
    : null;

  const status =
    terminal.run.status === "succeeded"
      ? "succeeded"
      : terminal.run.status === "waiting_for_approval"
        ? "waiting_for_approval"
        : terminal.run.status === "failed"
          ? "failed"
          : "waiting_for_auth";

  return {
    ok: true,
    run_id: created.run.id,
    action_id: input.actionId,
    execution: {
      status,
      tool_call_id: typeof toolCall?.id === "string" ? toolCall.id : undefined,
      reason: status === "failed" ? "worker_run_failed" : undefined,
    },
    artifacts: detail.artifacts ?? [],
  };
}

export async function POST(request: NextRequest) {
  const sessionHeaders = resolveWorkerSessionHeaders(request);
  const cookieHeader = sessionHeaders.get("cookie");
  const authorizationHeader = resolveWorkerAuthorizationHeader(request);
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error_code: "AUTH_REQUIRED", message: "Unable to validate session" }, { status: response.status });
  }

  const parsed = quickActionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "INVALID_INPUT",
        message: "Invalid quick action payload",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const identity = parseWhoamiIdentity(payload);
  const requestedWorkspaceId = normalizeWorkspaceId(parsed.data.workspace_id) ?? parsed.data.workspace_id;
  const activeWorkspaceId = normalizeWorkspaceId(identity.workspaceId) ?? identity.workspaceId;
  const allowedWorkspaceIds = collectWorkspaceCandidates(payload);
  if (
    !activeWorkspaceId ||
    (activeWorkspaceId !== requestedWorkspaceId && !allowedWorkspaceIds.has(requestedWorkspaceId))
  ) {
    return NextResponse.json(
      { ok: false, error_code: "WORKSPACE_SCOPE_MISMATCH", message: "workspace_id does not match active session workspace" },
      { status: 403 },
    );
  }
  // Canonicalize to avoid ws/person slug mismatches in downstream DB access.
  parsed.data.workspace_id = requestedWorkspaceId;
  if (!identity.userId) {
    return NextResponse.json({ ok: false, error_code: "INVALID_USER", message: "Missing user session identity" }, { status: 401 });
  }
  const role = (payload.membership?.role || "member").toLowerCase();
  const contract = await buildBootstrapContractFromDb(parsed.data.workspace_id, {
    userId: identity.userId,
    seedIfMissing: true,
  });
  const decision = enforceToolExecution({
    role,
    contract,
    workspaceId: activeWorkspaceId ?? parsed.data.workspace_id,
    requestedWorkspaceId: parsed.data.workspace_id,
    toolName: parsed.data.tool_name,
    approvalGranted: parsed.data.approval_granted,
  });
  if (!decision.ok) {
    const status = decision.code === "AUTH_REQUIRED" || decision.code === "APPROVAL_REQUIRED" ? 409 : 403;
    return NextResponse.json(
      {
        ok: false,
        error_code: decision.code,
        message: decision.message,
        enforcement_step: decision.at_step,
      },
      { status },
    );
  }

  if (isWorkerBackboneMode()) {
    try {
      const result = await executeViaWorkerBackbone({
        cookieHeader,
        authorizationHeader,
        actionId: parsed.data.action_id,
        intent: parsed.data.intent,
        toolName: parsed.data.tool_name,
        args: parsed.data.args,
      });
      return NextResponse.json({
        ...result,
        local_execution_allowed: false,
      });
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error_code: "BACKBONE_UNAVAILABLE",
          message: "Degraded mode active. Worker backbone unavailable. Local execution is disabled.",
          degraded_mode: true,
          local_execution_allowed: false,
        },
        { status: 503 },
      );
    }
  }

  const runId = parsed.data.run_id ?? randomUUID();
  await ensureRunRecord({
    workspaceId: parsed.data.workspace_id,
    runId,
    userId: identity.userId,
    intent: parsed.data.intent,
    actionId: parsed.data.action_id,
    actionLabel: parsed.data.action_label,
  });
  await appendRunEvent({
    workspaceId: parsed.data.workspace_id,
    runId,
    eventType: "RUN_CREATED",
    createdBy: identity.userId,
    payload: {
      source: "quick_action",
      action_id: parsed.data.action_id,
      tool_name: parsed.data.tool_name,
      intent: parsed.data.intent,
    },
  });
  await appendRunEvent({
    workspaceId: parsed.data.workspace_id,
    runId,
    eventType: "PLAN_WRITTEN",
    createdBy: identity.userId,
    payload: {
      nodes: [
        {
          id: parsed.data.action_id,
          type: "tool",
          tool_name: parsed.data.tool_name,
          input: parsed.data.args,
        },
      ],
    },
  });
  await appendRunEvent({
    workspaceId: parsed.data.workspace_id,
    runId,
    eventType: "TOOL_REQUESTED",
    createdBy: identity.userId,
    payload: {
      tool_name: parsed.data.tool_name,
      args: parsed.data.args,
      idempotency_key: parsed.data.idempotency_key,
    },
  });

  try {
    const executionStartedAt = Date.now();
    await appendRunEvent({
      workspaceId: parsed.data.workspace_id,
      runId,
      eventType: "TOOL_STARTED",
      createdBy: identity.userId,
      payload: {
        tool_name: parsed.data.tool_name,
      },
    });
    const execution = await executeToolCall({
      workspace_id: parsed.data.workspace_id,
      run_id: runId,
      tool_name: parsed.data.tool_name,
      args: parsed.data.args,
      idempotency_key: parsed.data.idempotency_key,
      approval_granted: parsed.data.approval_granted,
    });

    if (execution.status === "succeeded") {
      await emitMetricSample({
        workspaceId: parsed.data.workspace_id,
        metricName: "run_success_rate",
        value: 1,
        tags: { source: "quick_action", tool_name: parsed.data.tool_name },
      });
      await emitMetricSample({
        workspaceId: parsed.data.workspace_id,
        metricName: "p95_tool_latency",
        value: Date.now() - executionStartedAt,
        tags: { source: "quick_action", tool_name: parsed.data.tool_name },
      });
      await appendRunEvent({
        workspaceId: parsed.data.workspace_id,
        runId,
        eventType: "TOOL_COMPLETED",
        toolCallId: execution.tool_call_id ?? null,
        createdBy: identity.userId,
        payload: {
          tool_name: parsed.data.tool_name,
          status: execution.status,
          ui_card_hint: execution.ui_card_hint ?? null,
        },
      });
      const supabase = getSupabaseAdminClient();
      const { data: artifacts } = await supabase
        .from("os_tool_artifacts")
        .select("id,workspace_id,run_id,tool_call_id,artifact_type,title,ui_card_hint,link_url,payload_json,metadata_json,created_at,updated_at")
        .eq("workspace_id", parsed.data.workspace_id)
        .eq("tool_call_id", execution.tool_call_id)
        .order("created_at", { ascending: false });

      await setRunStatus({
        workspaceId: parsed.data.workspace_id,
        runId,
        status: "done",
      });
      await appendRunEvent({
        workspaceId: parsed.data.workspace_id,
        runId,
        eventType: "RUN_SUCCEEDED",
        createdBy: identity.userId,
      });
      for (const artifact of artifacts ?? []) {
        await appendRunEvent({
          workspaceId: parsed.data.workspace_id,
          runId,
          eventType: "ARTIFACT_CREATED",
          toolCallId: typeof artifact.tool_call_id === "string" ? artifact.tool_call_id : null,
          createdBy: identity.userId,
          payload: {
            artifact_id: artifact.id,
            artifact_type: artifact.artifact_type,
            ui_card_hint: artifact.ui_card_hint,
            title: artifact.title,
          },
        });
      }

      return NextResponse.json({
        ok: true,
        run_id: runId,
        action_id: parsed.data.action_id,
        execution,
        artifacts: artifacts ?? [],
      });
    }

    await setRunStatus({
      workspaceId: parsed.data.workspace_id,
      runId,
      status: "executing",
      error: execution.reason,
    });
    if (execution.status === "waiting_for_approval") {
      await emitMetricSample({
        workspaceId: parsed.data.workspace_id,
        metricName: "approval_time",
        value: 1,
        tags: { source: "quick_action", pending: true },
      });
      await appendRunEvent({
        workspaceId: parsed.data.workspace_id,
        runId,
        eventType: "APPROVAL_REQUIRED",
        toolCallId: execution.tool_call_id ?? null,
        createdBy: identity.userId,
        payload: { reason: execution.reason ?? null },
      });
    }
    if (execution.status === "waiting_for_auth") {
      await emitMetricSample({
        workspaceId: parsed.data.workspace_id,
        metricName: "auth_failure_rate",
        value: 1,
        tags: { source: "quick_action", tool_name: parsed.data.tool_name },
      });
      await appendRunEvent({
        workspaceId: parsed.data.workspace_id,
        runId,
        eventType: "AUTH_REQUIRED",
        toolCallId: execution.tool_call_id ?? null,
        createdBy: identity.userId,
        payload: { reason: execution.reason ?? null },
      });
    }

    return NextResponse.json({
      ok: true,
      run_id: runId,
      action_id: parsed.data.action_id,
      execution,
      artifacts: [],
    });
  } catch (error) {
    const executionError = error instanceof ToolExecutionError
      ? error
      : new ToolExecutionError({
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unexpected quick action execution failure",
          status: 500,
        });
    const mapped = mapExecutionErrorToResponse(executionError);
    const mappedBody = mapped.body as Record<string, unknown>;
    const mappedStatus = typeof mappedBody.status === "string" ? mappedBody.status : null;
    const mappedReason = typeof mappedBody.reason === "string" ? mappedBody.reason : null;

    if (mappedStatus === "waiting_for_auth") {
      await emitMetricSample({
        workspaceId: parsed.data.workspace_id,
        metricName: "auth_failure_rate",
        value: 1,
        tags: { source: "quick_action", tool_name: parsed.data.tool_name },
      });
      await setRunStatus({
        workspaceId: parsed.data.workspace_id,
        runId,
        status: "executing",
        error: mappedReason ?? "waiting_for_auth",
      });
      await appendRunEvent({
        workspaceId: parsed.data.workspace_id,
        runId,
        eventType: "AUTH_REQUIRED",
        createdBy: identity.userId,
        payload: { reason: mappedReason ?? "waiting_for_auth" },
      });
      return NextResponse.json(
        {
          ok: true,
          run_id: runId,
          action_id: parsed.data.action_id,
          execution: mappedBody,
          artifacts: [],
        },
        { status: 200 },
      );
    }

    await setRunStatus({
      workspaceId: parsed.data.workspace_id,
      runId,
      status: "failed",
      error: executionError.message,
    });
    await appendRunEvent({
      workspaceId: parsed.data.workspace_id,
      runId,
      eventType: "RUN_FAILED",
      createdBy: identity.userId,
      payload: {
        error_code: executionError.code,
        error_message: executionError.message,
      },
    });
    await emitMetricSample({
      workspaceId: parsed.data.workspace_id,
      metricName: "run_success_rate",
      value: 0,
      tags: { source: "quick_action", tool_name: parsed.data.tool_name, error_code: executionError.code },
    });

    return NextResponse.json(
      {
        ok: false,
        run_id: runId,
        action_id: parsed.data.action_id,
        ...mapped.body,
      },
      { status: mapped.status },
    );
  }
}
