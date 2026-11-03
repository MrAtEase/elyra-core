import test from "node:test";
import assert from "node:assert/strict";
import { buildToolTaskContract, detectChiefExecutorType, mapChiefSteps } from "@/lib/orb-os/orchestrator/chiefDelegation";

test("detectChiefExecutorType routes code, mail, calendar, and tasks intents", () => {
  assert.equal(detectChiefExecutorType("fix the weather build issue"), "code");
  assert.equal(detectChiefExecutorType("check my mail and draft a reply to founder@example.com"), "mail");
  assert.equal(detectChiefExecutorType("plan my week and create a calendar block"), "calendar");
  assert.equal(detectChiefExecutorType("create a task to review the investor deck"), "tasks");
});

test("buildToolTaskContract creates a mail draft contract with draft-safe action", () => {
  const contract = buildToolTaskContract({
    workspaceId: "ws-personal",
    executorType: "mail",
    intent: "Draft a reply to founder@example.com about the incubator call tomorrow",
    workspaceBrainProfile: { mission: "Stay responsive", goal: "Prepare fundraising conversations" },
  });

  assert.equal(contract.executorType, "mail");
  assert.equal(contract.action.toolName, "google_mail.draft_reply");
  assert.deepEqual(contract.action.args.to, ["founder@example.com"]);
  assert.equal(contract.definitionOfDone[1], "Do not send the email automatically.");
});

test("buildToolTaskContract creates tasks list and task create actions correctly", () => {
  const listContract = buildToolTaskContract({
    workspaceId: "ws-personal",
    executorType: "tasks",
    intent: "show my open tasks for this week",
  });
  const createContract = buildToolTaskContract({
    workspaceId: "ws-personal",
    executorType: "tasks",
    intent: "create a task to finalize the investor memo",
  });

  assert.equal(listContract.action.toolName, "tasks.list");
  assert.equal(createContract.action.toolName, "tasks.create");
  assert.equal(createContract.action.args.priority, "p2");
});

test("mapChiefSteps reflects plan-ready and done states for non-code executors", () => {
  const contract = buildToolTaskContract({
    workspaceId: "ws-personal",
    executorType: "calendar",
    intent: "plan a strategy meeting with the product team",
  });

  const readySteps = mapChiefSteps({ contract, phase: "plan_ready", executorLabel: "Calendar Agent" });
  const doneSteps = mapChiefSteps({ contract, phase: "done", executorLabel: "Calendar Agent" });

  assert.equal(readySteps[2]?.status, "ready");
  assert.equal(doneSteps[2]?.status, "done");
  assert.equal(doneSteps[2]?.detail, "Calendar Agent finished the delegated task.");
});
