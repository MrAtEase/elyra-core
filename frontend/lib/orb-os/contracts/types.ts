import { z } from "zod";

export const capabilityLevelSchema = z.enum(["enabled", "hidden", "read_only", "admin_only"]);

export const workspaceCapabilitiesSchema = z.object({
  workspace_id: z.string().min(1),
  contract_version: z.string().regex(/^v\d+\.\d+$/),
  policy_version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  surfaces: z.object({
    dashboard: capabilityLevelSchema,
    assistant: capabilityLevelSchema,
    goals: capabilityLevelSchema,
    apps: capabilityLevelSchema,
    settings: capabilityLevelSchema,
    builder: capabilityLevelSchema,
    marketplace: capabilityLevelSchema,
  }),
  capabilities: z.record(z.string(), capabilityLevelSchema),
});

export const appManifestIconSchema = z.object({
  name: z.string().min(1),
  variant: z.enum(["line", "solid", "duotone"]),
});

export const appQuickActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().min(1),
  tool_ref: z.string().min(1),
  requires_auth: z.boolean(),
  requires_approval: z.boolean(),
  availability_conditions: z.array(z.string()),
});

export const appManifestSchema = z.object({
  manifest_version: z.string().regex(/^v\d+\.\d+$/),
  app_id: z.string().regex(/^[a-z0-9_\-.]+$/),
  name: z.string().min(1),
  category: z.enum(["communication", "productivity", "research", "utility", "ops"]),
  description: z.string().optional(),
  icon: appManifestIconSchema,
  surfaces: z.array(
    z.enum(["orb", "edge_rail", "apps_surface", "dashboard_widget", "assistant_context", "settings_panel"])
  ),
  quick_actions: z.array(appQuickActionSchema),
  risk_tags: z.array(z.enum(["read_only", "writes", "destructive", "external_data", "pii"])),
  auth_requirements: z.array(
    z.object({
      integration_id: z.string().min(1),
      required_scopes: z.array(z.string()),
      mode: z.enum(["required", "optional"]),
      fallback_state: z.enum(["disabled", "connect_cta", "limited_mode"]),
    })
  ),
  tools: z.array(z.string().min(1)),
  status_badges: z.array(z.enum(["connected", "needs_auth", "degraded", "policy_blocked", "disabled"])),
  install_constraints: z.object({
    workspace_types: z.array(z.string()),
    roles_allowed: z.array(z.string()),
  }).passthrough(),
  compatibility: z.object({
    min_contract_version: z.string().regex(/^v\d+\.\d+$/),
  }),
  marketplace: z
    .object({
      app_version: z.string().min(1),
      install_flow: z.enum(["none", "oauth", "api_key", "manual"]),
      pricing: z.object({
        model: z.enum(["free", "subscription", "usage"]),
        price_usd: z.number().nonnegative().optional(),
        unit: z.string().optional(),
      }),
      permissions: z.array(z.string()),
      changelog_url: z.string().url().optional(),
      docs_url: z.string().url().optional(),
      rating: z.number().min(0).max(5).optional(),
      review_count: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const installedAppSchema = z.object({
  workspace_id: z.string().min(1),
  app_id: z.string().min(1),
  installed: z.boolean(),
  enabled: z.boolean(),
});

export const integrationStatusSchema = z.object({
  workspace_id: z.string().min(1),
  integration_id: z.string().min(1),
  state: z.enum(["connected", "needs_auth", "degraded", "disconnected"]),
  connected: z.boolean(),
  scopes: z.array(z.string()),
  last_refresh_at: z.string().datetime(),
  health_score: z.number().min(0).max(1),
  error_code: z.string().nullable(),
  error_message_safe: z.string().nullable(),
  // Allow both absolute URLs and relative in-app routes (e.g. /api/google/connect?...).
  reauth_url: z.string().min(1).nullable(),
  provider_metadata: z.record(z.string(), z.unknown()),
});

export const toolRegistryItemSchema = z.object({
  tool_name: z.string().min(1),
  app_id: z.string().min(1),
  risk_level: z.enum(["read_only", "writes", "destructive"]),
  requires_approval: z.boolean(),
  status: z.enum(["enabled", "disabled", "policy_blocked"]),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
});

export const uiBootstrapContractSchema = z.object({
  workspace_id: z.string().min(1),
  workspace_capabilities: workspaceCapabilitiesSchema,
  app_manifest: z.array(appManifestSchema),
  installed_apps: z.array(installedAppSchema),
  integration_status: z.array(integrationStatusSchema),
  tool_registry: z.array(toolRegistryItemSchema),
  generated_at: z.string().datetime(),
});

export type WorkspaceCapabilities = z.infer<typeof workspaceCapabilitiesSchema>;
export type AppManifest = z.infer<typeof appManifestSchema>;
export type InstalledApp = z.infer<typeof installedAppSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type ToolRegistryItem = z.infer<typeof toolRegistryItemSchema>;
export type UiBootstrapContract = z.infer<typeof uiBootstrapContractSchema>;
