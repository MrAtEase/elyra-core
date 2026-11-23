import test from "node:test";
import assert from "node:assert/strict";
import { buildChiefRunReadModel, summarizeChiefRunRow } from "@/lib/orb-os/orchestrator/chiefRunReadModel";

test("buildChiefRunReadModel marks approval and auth waits explicitly", () => {
  const approvalModel = buildChiefRunReadModel([
    { id: "1", event_type: "RUN_CREATED", created_at: "2026-03-11T10:00:00.000Z", payload_json: { summary: "Run created" } },
    { id: "2", event_type: "APPROVAL_REQUIRED", created_at: "2026-03-11T10:01:00.000Z", payload_json: { summary: "Approval required" } },
  ]);
  const authModel = buildChiefRunReadModel([
    { id: "1", event_type: "TOOL_STARTED", created_at: "2026-03-11T10:00:00.000Z", payload_json: { summary: "Tool started" } },
    { id: "2", event_type: "AUTH_REQUIRED", created_at: "2026-03-11T10:01:00.000Z", payload_json: { summary: "Auth required" } },
  ]);

  assert.equal(approvalModel.status, "waiting_for_approval");
  assert.equal(approvalModel.requiresApproval, true);
  assert.equal(authModel.status, "waiting_for_auth");
  assert.equal(authModel.requiresAuth, true);
});

test("buildChiefRunReadModel marks successful terminal runs", () => {
  const model = buildChiefRunReadModel([
    { id: "1", event_type: "TOOL_STARTED", created_at: "2026-03-11T10:00:00.000Z", payload_json: { summary: "Tool started" } },
    { id: "2", event_type: "RUN_SUCCEEDED", created_at: "2026-03-11T10:02:00.000Z", payload_json: { summary: "Run succeeded" } },
  ]);

  assert.equal(model.status, "succeeded");
  assert.equal(model.timeline[1]?.summary, "Run succeeded");
});

test("summarizeChiefRunRow extracts executor, title, and result summary", () => {
  const summary = summarizeChiefRunRow({
    id: "orch-1",
    status: "done",
    intent: "draft a reply",
    updated_at: "2026-03-11T10:03:00.000Z",
    error: null,
    plan_json: {
      executor: "mail",
      contract: { title: "Draft mail: Investor follow-up" },
      result: { summary: "mail executor finished with succeeded: gmail draft" },
    },
  });

  assert.equal(summary.executorType, "mail");
  assert.equal(summary.contractTitle, "Draft mail: Investor follow-up");
  assert.equal(summary.summary, "mail executor finished with succeeded: gmail draft");
});
