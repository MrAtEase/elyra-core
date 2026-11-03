import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { appendRunEvent } from "@/lib/orb-os/events/store";
import { buildToolTaskContract, detectChiefExecutorType } from "@/lib/orb-os/orchestrator/chiefDelegation";
import { resolveExecutorForContract } from "@/lib/orb-os/orchestrator/executorRegistry";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess, resolveWorkerCookieHeader } from "@/lib/api/whoamiClient";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import type { ExecutorType, ToolTaskContract } from "@/types/taskContract";

export const runtime = "nodejs";

type RequestBody = {
  workspaceId?: string;
  intent?: string;
  task?: string;
  executorType?: Exclude<ExecutorType, "code">;
  runId?: string;
  phase?: "plan" | "execute";
};

type WorkspaceBrainRow = {
  profile_json: Record<string, unknown> | null;
};

async function loadWorkspaceBrainProfile(workspaceId: string) {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("workspace_identity")
    .select("profile_json")
    .eq("workspace_id", workspaceId)
    .maybeSingle<WorkspaceBrainRow>();
  return data?.profile_json ?? null;
}

async function upsertRunRecord(input: {
  runId: string;
  workspaceId: string;
  userId: string;
  intent: string;
  contract: ToolTaskContract;
  status?: "plan_ready" | "executing";
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const status = input.status ?? "executing";
  const existing = await supabase
    .from("orchestration_runs")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.runId)
    .maybeSingle();

  const planJson = {
    source: "chief_orchestrator",
    executor: input.contract.executorType,
    contract: input.contract,
  };

  if (existing.data?.id) {
    await supabase
      .from("orchestration_runs")
      .update({
        status,
        intent: input.intent,
        current_step_id: input.contract.id,
        plan_json: planJson,
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
    status,
    intent: input.intent,
    plan_json: planJson,
    current_step_id: input.contract.id,
    started_at: now,
    updated_at: now,
  });
}

async function setRunStatus(input: {
  runId: string;
  workspaceId: string;
  status: "executing" | "done" | "failed";
  error?: string | null;
  artifact?: unknown;
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: input.status,
    error: input.error ?? null,
    finished_at: input.status === "done" || input.status === "failed" ? now : null,
    updated_at: now,
  };
  if (input.artifact !== undefined) {
    const existing = await supabase
      .from("orchestration_runs")
      .select("plan_json")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.runId)
      .maybeSingle<{ plan_json: Record<string, unknown> | null }>();
    updates.plan_json = {
      ...(existing.data?.plan_json ?? {}),
      result: input.artifact,
    };
  }
  await supabase
    .from("orchestration_runs")
    .update(updates)
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.runId);
}

