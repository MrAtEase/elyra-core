import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/crypto";

type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: "github";
  status: "disconnected" | "connected" | "error";
  connected_user_id: string | null;
};

type IntegrationTokenRow = {
  id: string;
  integration_id: string;
  access_token: string | null;
  scope: string | null;
  updated_at: string | null;
};

export type StoredGitHubToken = {
  integrationId: string;
  tokenRowId: string | null;
  accessToken: string | null;
  scopes: string[];
  updatedAt: string | null;
};

function parseScopes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function ensureIntegration(
  workspaceId: string,
  userId?: string | null,
): Promise<IntegrationRow> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("integrations")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "github",
        status: "connected",
        connected_user_id: userId ?? null,
      },
      { onConflict: "workspace_id,provider" },
    )
    .select("id,workspace_id,provider,status,connected_user_id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to persist GitHub integration row.");
  }

  return data as IntegrationRow;
}

async function findIntegration(workspaceId: string): Promise<IntegrationRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("integrations")
    .select("id,workspace_id,provider,status,connected_user_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "github")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load GitHub integration: ${error.message}`);
  }

  return (data as IntegrationRow | null) ?? null;
}

async function findLatestTokenRow(integrationId: string): Promise<IntegrationTokenRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("integration_tokens")
    .select("id,integration_id,access_token,scope,updated_at")
    .eq("integration_id", integrationId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    throw new Error(`Unable to load GitHub token row: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;
  return (row as IntegrationTokenRow | null) ?? null;
}

export async function loadStoredGitHubToken(workspaceId: string): Promise<StoredGitHubToken | null> {
  const integration = await findIntegration(workspaceId);
  if (!integration?.id) return null;

  const tokenRow = await findLatestTokenRow(integration.id);
  if (!tokenRow?.access_token) {
    return {
      integrationId: integration.id,
      tokenRowId: tokenRow?.id ?? null,
      accessToken: null,
      scopes: parseScopes(tokenRow?.scope ?? null),
      updatedAt: tokenRow?.updated_at ?? null,
    };
  }

  let accessToken: string | null = null;
  try {
    accessToken = decryptIntegrationSecret(tokenRow.access_token);
  } catch {
    accessToken = null;
  }

  return {
    integrationId: integration.id,
    tokenRowId: tokenRow.id,
    accessToken,
    scopes: parseScopes(tokenRow.scope),
    updatedAt: tokenRow.updated_at ?? null,
  };
}

export async function saveGitHubToken(input: {
  workspaceId: string;
  userId: string | null;
  accessToken: string;
  scopes: string[];
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const integration = await ensureIntegration(input.workspaceId, input.userId);

  await supabase.from("integration_tokens").delete().eq("integration_id", integration.id);

  const { error: tokenError } = await supabase.from("integration_tokens").insert({
    integration_id: integration.id,
    access_token: encryptIntegrationSecret(input.accessToken),
    refresh_token: null,
    scope: input.scopes.join(","),
    expires_at: null,
  });

  if (tokenError) {
    throw new Error(`Unable to persist GitHub token: ${tokenError.message}`);
  }

  await supabase
    .from("integrations")
    .update({ status: "connected", connected_user_id: input.userId })
    .eq("id", integration.id);
}

export async function disconnectGitHubToken(workspaceId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const integration = await findIntegration(workspaceId);
  if (!integration?.id) return;

  await supabase.from("integration_tokens").delete().eq("integration_id", integration.id);
  await supabase
    .from("integrations")
    .update({ status: "disconnected" })
    .eq("id", integration.id);
}
