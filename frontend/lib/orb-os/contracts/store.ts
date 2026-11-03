import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertControlPlaneWrite } from "@/lib/orb-os/cqrs/ownership";
import {
  appManifestSchema,
  type AppManifest,
  type InstalledApp,
  installedAppSchema,
  type ToolRegistryItem,
  toolRegistryItemSchema,
  type UiBootstrapContract,
  uiBootstrapContractSchema,
  type WorkspaceCapabilities,
  workspaceCapabilitiesSchema,
} from "@/lib/orb-os/contracts/types";
import {
  buildExampleBootstrapContract,
  exampleAppManifests,
  exampleInstalledApps,
  exampleToolRegistry,
  exampleWorkspaceCapabilities,
} from "@/lib/orb-os/contracts/examples";
import { buildRuntimeIntegrationStatus } from "@/lib/orb-os/contracts/integrationStatus";

const DB_MISSING_CODES = new Set(["42P01", "PGRST116"]);

function isDbMissingError(error: unknown): boolean {
  const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code?: string }).code) : "";
  const message = typeof (error as { message?: unknown })?.message === "string" ? String((error as { message?: string }).message) : "";
  return DB_MISSING_CODES.has(code) || message.toLowerCase().includes("does not exist");
}

function safeParseArray<T>(rows: unknown[], parser: (value: unknown) => T | null): T[] {
  const output: T[] = [];
  for (const row of rows) {
    const parsed = parser(row);
    if (parsed) output.push(parsed);
  }
  return output;
}

