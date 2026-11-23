import test from "node:test";
import assert from "node:assert/strict";
import { panelRegistry } from "@/components/agent/aidock/panelRegistry";

test("AIDock panel order stays fixed for MVP", () => {
  assert.deepEqual(
    panelRegistry.map((panel) => panel.id),
    ["actions", "runs", "intents", "artifacts", "project", "chat"],
  );
});

test("panel ids are unique", () => {
  const ids = panelRegistry.map((panel) => panel.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("home surface hides chat and actions", () => {
  const visibleOnHome = panelRegistry.filter((panel) => panel.isVisible("home")).map((panel) => panel.id);
  assert.equal(visibleOnHome.includes("chat"), false);
  assert.equal(visibleOnHome.includes("actions"), false);
  assert.equal(visibleOnHome.includes("runs"), true);
  assert.equal(visibleOnHome.includes("artifacts"), true);
  assert.equal(visibleOnHome.includes("project"), true);
});

test("app surfaces show actions and chat", () => {
  const visibleOnSlides = panelRegistry.filter((panel) => panel.isVisible("slides")).map((panel) => panel.id);
  assert.equal(visibleOnSlides.includes("actions"), true);
  assert.equal(visibleOnSlides.includes("chat"), true);
});