function buildArtifactSummary(input: {
  contract: ToolTaskContract;
  execution?: Record<string, unknown> | null;
  artifacts?: Array<Record<string, unknown>> | null;
}) {
  const status = typeof input.execution?.status === "string" ? input.execution.status : "unknown";
  const firstArtifact = Array.isArray(input.artifacts) && input.artifacts.length > 0 ? input.artifacts[0] : null;
  const firstTitle = typeof firstArtifact?.title === "string" ? firstArtifact.title : null;
  return {
    summary: firstTitle
      ? `${input.contract.executorType} executor finished with ${status}: ${firstTitle}`
      : `${input.contract.executorType} executor finished with ${status}.`,
    executionStatus: status,
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const workspaceId = normalizeWorkspaceId(body?.workspaceId ?? "") ?? body?.workspaceId ?? "";
  const intent = typeof body?.intent === "string" && body.intent.trim()
    ? body.intent.trim()
    : typeof body?.task === "string"
      ? body.task.trim()
      : "";

  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
  }
  if (!intent) {
    return NextResponse.json({ ok: false, error: "intent is required." }, { status: 400 });
  }

  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "Unable to validate session." }, { status: 401 });
  }
  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "Workspace access denied." }, { status: 403 });
  }
  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Missing user identity." }, { status: 401 });
  }

  const inferredType = body?.executorType ?? detectChiefExecutorType(intent);
  if (inferredType === "unknown" || inferredType === "code") {
    return NextResponse.json({ ok: false, error: "This route supports mail, calendar, tasks, and workflow intents only." }, { status: 400 });
  }

  const runId = typeof body?.runId === "string" && body.runId.trim() ? body.runId.trim() : `orch-${randomUUID()}`;
  const phase = body?.phase === "plan" ? "plan" : "execute";
  const workspaceBrainProfile = await loadWorkspaceBrainProfile(workspaceId);
  const contract = buildToolTaskContract({
    workspaceId,
    executorType: inferredType,
    intent,
    workspaceBrainProfile,
  });
  const executor = resolveExecutorForContract(contract);

  await upsertRunRecord({
    runId,
    workspaceId,
    userId,
    intent,
    contract,
    status: phase === "plan" ? "plan_ready" : "executing",
  });
  await appendRunEvent({
    workspaceId,
    runId,
    eventType: "RUN_CREATED",
    payload: { summary: "Chief orchestrator run created.", contractId: contract.id },
  });
  await appendRunEvent({
    workspaceId,
    runId,
    eventType: "PLAN_WRITTEN",
    payload: { summary: `Task contract created for ${executor.label}.`, contract },
  });

  if (phase === "plan") {
    return NextResponse.json({
      ok: true,
      runId,
      phase: "plan",
      contract,
      executor,
      summary: `Chief orchestrator contract created for ${executor.label}.`,
    });
  }

  await appendRunEvent({
    workspaceId,
    runId,
    eventType: "TOOL_STARTED",
    payload: { summary: `Dispatching contract to ${executor.label}.`, dispatchPath: executor.dispatchPath },
  });

  const headers = new Headers({ "content-type": "application/json" });
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (authHeader?.trim()) headers.set("authorization", authHeader.trim());
  const cookieHeader = resolveWorkerCookieHeader(request);
  if (cookieHeader) headers.set("cookie", cookieHeader);
  headers.set("x-workspace-id", workspaceId);

  const dispatchResponse = await fetch(new URL(executor.dispatchPath, request.nextUrl.origin), {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspace_id: workspaceId,
      run_id: runId,
      action_id: contract.action.actionId,
      action_label: contract.action.actionLabel,
      intent,
      tool_name: contract.action.toolName,
      args: contract.action.args,
      idempotency_key: `chief:${contract.id}`,
    }),
    cache: "no-store",
  });

  const dispatchPayload = await dispatchResponse.json().catch(() => null) as {
    ok?: boolean;
    error?: string;
    execution?: Record<string, unknown>;
    artifacts?: Array<Record<string, unknown>>;
  } | null;

  if (!dispatchResponse.ok || !dispatchPayload?.ok) {
    const errorMessage = typeof dispatchPayload?.error === "string" ? dispatchPayload.error : `Dispatch to ${executor.label} failed.`;
    await setRunStatus({ runId, workspaceId, status: "failed", error: errorMessage });
    await appendRunEvent({
      workspaceId,
      runId,
      eventType: "RUN_FAILED",
      payload: { summary: errorMessage },
    });
    return NextResponse.json({ ok: false, runId, contract, executor, error: errorMessage }, { status: dispatchResponse.ok ? 500 : dispatchResponse.status });
  }

  const executionStatus = typeof dispatchPayload.execution?.status === "string" ? dispatchPayload.execution.status : "succeeded";
  const artifact = buildArtifactSummary({
    contract,
    execution: dispatchPayload.execution ?? null,
    artifacts: dispatchPayload.artifacts ?? null,
  });
  await setRunStatus({
    runId,
    workspaceId,
    status: executionStatus === "waiting_for_auth" || executionStatus === "waiting_for_approval" ? "executing" : "done",
    error: executionStatus === "waiting_for_auth" || executionStatus === "waiting_for_approval" ? executionStatus : null,
    artifact,
  });
  await appendRunEvent({
    workspaceId,
    runId,
    eventType: executionStatus === "waiting_for_auth" ? "AUTH_REQUIRED" : executionStatus === "waiting_for_approval" ? "APPROVAL_REQUIRED" : "RUN_SUCCEEDED",
    payload: { summary: artifact.summary },
  });

  return NextResponse.json({
    ok: true,
    runId,
    contract,
    executor,
    artifact,
    execution: dispatchPayload.execution ?? null,
  });
}
