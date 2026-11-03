import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import type { Database, PublicSchemaName } from "@/lib/supabase/types";

import { getSupabaseClient, getSupabaseCredentials } from "@/lib/supabase/client";

const isDevEnvironment = process.env.NODE_ENV !== "production";
let cachedRealtimeToken: string | null = null;

function applyToken(token: string) {
  if (cachedRealtimeToken === token) return;
  const client = getInitializedBrowserClient();
  client.realtime.setAuth(token);
  cachedRealtimeToken = token;
}

export async function ensureSupabaseToken(): Promise<string> {
  const client = getInitializedBrowserClient();
  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("Unable to read Supabase session access token.");
  }
  applyToken(accessToken);
  return accessToken;
}

function mergeHeadersWithToken(headersInit: HeadersInit | undefined, token: string) {
  const headers = new Headers(headersInit);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    try {
      return new URL(input, window.location.origin);
    } catch {
      return null;
    }
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      return new URL(input.url);
    } catch {
      return null;
    }
  }
  return null;
}

function isSupabaseAuthEndpoint(url: URL): boolean {
  try {
    const { supabaseUrl } = getSupabaseCredentials();
    const origin = new URL(supabaseUrl).origin;
    return url.origin === origin && url.pathname.startsWith("/auth/v1");
  } catch {
    return false;
  }
}

function hasAuthorizationHeader(headersInit: HeadersInit | undefined): boolean {
  const headers = new Headers(headersInit);
  return headers.has("Authorization");
}

async function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = resolveRequestUrl(input);
  if (requestUrl && isSupabaseAuthEndpoint(requestUrl)) {
    return fetch(input, init);
  }

  if (hasAuthorizationHeader(init?.headers)) {
    return fetch(input, init);
  }

  let token: string | null = null;
  try {
    token = await ensureSupabaseToken();
  } catch (error) {
    if (isDevEnvironment) {
      console.info(
        "[supabase/browser] request without session token (expected during auth bootstrap)",
        { input, reason: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  const headers = token
    ? mergeHeadersWithToken(init?.headers, token)
    : new Headers(init?.headers);

  const result = await fetch(input, { ...init, headers });
  if (result.status !== 401 || !token) {
    return result;
  }

  if (isDevEnvironment) {
    console.warn("Supabase fetch received 401 with token; retrying once", {
      input,
    });
  }

  try {
    const retryToken = await ensureSupabaseToken();
    const retryHeaders = mergeHeadersWithToken(init?.headers, retryToken);
    return await fetch(input, { ...init, headers: retryHeaders });
  } catch (error) {
    if (isDevEnvironment) {
      console.warn(
        "Supabase fetch 401 retry skipped because token refresh was unavailable",
        { input, reason: error instanceof Error ? error.message : String(error) }
      );
    }
    return result;
  }
}

function getBrowserClientOptions(): SupabaseClientOptions<PublicSchemaName> {
  return {
    realtime: {
      params: {
        eventsPerSecond: 5,
      },
    },
    global: {
      fetch: supabaseFetch,
    },
  };
}

function getInitializedBrowserClient(): SupabaseClient<Database> {
  return getSupabaseClient(getBrowserClientOptions());
}

export const supabaseBrowserClient = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getInitializedBrowserClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export const supabase = supabaseBrowserClient;
