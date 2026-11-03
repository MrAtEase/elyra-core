import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import {
  executeToolCall,
  executeToolRequestSchema,
  mapExecutionErrorToResponse,
  ToolExecutionError,
} from "@/lib/orb-os/tools/execution";
import { forwardToWorkerOs, isWorkerBackboneMode, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import { enforceToolExecution } from "@/lib/orb-os/security/enforcement";
import { emitMetricSample } from "@/lib/orb-os/observability/store";
import { resolveWorkerAuthorizationHeader, resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

function activeWorkspaceId(payload: WhoamiResponse): string | null {
  return payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId || null;
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

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error_code: "AUTH_REQUIRED", message: "Unable to validate session" }, { status: response.status });
  }

  const parsed = executeToolRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "INVALID_INPUT",
        message: "Invalid tool execution request",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const requestWorkspaceId = normalizeWorkspaceId(parsed.data.workspace_id) ?? parsed.data.workspace_id;
  parsed.data.workspace_id = requestWorkspaceId;
  const sessionWorkspaceIdRaw = activeWorkspaceId(payload);
  const sessionWorkspaceId = normalizeWorkspaceId(sessionWorkspaceIdRaw) ?? sessionWorkspaceIdRaw;
  const allowedWorkspaceIds = collectWorkspaceCandidates(payload);
  if (!sessionWorkspaceId) {
    return NextResponse.json({ ok: false, error_code: "WORKSPACE_REQUIRED", message: "No active workspace in session" }, { status: 400 });
  }

  if (sessionWorkspaceId !== requestWorkspaceId && !allowedWorkspaceIds.has(requestWorkspaceId)) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "WORKSPACE_SCOPE_MISMATCH",
        message: "workspace_id does not match active session workspace",
      },
      { status: 403 },
    );
  }
  const role = (payload.membership?.role || "member").toLowerCase();
  const userId = payload.user?.id || payload.userId || payload.userKey || null;
  const contract = await buildBootstrapContractFromDb(sessionWorkspaceId, {
    userId,
    seedIfMissing: true,
  });
  const decision = enforceToolExecution({
    role,
    contract,
    workspaceId: sessionWorkspaceId || requestWorkspaceId,
    requestedWorkspaceId: requestWorkspaceId,
    toolName: parsed.data.tool_name,
    approvalGranted: parsed.data.approval_granted,
  });
  if (!decision.ok) {
    const status = decision.code === "APPROVAL_REQUIRED" || decision.code === "AUTH_REQUIRED" ? 409 : 403;
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
      const runPayload = await forwardToWorkerOs({
        path: "/v1/os/runs",
        method: "POST",
        cookieHeader: resolveWorkerSessionHeaders(request).get("cookie"),
        authorizationHeader: resolveWorkerAuthorizationHeader(request),
        body: {
          intent_text: `Tool execution: ${parsed.data.tool_name}`,
          nodes: [
            {
              id: "n1",
              type: "tool",
              tool_name: parsed.data.tool_name,
              input: parsed.data.args,
            },
          ],
        },
      }) as { ok?: boolean; run?: { id: string } };

      const runId = typeof runPayload?.run?.id === "string" ? runPayload.run.id : null;
      if (!runId) {
        return NextResponse.json(
          {
            ok: false,
            error_code: "BACKBONE_INVALID_RESPONSE",
            message: "Degraded mode active. Worker backbone response invalid.",
            degraded_mode: true,
            local_execution_allowed: false,
          },
          { status: 503 },
        );
      }

      await forwardToWorkerOs({
        path: "/v1/os/worker/tick",
        method: "POST",
        cookieHeader: resolveWorkerSessionHeaders(request).get("cookie"),
        authorizationHeader: resolveWorkerAuthorizationHeader(request),
      });
      const detail = await forwardToWorkerOs({
        path: `/v1/os/runs/${encodeURIComponent(runId)}`,
        method: "GET",
        cookieHeader: resolveWorkerSessionHeaders(request).get("cookie"),
        authorizationHeader: resolveWorkerAuthorizationHeader(request),
      }) as { tool_calls?: Array<Record<string, unknown>>; artifacts?: Array<Record<string, unknown>>; run?: Record<string, unknown> };

      const toolCall = Array.isArray(detail.tool_calls) ? detail.tool_calls[detail.tool_calls.length - 1] : null;
      const status = String(detail.run?.status ?? "running");
      const executionStatus = status === "succeeded" ? "succeeded" : status === "waiting_for_approval" ? "waiting_for_approval" : "waiting_for_auth";
      await emitMetricSample({
        workspaceId: requestWorkspaceId,
        metricName: "run_success_rate",
        value: executionStatus === "succeeded" ? 1 : 0,
        tags: { source: "tool_execute_proxy", tool_name: parsed.data.tool_name, status: executionStatus },
      });
      await emitMetricSample({
        workspaceId: requestWorkspaceId,
        metricName: "p95_tool_latency",
        value: Date.now() - startedAt,
        tags: { source: "tool_execute_proxy", tool_name: parsed.data.tool_name },
      });
      return NextResponse.json({
        ok: true,
        status: executionStatus,
        tool_call_id: typeof toolCall?.id === "string" ? toolCall.id : null,
        run_id: runId,
        result: toolCall?.output_json ?? {},
        artifacts: Array.isArray(detail.artifacts) ? detail.artifacts : [],
        local_execution_allowed: false,
      });
    } catch (error) {
      await emitMetricSample({
        workspaceId: requestWorkspaceId,
        metricName: "run_success_rate",
        value: 0,
        tags: { source: "tool_execute_proxy", tool_name: parsed.data.tool_name, reason: "backbone_unavailable" },
      });
      if (error instanceof WorkerProxyError) {
        return NextResponse.json(
          (error.payload as Record<string, unknown>) ?? {
            ok: false,
            error_code: "BACKBONE_UNAVAILABLE",
            message: "Degraded mode active. Worker backbone unavailable.",
            degraded_mode: true,
            local_execution_allowed: false,
          },
          { status: error.status || 503 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error_code: "BACKBONE_UNAVAILABLE",
          message: "Degraded mode active. Worker backbone unavailable.",
          degraded_mode: true,
          local_execution_allowed: false,
        },
        { status: 503 },
      );
    }
  }

  try {
    const result = await executeToolCall(parsed.data);
    await emitMetricSample({
      workspaceId: requestWorkspaceId,
      metricName: "run_success_rate",
      value: result.status === "succeeded" ? 1 : 0,
      tags: { source: "tool_execute_local", tool_name: parsed.data.tool_name, status: result.status },
    });
    await emitMetricSample({
      workspaceId: requestWorkspaceId,
      metricName: "p95_tool_latency",
      value: Date.now() - startedAt,
      tags: { source: "tool_execute_local", tool_name: parsed.data.tool_name },
    });
    return NextResponse.json(result);
  } catch (error) {
    const executionError = error instanceof ToolExecutionError
      ? error
      : new ToolExecutionError({
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unexpected tool execution error",
          status: 500,
        });

    const mapped = mapExecutionErrorToResponse(executionError);
    if (executionError.code === "AUTH_REQUIRED" || executionError.code === "AUTH_SCOPE_MISSING") {
      await emitMetricSample({
        workspaceId: requestWorkspaceId,
        metricName: "auth_failure_rate",
        value: 1,
        tags: { source: "tool_execute_local", tool_name: parsed.data.tool_name, error_code: executionError.code },
      });
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
