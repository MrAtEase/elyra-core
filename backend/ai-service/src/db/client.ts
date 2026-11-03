import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (_client) return _client;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = config();
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return _client;
}
