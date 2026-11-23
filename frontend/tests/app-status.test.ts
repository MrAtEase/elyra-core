import test from "node:test";
import assert from "node:assert/strict";
import { getAppStatus, toLaunchpadStatus } from "@/lib/orb-os/apps/status";
import type { AppManifest, InstalledApp, IntegrationStatus, ToolRegistryItem } from "@/lib/orb-os/contracts/types";

function manifest(appId: string): AppManifest {
  return {
    manifest_version: "v1.0",
    app_id: appId,
    name: appId,
    category: "productivity",
    icon: { name: "mail", variant: "line" },
    surfaces: ["apps_surface"],
    quick_actions: [],
    risk_tags: ["read_only"],
    auth_requirements: [],
    tools: [],
    status_badges: ["connected"],
    install_constraints: {
      workspace_types: ["personal"],
      roles_allowed: ["owner"],
    },
    compatibility: { min_contract_version: "v1.0" },
  };
}

const TOOL_REGISTRY: ToolRegistryItem[] = [
  {
    tool_name: "google_mail.draft_reply",
    app_id: "google_workspace",
    risk_level: "writes",
    requires_approval: true,
    status: "enabled",
  },
];

test("google mail resolves connected_ok with workspace-scoped scopes", () => {
  const installedApps: InstalledApp[] = [
    { workspace_id: "ws-fish-delish", app_id: "google_workspace", installed: true, enabled: true },
  ];
  const integrationStatus: IntegrationStatus[] = [
    {
      workspace_id: "ws-fish-delish",
      integration_id: "google_oauth",
      state: "connected",
      connected: true,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      last_refresh_at: new Date().toISOString(),
      health_score: 1,
      error_code: null,
      error_message_safe: null,
      reauth_url: "/api/google/connect",
      provider_metadata: { provider: "google" },
    },
  ];

  const status = getAppStatus({
    workspaceId: "ws-fish-delish",
    appId: "mail",
    manifests: [manifest("google_workspace")],
    installedApps,
    integrationStatus,
    toolRegistry: TOOL_REGISTRY,
    requiredProvider: "google",
    requiredScopes: ["gmail.readonly"],
  });

  assert.equal(status.status, "connected_ok");
  assert.equal(toLaunchpadStatus(status.status), "connected");
});

test("google mail resolves missing_scopes when workspace token lacks scope", () => {
  const status = getAppStatus({
    workspaceId: "ws-fish-delish",
    appId: "mail",
    manifests: [manifest("google_workspace")],
    installedApps: [{ workspace_id: "ws-fish-delish", app_id: "google_workspace", installed: true, enabled: true }],
    integrationStatus: [
      {
        workspace_id: "ws-fish-delish",
        integration_id: "google_oauth",
        state: "connected",
        connected: true,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        last_refresh_at: new Date().toISOString(),
        health_score: 1,
        error_code: null,
        error_message_safe: null,
        reauth_url: "/api/google/connect",
        provider_metadata: { provider: "google" },
      },
    ],
    toolRegistry: TOOL_REGISTRY,
    requiredProvider: "google",
    requiredScopes: ["gmail.readonly"],
  });

  assert.equal(status.status, "missing_scopes");
  assert.equal(toLaunchpadStatus(status.status), "needs_scope");
});

test("google mail resolves needs_auth when workspace integration is disconnected", () => {
  const status = getAppStatus({
    workspaceId: "ws-personal",
    appId: "mail",
    manifests: [manifest("google_workspace")],
    installedApps: [{ workspace_id: "ws-personal", app_id: "google_workspace", installed: true, enabled: true }],
    integrationStatus: [
      {
        workspace_id: "ws-personal",
        integration_id: "google_oauth",
        state: "disconnected",
        connected: false,
        scopes: [],
        last_refresh_at: new Date().toISOString(),
        health_score: 0,
        error_code: "token_missing",
        error_message_safe: "missing",
        reauth_url: "/api/google/connect",
        provider_metadata: { provider: "google" },
      },
    ],
    toolRegistry: TOOL_REGISTRY,
    requiredProvider: "google",
    requiredScopes: ["gmail.readonly"],
  });

  assert.equal(status.status, "needs_auth");
  assert.equal(toLaunchpadStatus(status.status), "needs_auth");
});

test("mail resolves connected_ok with iCloud provider when Google is disconnected", () => {
  const status = getAppStatus({
    workspaceId: "ws-personal",
    appId: "mail",
    manifests: [manifest("google_workspace")],
    installedApps: [{ workspace_id: "ws-personal", app_id: "google_workspace", installed: true, enabled: true }],
    integrationStatus: [
      {
        workspace_id: "ws-personal",
        integration_id: "google_oauth",
        state: "disconnected",
        connected: false,
        scopes: [],
        last_refresh_at: new Date().toISOString(),
        health_score: 0,
        error_code: "token_missing",
        error_message_safe: "missing",
        reauth_url: "/api/google/connect",
        provider_metadata: { provider: "google" },
      },
      {
        workspace_id: "ws-personal",
        integration_id: "icloud_imap",
        state: "connected",
        connected: true,
        scopes: [],
        last_refresh_at: new Date().toISOString(),
        health_score: 1,
        error_code: null,
        error_message_safe: null,
        reauth_url: "/workspace/work/mail",
        provider_metadata: { provider: "icloud_imap" },
      },
    ],
    toolRegistry: TOOL_REGISTRY,
  });

  assert.equal(status.status, "connected_ok");
  assert.equal(toLaunchpadStatus(status.status), "connected");
});

test("disabled app setting returns disabled", () => {
  const status = getAppStatus({
    workspaceId: "ws-personal",
    appId: "weather",
    manifests: [manifest("weather")],
    installedApps: [{ workspace_id: "ws-personal", app_id: "weather", installed: true, enabled: false }],
    integrationStatus: [],
    toolRegistry: [],
  });

  assert.equal(status.status, "disabled");
});
