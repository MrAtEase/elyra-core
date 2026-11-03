import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { appendRunEvent } from "@/lib/orb-os/events/store";
import { resolveExecutorForContract } from "@/lib/orb-os/orchestrator/executorRegistry";
import { fetchWhoamiPayload, getWhoamiUserId, hasWorkspaceAccess, resolveWorkerCookieHeader } from "@/lib/api/whoamiClient";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import type { CodeTaskContract } from "@/types/taskContract";

export const runtime = "nodejs";

type RequestBody = {
  workspaceId?: string;
  intent?: string;
  task?: string;
  repoUrl?: string;
  branch?: string;
  folderPath?: string;
  selectedFiles?: string[];
  stage?: "playground" | "dev" | "prod";
  terminalAccess?: boolean;
  useReasoning?: boolean;
  autoCommit?: boolean;
  executionMode?: "strict" | "adaptive";
  provider?: string;
  agentRole?: "general" | "frontend" | "backend" | "ui" | "infra" | "qa";
  branchPerAgent?: boolean;
  agentBranchName?: string;
  budgetUsd?: number;
  deadlineMinutes?: number;
  skill?: string;
  runId?: string;
  phase?: "plan" | "execute";
};

type WorkspaceBrainRow = {
  profile_json: Record<string, unknown> | null;
};

function toSelectedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function buildCodeTaskContract(input: {
  workspaceId: string;
  intent: string;
  repoUrl: string;
  branch: string;
  folderPath: string;
  selectedFiles: string[];
  stage: "playground" | "dev" | "prod";
  terminalAccess: boolean;
  useReasoning: boolean;
  autoCommit: boolean;
  executionMode: "strict" | "adaptive";
  provider?: string;
  agentRole: "general" | "frontend" | "backend" | "ui" | "infra" | "qa";
  branchPerAgent: boolean;
  agentBranchName?: string;
  budgetUsd?: number;
  deadlineMinutes?: number;
  workspaceBrainProfile?: Record<string, unknown> | null;
}): CodeTaskContract {
  const mission =
    typeof input.workspaceBrainProfile?.mission === "string"
      ? input.workspaceBrainProfile.mission.trim()
      : "";
  const workspaceGoal =
    typeof input.workspaceBrainProfile?.goal === "string"
      ? input.workspaceBrainProfile.goal.trim()
      : "";
  const summaryParts = [mission, workspaceGoal].filter(Boolean);

  return {
    id: `contract-${randomUUID()}`,
    executorType: "code",
    title: input.intent.slice(0, 120),
    goal: input.intent,
    ...(summaryParts.length > 0
      ? {
          summary: `Workspace context: ${summaryParts.join(" | ")}`,
        }
      : {}),
    scope: {
      workspaceId: input.workspaceId,
      repoUrl: input.repoUrl,
      branch: input.branch,
      folderPath: input.folderPath,
      selectedFiles: input.selectedFiles,
    },
    constraints: {
      stage: input.stage,
      terminalAccess: input.terminalAccess,
      useReasoning: input.useReasoning,
      autoCommit: input.autoCommit,
      executionMode: input.executionMode,
      ...(input.provider ? { provider: input.provider } : {}),
      agentRole: input.agentRole,
      branchPerAgent: input.branchPerAgent,
      ...(input.agentBranchName ? { agentBranchName: input.agentBranchName } : {}),
      ...(typeof input.budgetUsd === "number" ? { budgetUsd: input.budgetUsd } : {}),
      ...(typeof input.deadlineMinutes === "number" ? { deadlineMinutes: input.deadlineMinutes } : {}),
    },
    definitionOfDone: [
      "Apply the requested repository change only inside the agreed scope.",
      "Keep the implementation aligned with the existing codebase and workspace intent.",
      "Return verifiable evidence of what changed and whether build/tests passed.",
    ],
    verification: [
      "Inspect relevant files before editing.",
      "Run the standard verification gates that are available for the repo.",
      "Report failures explicitly instead of marking the run as passed.",
    ],
    source: "chief_orchestrator",
    createdAt: new Date().toISOString(),
  };
}

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
  contract: CodeTaskContract;
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

  if (existing.data?.id) {
    await supabase
      .from("orchestration_runs")
      .update({
        status,
        intent: input.intent,
        current_step_id: input.contract.id,
        plan_json: {
          source: "chief_orchestrator",
          executor: "code",
          contract: input.contract,
        },
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
    plan_json: {
      source: "chief_orchestrator",
      executor: "code",
      contract: input.contract,
    },
    current_step_id: input.contract.id,
    started_at: now,
    updated_at: now,
  });
}

