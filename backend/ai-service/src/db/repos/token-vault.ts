import { db } from "../client.js";
import { encrypt, decrypt } from "../../lib/crypto.js";

export type StoredToken = {
  workspaceId: string;
  provider: "google";
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string;
  accountEmail?: string | null;
};

export async function saveTokens(token: StoredToken): Promise<void> {
  const refreshToken = token.refreshToken.trim();
  const accessToken = token.accessToken.trim();
  const scopes = token.scopes.trim();
  const { error } = await db()
    .from("workspace_google_tokens")
    .upsert({
      workspace_id: token.workspaceId,
      provider: token.provider,
      access_token: encrypt(accessToken),
      refresh_token: encrypt(refreshToken),
      expires_at: token.expiresAt,
      scopes,
      account_email: token.accountEmail ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" });
  if (error) throw error;
}

export async function getTokens(workspaceId: string): Promise<StoredToken | null> {
  const { data, error } = await db()
    .from("workspace_google_tokens")
    .select(
      "workspace_id,provider,access_token,refresh_token,expires_at,scopes,account_email",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", "google")
    .single();
  if (error || !data) return null;

  return {
    workspaceId: data["workspace_id"] as string,
    provider: "google",
    accessToken: decrypt(data["access_token"] as string),
    refreshToken: decrypt(data["refresh_token"] as string),
    expiresAt: data["expires_at"] as string,
    scopes: (data["scopes"] as string) ?? "",
    accountEmail: (data["account_email"] as string | null | undefined) ?? null,
  };
}

export async function deleteTokens(workspaceId: string): Promise<void> {
  await db()
    .from("workspace_google_tokens")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", "google");
}
