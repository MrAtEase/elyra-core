import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceIdFromRequestParts } from "@/lib/api/workspaceRequest";

test("resolves workspace_id from snake_case query", () => {
  const result = resolveWorkspaceIdFromRequestParts({ workspace_id: "ws-personal" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workspaceId, "ws-personal");
  assert.equal(result.source, "query.workspace_id");
});

test("resolves workspaceId from camelCase query", () => {
  const result = resolveWorkspaceIdFromRequestParts({ workspaceId: "ws-fish-delish" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workspaceId, "ws-fish-delish");
  assert.equal(result.source, "query.workspaceId");
});

test("resolves workspace from header", () => {
  const result = resolveWorkspaceIdFromRequestParts({ xWorkspaceId: "ws-elyra-core" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workspaceId, "ws-elyra-core");
  assert.equal(result.source, "header.x-workspace-id");
});

test("normalizes workspace aliases and indexed ids", () => {
  const one = resolveWorkspaceIdFromRequestParts({ workspaceId: "fish-delish" });
  const two = resolveWorkspaceIdFromRequestParts({ workspaceId: "ws-personal:1" });
  const three = resolveWorkspaceIdFromRequestParts({ workspaceId: "person" });
  const four = resolveWorkspaceIdFromRequestParts({ workspaceId: "ws-person" });
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  assert.equal(three.ok, true);
  assert.equal(four.ok, true);
  if (!one.ok || !two.ok || !three.ok || !four.ok) return;
  assert.equal(one.workspaceId, "ws-fish-delish");
  assert.equal(two.workspaceId, "ws-personal");
  assert.equal(three.workspaceId, "ws-personal");
  assert.equal(four.workspaceId, "ws-personal");
});

test("returns missing_workspace_id when required", () => {
  const result = resolveWorkspaceIdFromRequestParts({ required: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "missing_workspace_id");
});

test("returns invalid_workspace_id for invalid patterns", () => {
  const result = resolveWorkspaceIdFromRequestParts({ workspaceId: "ws-personal:foo" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "invalid_workspace_id");
});