async function setRunStatus(input: {
  runId: string;
  workspaceId: string;
  status: "done" | "failed";
  error?: string | null;
  artifact?: unknown;
}) {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: input.status,
    error: input.error ?? null,
    finished_at: now,
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

  const runId = typeof body?.runId === "string" && body.runId.trim() ? body.runId.trim() : `orch-${randomUUID()}`;
  const phase = body?.phase === "plan" ? "plan" : "execute";
  const repoUrl = typeof body?.repoUrl === "string" ? body.repoUrl.trim() : "";
  const branch = typeof body?.branch === "string" && body.branch.trim() ? body.branch.trim() : "main";
  const folderPath = typeof body?.folderPath === "string" ? body.folderPath.trim() : "";
  const selectedFiles = toSelectedFiles(body?.selectedFiles);
  const stage = body?.stage === "dev" || body?.stage === "prod" ? body.stage : "playground";
  const executionMode = body?.executionMode === "strict" ? "strict" : "adaptive";
  const agentRole =
    body?.agentRole === "frontend" ||
    body?.agentRole === "backend" ||
    body?.agentRole === "ui" ||
    body?.agentRole === "infra" ||
    body?.agentRole === "qa"
      ? body.agentRole
      : "general";
  const workspaceBrainProfile = await loadWorkspaceBrainProfile(workspaceId);
  const contract = buildCodeTaskContract({
    workspaceId,
    intent,
    repoUrl,
    branch,
    folderPath,
    selectedFiles,
    stage,
    terminalAccess: body?.terminalAccess === true,
    useReasoning: body?.useReasoning === true,
    autoCommit: body?.autoCommit === true,
    executionMode,
    ...(typeof body?.provider === "string" && body.provider.trim() ? { provider: body.provider.trim() } : {}),
    agentRole,
    branchPerAgent: body?.branchPerAgent === true,
    ...(typeof body?.agentBranchName === "string" && body.agentBranchName.trim()
      ? { agentBranchName: body.agentBranchName.trim() }
      : {}),
    ...(typeof body?.budgetUsd === "number" ? { budgetUsd: body.budgetUsd } : {}),
    ...(typeof body?.deadlineMinutes === "number" ? { deadlineMinutes: body.deadlineMinutes } : {}),
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
      summary: "Chief orchestrator contract created.",
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
      runId,
      workspaceId,
      phase: "execute",
      skill: body?.skill ?? "custom",
      task: intent,
      repoUrl,
      branch,
      folderPath,
      selectedFiles,
      stage,
      terminalAccess: body?.terminalAccess === true,
      useReasoning: body?.useReasoning === true,
      autoCommit: body?.autoCommit === true,
      executionMode,
      provider: body?.provider,
      agentRole,
      branchPerAgent: body?.branchPerAgent === true,
      agentBranchName: body?.agentBranchName,
      budgetUsd: body?.budgetUsd,
      deadlineMinutes: body?.deadlineMinutes,
      taskContract: contract,
    }),
    cache: "no-store",
  });

  const dispatchPayload = await dispatchResponse.json().catch(() => null);
  if (!dispatchResponse.ok || !dispatchPayload?.ok) {
    const errorMessage =
      typeof dispatchPayload?.error === "string"
        ? dispatchPayload.error
        : `Dispatch to ${executor.label} failed.`;
    await setRunStatus({
      runId,
      workspaceId,
      status: "failed",
      error: errorMessage,
    });
    await appendRunEvent({
      workspaceId,
      runId,
      eventType: "RUN_FAILED",
      payload: { summary: errorMessage },
    });
    return NextResponse.json(
      {
        ok: false,
        runId,
        contract,
        executor,
        error: errorMessage,
      },
      { status: dispatchResponse.ok ? 500 : dispatchResponse.status },
    );
  }

  await setRunStatus({
    runId,
    workspaceId,
    status: "done",
    artifact: dispatchPayload.artifact ?? null,
  });
  await appendRunEvent({
    workspaceId,
    runId,
    eventType: "RUN_SUCCEEDED",
    payload: { summary: `${executor.label} completed the dispatched contract.` },
  });

  return NextResponse.json({
    ok: true,
    runId,
    contract,
    executor,
    artifact: dispatchPayload.artifact ?? null,
  });
}
