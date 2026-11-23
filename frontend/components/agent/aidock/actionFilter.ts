import type { UiQuickAction } from "@/components/os/kernel/types";
import type { AIDockSurfaceId } from "@/components/agent/aidock/types";

const SURFACE_TOOL_HINTS: Record<AIDockSurfaceId, string[]> = {
  // Home: only general-purpose tools that are always ready (no Google OAuth required)
  home: ["daily_planner.", "company_builder.", "elli.", "tasks.", "web.", "translate.", "slides.create_presentation"],
  agent: [],
  goals: ["goal", "tasks.", "elli."],
  apps: [],
  system: [],
  mail: ["mail", "gmail", "google_mail"],
  calendar: ["calendar", "google_calendar"],
  tasks: ["tasks.", "task"],
  drive: ["drive", "google_drive", "files"],
  slides: ["slides", "google_slides", "presentation"],
  docs: ["docs", "google_docs", "document", "elli."],
  research: ["research", "search", "web."],
  weather: ["weather"],
  translate: ["translate"],
};

export function matchesActionToSurface(action: UiQuickAction, activeSurface: AIDockSurfaceId): boolean {
  const hints = SURFACE_TOOL_HINTS[activeSurface];
  if (hints.length === 0) return true;
  const needle = `${action.app_id} ${action.tool_ref} ${action.label}`.toLowerCase();
  return hints.some((hint) => needle.includes(hint));
}

export function filterActionsForSurface(actions: UiQuickAction[], activeSurface: AIDockSurfaceId): UiQuickAction[] {
  const matched = actions.filter((action) => matchesActionToSurface(action, activeSurface));
  return matched.length > 0 ? matched : actions;
}
