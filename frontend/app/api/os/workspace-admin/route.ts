import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import type { WorkspaceAdminPayload } from "@/lib/orb-os/admin/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listSystemHealth } from "@/lib/orb-os/observability/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

export async function GET(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }
  const role = (payload.membership?.role || "member").toLowerCase();
  const userId = payload.user?.id || payload.userId || payload.userKey || null;
  const contract = await buildBootstrapContractFromDb(workspaceId, { userId, seedIfMissing: true });
  const supabase = getSupabaseAdminClient();
  const auditRows = await supabase
    .from("os_admin_audit_log")
    .select("id,created_at,action,target_type,target_id,actor_user_id,metadata_json")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  let healthData: Awaited<ReturnType<typeof listSystemHealth>> | null = null;
  try {
    healthData = await listSystemHealth(workspaceId);
  } catch {
    healthData = { aggregates: [], incidents: [] };
  }

  const admin: WorkspaceAdminPayload = {
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    sections: {
      general: {
        state: "ready",
        data: {
          workspace_name: payload.activeWorkspace?.name ?? "Workspace",
          workspace_slug: payload.activeWorkspace?.slug ?? "active",
          workspace_type: payload.activeWorkspace?.type ?? "workspace",
          owner_controls_enabled: role === "owner" || role === "admin",
        },
      },
      members: {
        state: "ready",
        data: {
          total_members: 3,
          active_members: 2,
          pending_invites: 1,
          entries: [
            { id: "m-1", email: payload.user?.email ?? "owner@elyra.app", role, status: "active" },
            { id: "m-2", email: "ops@elyra.app", role: "manager", status: "active" },
            { id: "m-3", email: "pending@elyra.app", role: "member", status: "invited" },
          ],
        },
      },
      capabilities: {
        state: "ready",
        data: {
          surfaces: contract.workspace_capabilities.surfaces,
          feature_flags: Object.entries(contract.workspace_capabilities.capabilities).map(([id, status]) => ({
            id,
            label: id.replace(/_/g, " "),
            status,
          })),
          apps_manifest_pack: contract.app_manifest.map((app) => {
            const install = contract.installed_apps.find((entry) => entry.app_id === app.app_id);
            const toolStatuses = contract.tool_registry
              .filter((tool) => tool.app_id === app.app_id)
              .map((tool) => tool.status);
            const integrationBlocked = app.auth_requirements.some((requirement) => {
              if (requirement.mode !== "required") return false;
              return contract.integration_status.find((entry) => entry.integration_id === requirement.integration_id)?.state !== "connected";
            });
            const policyBlocked = toolStatuses.includes("policy_blocked");
            const disabledByPolicy = toolStatuses.length > 0 && toolStatuses.every((status) => status === "disabled");
            let blockedReason: string | null = null;
            if (policyBlocked) blockedReason = "Blocked by workspace policy";
            else if (integrationBlocked) blockedReason = "Requires integration auth";
            else if (disabledByPolicy) blockedReason = "All tools disabled";

            return {
              app_id: app.app_id,
              name: app.name,
              category: app.category,
              installed: Boolean(install?.installed),
              enabled: Boolean(install?.enabled),
              risk_badges: app.risk_tags,
              policy_badges: Array.from(new Set(toolStatuses.length ? toolStatuses : ["enabled"])) as Array<"enabled" | "disabled" | "policy_blocked">,
              blocked_reason: blockedReason,
            };
          }),
        },
      },
      integrations: {
        state: contract.integration_status.length === 0 ? "empty" : "ready",
        data:
          contract.integration_status.length === 0
            ? null
            : {
                entries: contract.integration_status.map((entry) => ({
                  integration_id: entry.integration_id,
                  state: entry.state,
                  last_refresh_at: entry.last_refresh_at,
                  scopes: entry.scopes,
                  safe_error_details: entry.error_message_safe,
                  error_code: entry.error_code,
                  connect_url:
                    entry.integration_id === "google_oauth"
                      ? `/api/google/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent("/os")}`
                      : entry.integration_id === "github"
                        ? `/api/github/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(`/os/code?workspaceId=${workspaceId}`)}`
                        : entry.integration_id === "figma"
                          ? `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/figma/connect`
                          : entry.integration_id === "banana2"
                            ? `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/banana2/connect`
                            : entry.integration_id === "google_stitch"
                              ? `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/google_stitch/connect`
                              : entry.integration_id === "twentyfirst"
                                ? `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/twentyfirst/connect`
                        : entry.integration_id === "imap" || entry.integration_id === "icloud_imap"
                          ? `/os/mail/connect?workspaceId=${encodeURIComponent(workspaceId)}`
                          : entry.integration_id === "icloud_caldav"
                            ? `/os/calendar/connect?workspaceId=${encodeURIComponent(workspaceId)}`
                            : entry.reauth_url,
                  blocked_reason:
                    role === "member" && entry.state !== "connected"
                      ? "Requires admin or owner to reconnect this integration"
                      : null,
                  can_connect: role === "owner" || role === "admin" || role === "manager",
                  can_diagnose: true,
                })),
              },
      },
      ai_control_center: {
        state: "ready",
        data: {
          model_policy: "balanced",
          default_temperature: 0.2,
          memory_mode: "workspace_memory_on",
          planner_mode: "tool_aware_graph",
        },
      },
      policies_approvals: {
        state: "ready",
        data: {
          approval_required_tools: contract.tool_registry.filter((tool) => tool.requires_approval).length,
          high_risk_tools: contract.tool_registry.filter((tool) => tool.risk_level === "destructive").length,
          pending_approvals: 1,
          policies: [
            { id: "writes", name: "Writes policy", mode: "confirm" },
            { id: "destructive", name: "Destructive policy", mode: "admin" },
          ],
        },
      },
      audit_log: {
        state: auditRows.error ? "error" : "ready",
        data: {
          entries: auditRows.error
            ? []
            : (auditRows.data ?? []).map((entry) => ({
                id: String(entry.id),
                at: String(entry.created_at),
                actor: typeof entry.actor_user_id === "string" ? entry.actor_user_id : "system",
                action: String(entry.action),
                target: `${String(entry.target_type)}:${String(entry.target_id ?? "")}`,
              })),
        },
      },
      usage_budget: {
        state: "ready",
        data: {
          monthly_budget_usd: 250,
          spent_usd: 74.4,
          runs_count: 42,
          tool_calls_count: 318,
        },
      },
      system_health: {
        state: (healthData?.aggregates.length ?? 0) > 0 ? "ready" : "empty",
        data: {
          metrics: (healthData?.aggregates ?? []).map((entry) => ({
            bucket_start: String(entry.bucket_start),
            run_success_rate: entry.run_success_rate as number | null,
            queue_lag: entry.queue_lag as number | null,
            p95_tool_latency: entry.p95_tool_latency as number | null,
            approval_time: entry.approval_time as number | null,
            auth_failure_rate: entry.auth_failure_rate as number | null,
          })),
        },
      },
      incidents: {
        state: (healthData?.incidents.length ?? 0) > 0 ? "ready" : "empty",
        data: {
          entries: (healthData?.incidents ?? []).map((incident) => ({
            id: String(incident.id),
            incident_type: String(incident.incident_type),
            severity: (incident.severity as "low" | "medium" | "high" | "critical") ?? "low",
            status: (incident.status as "open" | "acknowledged" | "resolved") ?? "open",
            summary: String(incident.summary),
            opened_at: String(incident.opened_at),
            affected_runs: Array.isArray(incident.affected_runs) ? (incident.affected_runs as string[]) : [],
          })),
        },
      },
    },
  };

  return NextResponse.json({ ok: true, admin });
}
