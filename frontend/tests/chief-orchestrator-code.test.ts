import test from "node:test";
import assert from "node:assert/strict";
import { isCodeIntent, mapChiefCodeSteps } from "@/lib/orb-os/orchestrator/chiefCode";
import type { CodeTaskContract } from "@/types/taskContract";

const sampleContract: CodeTaskContract = {
  id: "contract-1",
  executorType: "code",
  title: "Fix weekly weather visibility",
  goal: "Fix the weekly weather module visibility issue.",
  summary: "Workspace context: Elyra Core product UI stabilization",
  scope: {
    workspaceId: "ws-elyra-core",
    repoUrl: "/Users/paulodak/Projects/elyra-core/frontend",
    branch: "main",
    selectedFiles: ["components/os/apps/weather/WeatherWindow.tsx"],
  },
  constraints: {
    stage: "playground",
    terminalAccess: true,
    executionMode: "adaptive",
    agentRole: "frontend",
  },
  definitionOfDone: ["Apply the requested repository change only inside the agreed scope."],
  verification: ["Run the standard verification gates that are available for the repo."],
  source: "chief_orchestrator",
  createdAt: new Date().toISOString(),
};

test("isCodeIntent detects code-like prompts", () => {
  assert.equal(isCodeIntent("fix the weather build issue"), true);
  assert.equal(isCodeIntent("/build change the UI shell"), true);
  assert.equal(isCodeIntent("check my mail and summarize"), false);
});

test("mapChiefCodeSteps reflects plan-ready contract state", () => {
  const steps = mapChiefCodeSteps({
    contract: sampleContract,
    phase: "plan_ready",
    executorLabel: "Coding Agent",
  });

  assert.equal(steps.length, 3);
  assert.equal(steps[0]?.status, "done");
  assert.equal(steps[1]?.status, "done");
  assert.equal(steps[1]?.detail.includes("selected file"), true);
  assert.equal(steps[2]?.status, "ready");
});

test("mapChiefCodeSteps surfaces failures on dispatch step", () => {
  const steps = mapChiefCodeSteps({
    contract: sampleContract,
    phase: "failed",
    executorLabel: "Coding Agent",
    error: "Dispatch failed",
  });

  assert.equal(steps[2]?.status, "failed");
  assert.equal(steps[2]?.detail, "Dispatch failed");
});
