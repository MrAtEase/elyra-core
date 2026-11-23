import test from "node:test";
import assert from "node:assert/strict";
import type { UiQuickAction } from "@/components/os/kernel/types";
import { filterActionsForSurface, matchesActionToSurface } from "@/components/agent/aidock/actionFilter";

function action(partial: Partial<UiQuickAction>): UiQuickAction {
  return {
    app_id: "google_workspace",
    app_name: "Google Workspace",
    action_id: "a1",
    label: "Draft reply",
    intent: "draft",
    tool_ref: "google_mail.draft_reply",
    requires_auth: true,
    requires_approval: false,
    state: "ready",
    badges: ["connected"],
    ...partial,
  };
}

test("matches by tool family for surface", () => {
  assert.equal(matchesActionToSurface(action({ tool_ref: "google_mail.draft_reply" }), "mail"), true);
  assert.equal(matchesActionToSurface(action({ tool_ref: "google_calendar.create_event" }), "mail"), false);
  assert.equal(matchesActionToSurface(action({ tool_ref: "google_slides.create_outline" }), "slides"), true);
});

test("filters actions for selected surface", () => {
  const items = [
    action({ action_id: "m1", tool_ref: "google_mail.draft_reply", label: "Draft reply" }),
    action({ action_id: "c1", tool_ref: "google_calendar.create_event", label: "Create event" }),
  ];
  const mail = filterActionsForSurface(items, "mail");
  assert.equal(mail.length, 1);
  assert.equal(mail[0]?.action_id, "m1");
});

test("falls back to full list when no surface match", () => {
  const items = [
    action({ action_id: "x1", tool_ref: "google_mail.draft_reply" }),
    action({ action_id: "x2", tool_ref: "google_calendar.create_event" }),
  ];
  const weather = filterActionsForSurface(items, "weather");
  assert.equal(weather.length, 2);
});
