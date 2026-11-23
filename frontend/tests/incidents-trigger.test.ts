import test from "node:test";
import assert from "node:assert/strict";
import { deriveIncidentCandidatesFromAggregate } from "@/lib/orb-os/observability/store";

test("creates incident candidates for auth failure and queue lag spikes", () => {
  const incidents = deriveIncidentCandidatesFromAggregate({
    auth_failure_rate: 0.4,
    queue_lag: 180,
    run_success_rate: 0.7,
    p95_tool_latency: 25000,
  });

  const types = incidents.map((entry) => entry.incident_type);
  assert.equal(types.includes("auth_failure_spike"), true);
  assert.equal(types.includes("queue_lag_spike"), true);
  assert.equal(types.includes("tool_error_spike"), true);
});
