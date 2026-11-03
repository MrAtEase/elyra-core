import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import type { Database, PublicSchemaName } from "@/lib/supabase/types";

type SupabaseCredentials = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

let cachedClient: SupabaseClient<Database> | null = null;

function resolveCredentials(): SupabaseCredentials {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      `Missing ${SUPABASE_URL_ENV} or ${SUPABASE_ANON_KEY_ENV}. Supabase client cannot be initialized.`,
    );
  }
  return { supabaseUrl, supabaseAnonKey };
}

type TypedClientOptions = SupabaseClientOptions<PublicSchemaName>;
type PartialClientOptions = Partial<TypedClientOptions>;

const DEFAULT_CLIENT_OPTIONS: TypedClientOptions = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Force PKCE so production OAuth returns a code that Supabase can exchange
    // reliably, instead of depending on brittle implicit/hash callback data.
    flowType: "pkce",
  },
};

function mergeOptions(overrides?: PartialClientOptions): TypedClientOptions {
  if (!overrides) {
    return DEFAULT_CLIENT_OPTIONS;
  }

  return {
    ...DEFAULT_CLIENT_OPTIONS,
    ...overrides,
    auth: {
      ...DEFAULT_CLIENT_OPTIONS.auth,
      ...(overrides.auth ?? {}),
    },
  };
}

export function getSupabaseCredentials() {
  return resolveCredentials();
}

export function getSupabaseClient(overrides?: PartialClientOptions): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const { supabaseUrl, supabaseAnonKey } = resolveCredentials();
  cachedClient = createClient(supabaseUrl, supabaseAnonKey, mergeOptions(overrides));
  return cachedClient;
}
