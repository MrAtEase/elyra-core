import type { AppManifest, ToolRegistryItem, UiBootstrapContract } from "@/lib/orb-os/contracts/types";
import { resolveApprovalMode, requiresApproval, type ApprovalMode } from "@/lib/orb-os/policy/model";

export type EnforcementInput = {
  role: string;
  contract: UiBootstrapContract;
  workspaceId: string;
  requestedWorkspaceId: string;
  toolName: string;
  approvalGranted?: boolean | undefined;
};

export type EnforcementDecision =
  | { ok: true; approval_mode: ApprovalMode; requires_approval: boolean; tool: ToolRegistryItem; manifest?: AppManifest }
  | { ok: false; code: string; message: string; at_step: number };

function findTool(contract: UiBootstrapContract, toolName: string): ToolRegistryItem | null {
  return contract.tool_registry.find((item) => item.tool_name === toolName) ?? null;
}

function findManifest(contract: UiBootstrapContract, appId: string): AppManifest | undefined {
  return contract.app_manifest.find((item) => item.app_id === appId);
}

export function enforceToolExecution(input: EnforcementInput): EnforcementDecision {
  // 1) membership + role
  if (!input.role) {
    return { ok: false, code: "ROLE_REQUIRED", message: "Missing membership role", at_step: 1 };
  }

  // 2) capability enabled (assistant)
  const assistantCapability = input.contract.workspace_capabilities.surfaces.assistant;
  if (assistantCapability === "hidden") {
    return { ok: false, code: "CAPABILITY_DISABLED", message: "Assistant surface disabled for workspace", at_step: 2 };
  }

  // scope check (workspace ownership of request)
  if (input.workspaceId !== input.requestedWorkspaceId) {
    return { ok: false, code: "WORKSPACE_SCOPE_MISMATCH", message: "workspace_id mismatch", at_step: 1 };
  }

  // 3) tool enabled
  const tool = findTool(input.contract, input.toolName);
  if (!tool) {
    return { ok: false, code: "TOOL_NOT_REGISTERED", message: "Tool not registered", at_step: 3 };
  }
  if (tool.status !== "enabled") {
    return { ok: false, code: "TOOL_BLOCKED", message: `Tool status is ${tool.status}`, at_step: 3 };
  }

  const manifest = findManifest(input.contract, tool.app_id);
  if (!manifest) {
    return { ok: false, code: "APP_NOT_FOUND", message: "Tool app not found", at_step: 3 };
  }

  const install = input.contract.installed_apps.find((app) => app.workspace_id === input.workspaceId && app.app_id === tool.app_id);
  if (!install || !install.installed || !install.enabled) {
    return { ok: false, code: "APP_NOT_ENABLED", message: "App not installed/enabled", at_step: 3 };
  }

  // 4) integration auth + scopes
  for (const requirement of manifest.auth_requirements) {
    if (requirement.mode !== "required") continue;
    const integration = input.contract.integration_status.find((entry) => entry.integration_id === requirement.integration_id);
    if (!integration || integration.state !== "connected") {
      return { ok: false, code: "AUTH_REQUIRED", message: `Integration ${requirement.integration_id} not connected`, at_step: 4 };
    }

    const missing = requirement.required_scopes.filter((scope) => !integration.scopes.includes(scope));
    if (missing.length > 0) {
      return { ok: false, code: "AUTH_SCOPE_MISSING", message: `Missing scopes: ${missing.join(", ")}`, at_step: 4 };
    }
  }

  // 5) policy risk decision
  const policy = resolveApprovalMode(tool.risk_level, {
    external_data: manifest.risk_tags.includes("external_data"),
    pii: manifest.risk_tags.includes("pii"),
    org_scope: input.role === "admin" || input.role === "owner" || input.role === "system_owner",
  });

  // 6) approval check
  const approvalRequired = Boolean(tool.requires_approval) || requiresApproval(policy.mode);
  if (approvalRequired && !input.approvalGranted) {
    return { ok: false, code: "APPROVAL_REQUIRED", message: policy.reason, at_step: 6 };
  }

  // 7) execute allowed
  return {
    ok: true,
    approval_mode: policy.mode,
    requires_approval: approvalRequired,
    tool,
    manifest,
  };
}
