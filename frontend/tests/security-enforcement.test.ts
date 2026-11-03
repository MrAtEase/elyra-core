import test from "node:test";
import assert from "node:assert/strict";
import { enforceToolExecution } from "@/lib/orb-os/security/enforcement";
import { buildExampleBootstrapContract } from "@/lib/orb-os/contracts/examples";

const workspaceId = "ws-1";

test("blocks workspace scope mismatch", () => {
  const contract = buildExampleBootstrapContract(workspaceId);
  const decision = enforceToolExecution({
    role: "owner",
    contract,
    workspaceId,
    requestedWorkspaceId: "another",
    toolName: "web.search",
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, "WORKSPACE_SCOPE_MISMATCH");
});

test("requires auth for disconnected google integration", () => {
  const contract = buildExampleBootstrapContract(workspaceId);
  const decision = enforceToolExecution({
    role: "owner",
    contract,
    workspaceId,
    requestedWorkspaceId: workspaceId,
    toolName: "google_calendar.create_event",
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, "AUTH_REQUIRED");
});

test("requires approval for writes when auth is connected", () => {
  const contract = buildExampleBootstrapContract(workspaceId);
  contract.integration_status = contract.integration_status.map((entry) =>
    entry.integration_id === "google_oauth" ? { ...entry, state: "connected", connected: true } : entry,
  );

  const decision = enforceToolExecution({
    role: "owner",
    contract,
    workspaceId,
    requestedWorkspaceId: workspaceId,
    toolName: "google_calendar.create_event",
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.code, "APPROVAL_REQUIRED");
});

test("allows read-only weather tool without approval", () => {
  const contract = buildExampleBootstrapContract(workspaceId);
  const decision = enforceToolExecution({
    role: "owner",
    contract,
    workspaceId,
    requestedWorkspaceId: workspaceId,
    toolName: "weather.getForecast",
  });

  assert.equal(decision.ok, true);
});
