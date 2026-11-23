import { z } from "zod";

export const pluginManifestSchema = z.object({
  plugin_id: z.string().regex(/^[a-z0-9._-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  runtime: z.enum(["worker_webhook", "worker_internal", "sandbox_http"]),
  permissions: z.object({
    tools: z.array(z.string().min(1)).default([]),
    integrations: z.array(z.string().min(1)).default([]),
    capabilities: z.array(z.string().min(1)).default([]),
  }),
  limits: z.object({
    rate_limit_per_minute: z.number().int().min(1).max(10_000),
    max_cost_cents_per_day: z.number().int().min(0).max(1_000_000),
    timeout_ms: z.number().int().min(100).max(120_000),
  }),
  risk_level: z.enum(["read_only", "writes", "destructive"]),
  install: z.object({
    requires_approval: z.boolean().default(true),
    requires_owner: z.boolean().default(true),
  }),
  rollback: z.object({
    supports_rollback: z.boolean().default(true),
    previous_version: z.string().optional(),
  }).default({ supports_rollback: true }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function validatePluginManifest(input: unknown): {
  ok: boolean;
  issues: string[];
  manifest?: PluginManifest;
} {
  const parsed = pluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    };
  }

  const manifest = parsed.data;
  const issues: string[] = [];

  if (manifest.risk_level === "destructive" && !manifest.install.requires_owner) {
    issues.push("destructive plugins must require owner installation");
  }

  if (manifest.runtime === "sandbox_http" && manifest.permissions.tools.includes("builder.applyPatch")) {
    issues.push("sandbox_http runtime cannot request builder.applyPatch");
  }

  return {
    ok: issues.length === 0,
    issues,
    manifest,
  };
}
