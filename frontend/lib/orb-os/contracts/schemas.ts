type JsonSchema = Record<string, unknown>;

export const workspaceCapabilitiesJsonSchema: JsonSchema = {
  $id: "https://elyra.app/schemas/workspace_capabilities.schema.json",
  $schema: "https://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["workspace_id", "contract_version", "policy_version", "surfaces", "capabilities", "updated_at"],
  properties: {
    workspace_id: { type: "string", minLength: 1 },
    contract_version: { type: "string", pattern: "^v\\d+\\.\\d+$" },
    policy_version: { type: "integer", minimum: 1 },
    updated_at: { type: "string", format: "date-time" },
    surfaces: {
      type: "object",
      required: ["dashboard", "assistant", "goals", "apps", "settings", "builder", "marketplace"],
      properties: {
        dashboard: { $ref: "#/definitions/capabilityLevel" },
        assistant: { $ref: "#/definitions/capabilityLevel" },
        goals: { $ref: "#/definitions/capabilityLevel" },
        apps: { $ref: "#/definitions/capabilityLevel" },
        settings: { $ref: "#/definitions/capabilityLevel" },
        builder: { $ref: "#/definitions/capabilityLevel" },
        marketplace: { $ref: "#/definitions/capabilityLevel" },
      },
      additionalProperties: false,
    },
    capabilities: {
      type: "object",
      additionalProperties: { $ref: "#/definitions/capabilityLevel" },
    },
  },
  definitions: {
    capabilityLevel: {
      type: "string",
      enum: ["enabled", "hidden", "read_only", "admin_only"],
    },
  },
  additionalProperties: false,
};

export const appManifestJsonSchema: JsonSchema = {
  $id: "https://elyra.app/schemas/app_manifest.schema.json",
  $schema: "https://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "manifest_version",
    "app_id",
    "name",
    "category",
    "icon",
    "surfaces",
    "quick_actions",
    "risk_tags",
    "auth_requirements",
    "tools",
    "status_badges",
    "install_constraints",
    "compatibility",
  ],
  properties: {
    manifest_version: { type: "string", pattern: "^v\\d+\\.\\d+$" },
    app_id: { type: "string", pattern: "^[a-z0-9_\\-.]+$" },
    name: { type: "string", minLength: 1 },
    category: { type: "string", enum: ["communication", "productivity", "research", "utility", "ops"] },
    description: { type: "string" },
    icon: {
      type: "object",
      required: ["name", "variant"],
      properties: {
        name: { type: "string" },
        variant: { type: "string", enum: ["line", "solid", "duotone"] },
      },
      additionalProperties: false,
    },
    surfaces: {
      type: "array",
      items: {
        type: "string",
        enum: ["orb", "edge_rail", "apps_surface", "dashboard_widget", "assistant_context", "settings_panel"],
      },
      uniqueItems: true,
    },
    quick_actions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "intent", "tool_ref", "requires_auth", "requires_approval", "availability_conditions"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          intent: { type: "string" },
          tool_ref: { type: "string" },
          requires_auth: { type: "boolean" },
          requires_approval: { type: "boolean" },
          availability_conditions: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
    risk_tags: {
      type: "array",
      items: { type: "string", enum: ["read_only", "writes", "destructive", "external_data", "pii"] },
      uniqueItems: true,
    },
    auth_requirements: {
      type: "array",
      items: {
        type: "object",
        required: ["integration_id", "required_scopes", "mode", "fallback_state"],
        properties: {
          integration_id: { type: "string" },
          required_scopes: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["required", "optional"] },
          fallback_state: { type: "string", enum: ["disabled", "connect_cta", "limited_mode"] },
        },
        additionalProperties: false,
      },
    },
    tools: { type: "array", items: { type: "string" } },
    status_badges: {
      type: "array",
      items: { type: "string", enum: ["connected", "needs_auth", "degraded", "policy_blocked", "disabled"] },
      uniqueItems: true,
    },
    install_constraints: {
      type: "object",
      required: ["workspace_types", "roles_allowed"],
      properties: {
        workspace_types: { type: "array", items: { type: "string" } },
        roles_allowed: { type: "array", items: { type: "string" } },
      },
      additionalProperties: true,
    },
    compatibility: {
      type: "object",
      required: ["min_contract_version"],
      properties: {
        min_contract_version: { type: "string", pattern: "^v\\d+\\.\\d+$" },
      },
      additionalProperties: false,
    },
    marketplace: {
      type: "object",
      required: ["app_version", "install_flow", "pricing", "permissions"],
      properties: {
        app_version: { type: "string" },
        install_flow: { type: "string", enum: ["none", "oauth", "api_key", "manual"] },
        pricing: {
          type: "object",
          required: ["model"],
          properties: {
            model: { type: "string", enum: ["free", "subscription", "usage"] },
            price_usd: { type: "number", minimum: 0 },
            unit: { type: "string" },
          },
          additionalProperties: false,
        },
        permissions: { type: "array", items: { type: "string" } },
        changelog_url: { type: "string", format: "uri" },
        docs_url: { type: "string", format: "uri" },
        rating: { type: "number", minimum: 0, maximum: 5 },
        review_count: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const integrationStatusJsonSchema: JsonSchema = {
  $id: "https://elyra.app/schemas/integration_status.schema.json",
  $schema: "https://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "workspace_id",
    "integration_id",
    "state",
    "connected",
    "scopes",
    "last_refresh_at",
    "health_score",
  ],
  properties: {
    workspace_id: { type: "string", minLength: 1 },
    integration_id: { type: "string", minLength: 1 },
    state: { type: "string", enum: ["connected", "needs_auth", "degraded", "disconnected"] },
    connected: { type: "boolean" },
    scopes: { type: "array", items: { type: "string" } },
    last_refresh_at: { type: "string", format: "date-time" },
    health_score: { type: "number", minimum: 0, maximum: 1 },
    error_code: { type: ["string", "null"] },
    error_message_safe: { type: ["string", "null"] },
    reauth_url: { type: ["string", "null"], format: "uri" },
    provider_metadata: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};
