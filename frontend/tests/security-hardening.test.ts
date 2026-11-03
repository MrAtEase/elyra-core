import test from "node:test";
import assert from "node:assert/strict";
import { deriveWorkspaceKey } from "@/lib/orb-os/integrations/keys";
import { mapGoogleTokenFailure } from "@/lib/orb-os/integrations/failures";
import { validatePluginManifest } from "@/lib/orb-os/plugins/schema";
import { shouldTriggerIncident } from "@/lib/orb-os/observability/metrics";

test("deriveWorkspaceKey is deterministic per workspace and isolated", () => {
  const master = Buffer.alloc(32, 7);
  const a1 = deriveWorkspaceKey(master, "ws-a");
  const a2 = deriveWorkspaceKey(master, "ws-a");
  const b1 = deriveWorkspaceKey(master, "ws-b");
  assert.equal(a1.equals(a2), true);
  assert.equal(a1.equals(b1), false);
  assert.equal(a1.byteLength, 32);
});

test("invalid_grant maps to needs_auth", () => {
  const mapped = mapGoogleTokenFailure({ error: "invalid_grant", description: "Token has been expired" });
  assert.equal(mapped.needs_auth, true);
  assert.equal(mapped.code, "GOOGLE_REAUTH_REQUIRED");
});

test("plugin manifest validation enforces sandbox constraints", () => {
  const result = validatePluginManifest({
    plugin_id: "elyra.bad-plugin",
    name: "Bad Plugin",
    version: "1.0.0",
    runtime: "sandbox_http",
    permissions: { tools: ["builder.applyPatch"], integrations: [], capabilities: [] },
    limits: { rate_limit_per_minute: 100, max_cost_cents_per_day: 1000, timeout_ms: 2000 },
    risk_level: "writes",
    install: { requires_approval: true, requires_owner: true },
    rollback: { supports_rollback: true },
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.length > 0, true);
});

test("incident trigger activates on critical thresholds", () => {
  const outcome = shouldTriggerIncident({
    runSuccessRate: 0.72,
    queueLagSeconds: 240,
    authFailureRate: 0.33,
    p95ToolLatencyMs: 24_000,
  });

  assert.equal(outcome.trigger, true);
  assert.equal(outcome.reasons.includes("queue_lag_critical"), true);
});
