export type ToolRiskLevel = "read_only" | "writes" | "destructive";
export type ApprovalMode = "auto" | "confirm_user" | "confirm_admin";

export type PolicyContext = {
  external_data?: boolean;
  pii?: boolean;
  financial_impact?: boolean;
  org_scope?: boolean;
  restricted_domain?: boolean;
};

export type RuntimeState =
  | "proposed"
  | "queued"
  | "running"
  | "waiting_for_auth"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PolicyDecision = {
  mode: ApprovalMode;
  reason: string;
};

export function resolveApprovalMode(risk: ToolRiskLevel, context: PolicyContext): PolicyDecision {
  if (risk === "destructive") {
    return { mode: "confirm_admin", reason: "Destructive action requires admin approval" };
  }

  if (risk === "writes") {
    if (context.pii || context.financial_impact || context.org_scope) {
      return { mode: "confirm_admin", reason: "Sensitive write requires admin approval" };
    }
    return { mode: "confirm_user", reason: "Write operation requires user confirmation" };
  }

  if (context.external_data && context.restricted_domain) {
    return { mode: "confirm_user", reason: "External restricted domain requires confirmation" };
  }

  return { mode: "auto", reason: "Read-only action can run automatically" };
}

export function requiresApproval(mode: ApprovalMode): boolean {
  return mode === "confirm_user" || mode === "confirm_admin";
}

export type ToolPolicyConfig = {
  tool_name: string;
  risk_level: ToolRiskLevel;
  mode: ApprovalMode;
};

export const defaultPolicyConfig: ToolPolicyConfig[] = [
  { tool_name: "google_mail.send", risk_level: "writes", mode: "confirm_user" },
  { tool_name: "google_drive.delete", risk_level: "destructive", mode: "confirm_admin" },
  { tool_name: "weather.get_forecast", risk_level: "read_only", mode: "auto" },
  { tool_name: "web.search_and_summarize", risk_level: "read_only", mode: "auto" },
  { tool_name: "translate.text", risk_level: "read_only", mode: "auto" },
];

export type UiBadge = "connected" | "needs_auth" | "degraded" | "policy_blocked" | "disabled";

export function badgesForRuntimeState(state: RuntimeState): UiBadge[] {
  if (state === "waiting_for_auth") return ["needs_auth"];
  if (state === "waiting_for_approval") return ["degraded"];
  if (state === "failed") return ["policy_blocked"];
  if (state === "cancelled") return ["disabled"];
  return ["connected"];
}

export function canRetry(state: RuntimeState, reasonCode?: string): boolean {
  if (state !== "failed") return false;
  if (reasonCode === "policy_denied" || reasonCode === "auth_missing") return false;
  return true;
}
