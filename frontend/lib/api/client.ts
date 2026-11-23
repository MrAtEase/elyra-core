import { buildAssistantEndpoint } from "@/utils/auth-guard";

export async function apiClient<TResponse = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<TResponse> {
  const url = /^https?:\/\//i.test(path) ? path : buildAssistantEndpoint(path);
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && (payload as { message?: string; error?: string }).message) ||
      (payload && typeof payload === "object" && (payload as { error?: string }).error) ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as TResponse;
}