function parseWorkspaceCapabilities(row: Record<string, unknown> | null, workspaceId: string): WorkspaceCapabilities {
  if (!row) {
    return exampleWorkspaceCapabilities(workspaceId);
  }

  const parsed = workspaceCapabilitiesSchema.safeParse({
    workspace_id: workspaceId,
    contract_version: typeof row.contract_version === "string" ? row.contract_version : "v1.0",
    policy_version: typeof row.policy_version === "number" ? row.policy_version : 1,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
    surfaces: typeof row.surfaces === "object" && row.surfaces ? row.surfaces : {},
    capabilities: typeof row.capabilities === "object" && row.capabilities ? row.capabilities : {},
  });

  return parsed.success ? parsed.data : exampleWorkspaceCapabilities(workspaceId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function parseManifest(row: unknown): AppManifest | null {
  const record = asRecord(row);
  if (!record) return null;
  const schemaJson = record.schema_json;
  const parsed = appManifestSchema.safeParse(schemaJson);
  return parsed.success ? parsed.data : null;
}

function parseInstalledApp(row: unknown, workspaceId: string): InstalledApp | null {
  const record = asRecord(row);
  if (!record) return null;
  const parsed = installedAppSchema.safeParse({
    workspace_id: workspaceId,
    app_id: String(record.app_id ?? ""),
    installed: Boolean(record.installed),
    enabled: Boolean(record.enabled),
  });
  return parsed.success ? parsed.data : null;
}

function parseToolRegistry(row: unknown): ToolRegistryItem | null {
  const record = asRecord(row);
  if (!record) return null;
  const parsed = toolRegistryItemSchema.safeParse({
    tool_name: String(record.tool_name ?? ""),
    app_id: String(record.app_id ?? ""),
    risk_level: record.risk_level,
    requires_approval: Boolean(record.requires_approval),
    status: record.status,
    version: record.version,
  });
  return parsed.success ? parsed.data : null;
}

async function seedDefaults(workspaceId: string, userId?: string | null | undefined): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  assertControlPlaneWrite("workspace_capabilities");

  await supabase.from("workspace_capabilities").upsert(
    {
      workspace_id: workspaceId,
      contract_version: "v1.0",
      policy_version: 1,
      surfaces: exampleWorkspaceCapabilities(workspaceId).surfaces,
      capabilities: exampleWorkspaceCapabilities(workspaceId).capabilities,
      updated_by: userId,
      updated_at: now,
    },
    { onConflict: "workspace_id" },
  );

  for (const manifest of exampleAppManifests) {
    assertControlPlaneWrite("app_manifests");
    await supabase.from("app_manifests").upsert(
      {
        app_id: manifest.app_id,
        manifest_version: manifest.manifest_version,
        schema_json: manifest,
        status: "active",
        is_latest: true,
        created_by: userId,
      },
      { onConflict: "app_id,manifest_version" },
    );
  }

  for (const app of exampleInstalledApps(workspaceId)) {
    assertControlPlaneWrite("installed_apps");
    await supabase.from("installed_apps").upsert(
      {
        workspace_id: workspaceId,
        app_id: app.app_id,
        installed: app.installed,
        enabled: app.enabled,
        source: "manifest_pack",
        installed_by: userId,
      },
      { onConflict: "workspace_id,app_id" },
    );
  }

  for (const tool of exampleToolRegistry) {
    assertControlPlaneWrite("tool_registry_entries");
    await supabase.from("tool_registry_entries").upsert(
      {
        workspace_id: workspaceId,
        tool_name: tool.tool_name,
        app_id: tool.app_id,
        risk_level: tool.risk_level,
        requires_approval: tool.requires_approval,
        status: tool.status,
        version: "1.0.0",
      },
      { onConflict: "workspace_id,tool_name" },
    );
  }
}

export async function buildBootstrapContractFromDb(
  workspaceId: string,
  options?: { userId?: string | null | undefined; seedIfMissing?: boolean | undefined },
): Promise<UiBootstrapContract> {
  try {
    const supabase = getSupabaseAdminClient();
    const [capabilitiesRes, manifestsRes, installedRes, registryRes, integrationStatus] = await Promise.all([
      supabase.from("workspace_capabilities").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("app_manifests").select("schema_json,is_latest,status").eq("is_latest", true).eq("status", "active"),
      supabase.from("installed_apps").select("app_id,installed,enabled").eq("workspace_id", workspaceId),
      supabase
        .from("tool_registry_entries")
        .select("tool_name,app_id,risk_level,requires_approval,status,version")
        .eq("workspace_id", workspaceId),
      buildRuntimeIntegrationStatus(workspaceId, options?.userId),
    ]);

    if (capabilitiesRes.error && isDbMissingError(capabilitiesRes.error)) {
      return buildExampleBootstrapContract(workspaceId);
    }

    const capabilities = parseWorkspaceCapabilities((capabilitiesRes.data as Record<string, unknown> | null) ?? null, workspaceId);
    const appManifest = safeParseArray(
      (manifestsRes.data as Record<string, unknown>[] | null) ?? [],
      parseManifest,
    );
    const installedApps = safeParseArray(
      (installedRes.data as Record<string, unknown>[] | null) ?? [],
      (row) => parseInstalledApp(row, workspaceId),
    );
    const toolRegistry = safeParseArray(
      (registryRes.data as Record<string, unknown>[] | null) ?? [],
      parseToolRegistry,
    );

    const existingToolNames = new Set(toolRegistry.map((t) => t.tool_name));
    const missingTools = exampleToolRegistry.filter((t) => !existingToolNames.has(t.tool_name));
    const needsBackfill = missingTools.length > 0;

    if (options?.seedIfMissing && (appManifest.length === 0 || toolRegistry.length === 0 || needsBackfill)) {
      await seedDefaults(workspaceId, options.userId);
      return buildBootstrapContractFromDb(workspaceId, { ...options, seedIfMissing: false });
    }

    const parsed = uiBootstrapContractSchema.safeParse({
      workspace_id: workspaceId,
      workspace_capabilities: capabilities,
      app_manifest: appManifest.length > 0 ? appManifest : exampleAppManifests,
      installed_apps: installedApps.length > 0 ? installedApps : exampleInstalledApps(workspaceId),
      integration_status: integrationStatus,
      tool_registry: toolRegistry.length > 0 ? toolRegistry : exampleToolRegistry,
      generated_at: new Date().toISOString(),
    });

    if (parsed.success) return parsed.data;
    return buildExampleBootstrapContract(workspaceId);
  } catch (error) {
    if (isDbMissingError(error)) {
      return buildExampleBootstrapContract(workspaceId);
    }
    if (process.env.NODE_ENV !== "production") {
      console.error("[orb-os/contracts] failed to build bootstrap from DB, using example fallback", {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return buildExampleBootstrapContract(workspaceId);
  }
}

export async function appendAdminAuditLog(input: {
  workspaceId: string;
  actorUserId?: string | null | undefined;
  action: string;
  targetType: string;
  targetId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  assertControlPlaneWrite("os_admin_audit_log");
  const { error } = await supabase.from("os_admin_audit_log").insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId ?? null,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    metadata_json: input.metadata ?? {},
  });

  if (error && !isDbMissingError(error)) {
    throw new Error(`Failed to append admin audit log: ${error.message}`);
  }
}

export async function patchWorkspaceCapability(input: {
  workspaceId: string;
  kind: "surface" | "capability";
  id: string;
  status: "enabled" | "hidden" | "read_only" | "admin_only";
  actorUserId?: string | null | undefined;
}): Promise<void> {
  const contract = await buildBootstrapContractFromDb(input.workspaceId, {
    userId: input.actorUserId,
    seedIfMissing: true,
  });

  const nextSurfaces = { ...contract.workspace_capabilities.surfaces };
  const nextCapabilities = { ...contract.workspace_capabilities.capabilities };
  if (input.kind === "surface") {
    (nextSurfaces as Record<string, string>)[input.id] = input.status;
  } else {
    nextCapabilities[input.id] = input.status;
  }

  const supabase = getSupabaseAdminClient();
  assertControlPlaneWrite("workspace_capabilities");
  const { error } = await supabase.from("workspace_capabilities").upsert(
    {
      workspace_id: input.workspaceId,
      contract_version: contract.workspace_capabilities.contract_version,
      policy_version: contract.workspace_capabilities.policy_version,
      surfaces: nextSurfaces,
      capabilities: nextCapabilities,
      updated_by: input.actorUserId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  if (error && !isDbMissingError(error)) {
    throw new Error(`Failed to update workspace capability: ${error.message}`);
  }

  await appendAdminAuditLog({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.kind === "surface" ? "surface_capability_updated" : "workspace_capability_updated",
    targetType: input.kind,
    targetId: input.id,
    metadata: { status: input.status },
  });
}

export async function patchInstalledApp(input: {
  workspaceId: string;
  appId: string;
  action: "install" | "enable" | "disable" | "uninstall";
  actorUserId?: string | null | undefined;
}): Promise<void> {
  await buildBootstrapContractFromDb(input.workspaceId, {
    userId: input.actorUserId,
    seedIfMissing: true,
  });

  const next = {
    install: { installed: true, enabled: true },
    enable: { installed: true, enabled: true },
    disable: { installed: true, enabled: false },
    uninstall: { installed: false, enabled: false },
  }[input.action];

  const supabase = getSupabaseAdminClient();
  assertControlPlaneWrite("installed_apps");
  const { error } = await supabase.from("installed_apps").upsert(
    {
      workspace_id: input.workspaceId,
      app_id: input.appId,
      installed: next.installed,
      enabled: next.enabled,
      source: "admin_control_center",
      installed_by: input.actorUserId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,app_id" },
  );

  if (error && !isDbMissingError(error)) {
    throw new Error(`Failed to update installed app: ${error.message}`);
  }

  await appendAdminAuditLog({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: `app_${input.action}`,
    targetType: "app",
    targetId: input.appId,
    metadata: next,
  });
}
