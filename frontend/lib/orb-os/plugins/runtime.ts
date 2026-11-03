import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type PluginDispatchResult = {
  ok: true;
  output: Record<string, unknown>;
  provider: string;
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function enforceRateLimit(key: string, limitPerMinute: number) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (current.count >= limitPerMinute) {
    throw new Error("PLUGIN_RATE_LIMITED");
  }
  current.count += 1;
}

function ensureAllowedEndpoint(url: string, runtime: string) {
  if (runtime !== "sandbox_http") return;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const allowed = ["api.example.com", "plugins.elyra.app"];
  if (!allowed.includes(host)) {
    throw new Error("PLUGIN_ENDPOINT_NOT_ALLOWED");
  }
}

export async function dispatchPluginTool(input: {
  workspaceId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<PluginDispatchResult> {
  if (!input.toolName.startsWith("plugin.")) {
    throw new Error("NOT_A_PLUGIN_TOOL");
  }

  const [, pluginId, ...rest] = input.toolName.split(".");
  const operation = rest.join(".");
  if (!pluginId || !operation) {
    throw new Error("INVALID_PLUGIN_TOOL_NAME");
  }

  const supabase = getSupabaseAdminClient();
  const installed = await supabase
    .from("workspace_plugins")
    .select("plugin_id,version,enabled")
    .eq("workspace_id", input.workspaceId)
    .eq("plugin_id", pluginId)
    .maybeSingle();

  if (!installed.data || !installed.data.enabled) {
    throw new Error("PLUGIN_NOT_INSTALLED");
  }

  const manifestRes = await supabase
    .from("plugin_manifests")
    .select("manifest_json")
    .eq("plugin_id", pluginId)
    .eq("version", String(installed.data.version))
    .maybeSingle();

  const manifest = manifestRes.data?.manifest_json as Record<string, unknown> | undefined;
  if (!manifest) {
    throw new Error("PLUGIN_MANIFEST_NOT_FOUND");
  }

  const runtime = String(manifest.runtime ?? "sandbox_http");
  const limits = (manifest.limits as Record<string, unknown> | undefined) ?? {};
  const rateLimit = Number(limits.rate_limit_per_minute ?? 60);
  const maxCost = Number(limits.max_cost_cents_per_day ?? 10_000);

  enforceRateLimit(`${input.workspaceId}:${pluginId}:${operation}`, rateLimit);

  const usageToday = await supabase
    .from("os_metric_samples")
    .select("metric_value")
    .eq("workspace_id", input.workspaceId)
    .eq("metric_name", "queue_lag")
    .gte("observed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if ((usageToday.data?.length ?? 0) > maxCost) {
    throw new Error("PLUGIN_BUDGET_EXCEEDED");
  }

  if (runtime === "sandbox_http") {
    const endpoint = String((manifest.endpoint as string | undefined) ?? "https://plugins.elyra.app/execute");
    ensureAllowedEndpoint(endpoint, runtime);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugin_id: pluginId, operation, args: input.args }),
    });
    const output = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !output) {
      throw new Error("PLUGIN_EXECUTION_FAILED");
    }
    return { ok: true, output, provider: runtime };
  }

  return {
    ok: true,
    provider: runtime,
    output: {
      plugin_id: pluginId,
      operation,
      accepted: true,
      mode: runtime,
    },
  };
}
