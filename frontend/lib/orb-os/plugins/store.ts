import { createHash } from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { validatePluginManifest, type PluginManifest } from "@/lib/orb-os/plugins/schema";
import { assertControlPlaneWrite } from "@/lib/orb-os/cqrs/ownership";

function immutableHash(manifest: PluginManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export async function installOrUpdatePlugin(input: {
  workspaceId: string;
  actorUserId?: string | null;
  manifest: unknown;
  action: "install" | "update";
}) {
  const validated = validatePluginManifest(input.manifest);
  if (!validated.ok || !validated.manifest) {
    throw new Error(`Invalid plugin manifest: ${validated.issues.join(" | ")}`);
  }

  const manifest = validated.manifest;
  const hash = immutableHash(manifest);
  const supabase = getSupabaseAdminClient();
  assertControlPlaneWrite("plugin_manifests");

  const existing = await supabase
    .from("plugin_manifests")
    .select("id,immutable_hash")
    .eq("plugin_id", manifest.plugin_id)
    .eq("version", manifest.version)
    .maybeSingle();

  if (existing.data?.id && existing.data.immutable_hash !== hash) {
    throw new Error("Plugin manifest immutability violation for existing version");
  }

  await supabase.from("plugin_manifests").upsert(
    {
      plugin_id: manifest.plugin_id,
      version: manifest.version,
      manifest_json: manifest,
      signature: null,
      immutable_hash: hash,
      status: "active",
    },
    { onConflict: "plugin_id,version" },
  );

  assertControlPlaneWrite("workspace_plugins");
  await supabase.from("workspace_plugins").upsert(
    {
      workspace_id: input.workspaceId,
      plugin_id: manifest.plugin_id,
      version: manifest.version,
      enabled: true,
      installed_by: input.actorUserId ?? null,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,plugin_id" },
  );

  assertControlPlaneWrite("plugin_audit_log");
  await supabase.from("plugin_audit_log").insert({
    workspace_id: input.workspaceId,
    plugin_id: manifest.plugin_id,
    action: input.action,
    actor_user_id: input.actorUserId ?? null,
    metadata_json: {
      version: manifest.version,
      immutable_hash: hash,
      runtime: manifest.runtime,
      permissions: manifest.permissions,
      limits: manifest.limits,
    },
  });

  return { plugin_id: manifest.plugin_id, version: manifest.version, immutable_hash: hash };
}

export async function removePlugin(input: {
  workspaceId: string;
  pluginId: string;
  actorUserId?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  assertControlPlaneWrite("workspace_plugins");
  await supabase
    .from("workspace_plugins")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("plugin_id", input.pluginId);

  assertControlPlaneWrite("plugin_audit_log");
  await supabase.from("plugin_audit_log").insert({
    workspace_id: input.workspaceId,
    plugin_id: input.pluginId,
    action: "remove",
    actor_user_id: input.actorUserId ?? null,
    metadata_json: {},
  });
}

export async function rollbackPlugin(input: {
  workspaceId: string;
  pluginId: string;
  toVersion: string;
  actorUserId?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const manifest = await supabase
    .from("plugin_manifests")
    .select("plugin_id,version,status")
    .eq("plugin_id", input.pluginId)
    .eq("version", input.toVersion)
    .maybeSingle();

  if (!manifest.data) {
    throw new Error("Target rollback version not found");
  }

  assertControlPlaneWrite("workspace_plugins");
  await supabase.from("workspace_plugins").upsert(
    {
      workspace_id: input.workspaceId,
      plugin_id: input.pluginId,
      version: input.toVersion,
      enabled: true,
      installed_by: input.actorUserId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,plugin_id" },
  );

  assertControlPlaneWrite("plugin_audit_log");
  await supabase.from("plugin_audit_log").insert({
    workspace_id: input.workspaceId,
    plugin_id: input.pluginId,
    action: "rollback",
    actor_user_id: input.actorUserId ?? null,
    metadata_json: { to_version: input.toVersion },
  });
}

export async function listWorkspacePlugins(workspaceId: string) {
  const supabase = getSupabaseAdminClient();
  const [installed, audit] = await Promise.all([
    supabase
      .from("workspace_plugins")
      .select("plugin_id,version,enabled,installed_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("plugin_audit_log")
      .select("id,plugin_id,action,metadata_json,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (installed.error) throw new Error(installed.error.message);
  if (audit.error) throw new Error(audit.error.message);

  return {
    plugins: installed.data ?? [],
    audit_log: audit.data ?? [],
  };
}
