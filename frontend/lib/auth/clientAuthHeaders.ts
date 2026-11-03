import { ensureSupabaseToken } from "@/lib/supabase/browser";

export async function withSupabaseAuthorization(init?: HeadersInit): Promise<Headers> {
  const headers = new Headers(init);
  try {
    const token = await ensureSupabaseToken();
    headers.set("authorization", `Bearer ${token}`);
  } catch {
    // keep request unauthenticated when token is not available
  }
  return headers;
}

