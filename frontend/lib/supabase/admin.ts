import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

let supabaseAdminClientInstance: SupabaseClient<Database> | null = null;

function readEnvValue(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (supabaseAdminClientInstance) return supabaseAdminClientInstance;

  const supabaseUrl = readEnvValue("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase admin configuration missing: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required."
    );
  }

  supabaseAdminClientInstance = createClient<Database>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return supabaseAdminClientInstance;
}

// Compat shim for legacy imports. Prefer getSupabaseAdminClient().
export const supabaseAdminClient = new Proxy({} as ReturnType<typeof getSupabaseAdminClient>, {
  get(_target, prop, receiver) {
    const client = getSupabaseAdminClient();
    return Reflect.get(client, prop, receiver);
  },
});
