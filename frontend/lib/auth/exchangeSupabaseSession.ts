import { buildAssistantEndpoint } from "@/utils/auth-guard";

type SupabaseExchangeResult = {
  ok: boolean;
  status: number;
  workspaceId: string | null;
  error: string | null;
  message: string | null;
};

function isAbsoluteUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

export async function exchangeSupabaseSession(
  accessToken: string
): Promise<SupabaseExchangeResult> {
  const token = accessToken.trim();
  if (!token) {
    return {
      ok: false,
      status: 0,
      workspaceId: null,
      error: "missing_access_token",
      message: "Supabase access token is required.",
    };
  }

  const endpoint = buildAssistantEndpoint("/assistant/auth/exchange-supabase");
  if (!isAbsoluteUrl(endpoint)) {
    return {
      ok: false,
      status: 0,
      workspaceId: null,
      error: "api_base_missing",
      message: "API base not configured.",
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });

  const payload = await response.json().catch(() => null);
  const ok = response.ok && payload?.ok !== false;

  return {
    ok,
    status: response.status,
    workspaceId: payload?.workspaceId ?? null,
    error: payload?.error ?? (ok ? null : "exchange_failed"),
    message: payload?.message ?? null,
  };
}
