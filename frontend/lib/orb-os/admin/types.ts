export type AdminTabId =
  | "general"
  | "members"
  | "capabilities"
  | "integrations"
  | "ai_control_center"
  | "policies_approvals"
  | "audit_log"
  | "usage_budget"
  | "system_health"
  | "incidents";

export type AdminSectionState = "ready" | "empty" | "error";

export type AdminSection<TData> = {
  state: AdminSectionState;
  data: TData | null;
  error_code?: string;
  error_message_safe?: string;
};

export type WorkspaceAdminPayload = {
  workspace_id: string;
  generated_at: string;
  sections: {
    general: AdminSection<{
      workspace_name: string;
      workspace_slug: string;
      workspace_type: string;
      owner_controls_enabled: boolean;
    }>;
    members: AdminSection<{
      total_members: number;
      active_members: number;
      pending_invites: number;
      entries: Array<{ id: string; email: string; role: string; status: "active" | "invited" }>;
    }>;
    capabilities: AdminSection<{
      surfaces: Record<string, "enabled" | "hidden" | "read_only" | "admin_only">;
      feature_flags: Array<{ id: string; label: string; status: "enabled" | "hidden" | "read_only" | "admin_only" }>;
      apps_manifest_pack: Array<{
        app_id: string;
        name: string;
        category: string;
        installed: boolean;
        enabled: boolean;
        risk_badges: Array<"read_only" | "writes" | "destructive" | "external_data" | "pii">;
        policy_badges: Array<"enabled" | "disabled" | "policy_blocked">;
        blocked_reason: string | null;
      }>;
    }>;
    integrations: AdminSection<{
      entries: Array<{
        integration_id: string;
        state: "connected" | "disconnected" | "degraded" | "needs_auth";
        last_refresh_at: string | null;
        scopes: string[];
        safe_error_details: string | null;
        error_code: string | null;
        connect_url: string | null;
        blocked_reason: string | null;
        can_connect: boolean;
        can_diagnose: boolean;
      }>;
    }>;
    ai_control_center: AdminSection<{
      model_policy: string;
      default_temperature: number;
      memory_mode: string;
      planner_mode: string;
    }>;
    policies_approvals: AdminSection<{
      approval_required_tools: number;
      high_risk_tools: number;
      pending_approvals: number;
      policies: Array<{ id: string; name: string; mode: "auto" | "confirm" | "admin" }>;
    }>;
    audit_log: AdminSection<{
      entries: Array<{ id: string; at: string; actor: string; action: string; target: string }>;
    }>;
    usage_budget: AdminSection<{
      monthly_budget_usd: number;
      spent_usd: number;
      runs_count: number;
      tool_calls_count: number;
    }>;
    system_health: AdminSection<{
      metrics: Array<{
        bucket_start: string;
        run_success_rate: number | null;
        queue_lag: number | null;
        p95_tool_latency: number | null;
        approval_time: number | null;
        auth_failure_rate: number | null;
      }>;
    }>;
    incidents: AdminSection<{
      entries: Array<{
        id: string;
        incident_type: string;
        severity: "low" | "medium" | "high" | "critical";
        status: "open" | "acknowledged" | "resolved";
        summary: string;
        opened_at: string;
        affected_runs: string[];
      }>;
    }>;
  };
};
