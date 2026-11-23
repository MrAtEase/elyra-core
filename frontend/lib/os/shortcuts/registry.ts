import type { UiQuickAction } from "@/components/os/kernel/types";
import type { AIDockSurfaceId } from "@/components/agent/aidock/types";
import { matchesActionToSurface } from "@/components/agent/aidock/actionFilter";

type ShortcutPreset = {
  id: string;
  label: string;
  keywords: string[];
};

const PRESETS: Record<AIDockSurfaceId, ShortcutPreset[]> = {
  home: [],
  agent: [],
  goals: [{ id: "goal-plan", label: "Plan next goal step", keywords: ["goal", "plan", "next step"] }],
  apps: [],
  system: [],
  mail: [
    { id: "mail-summarize", label: "Summarize thread", keywords: ["summarize", "summary"] },
    { id: "mail-reply", label: "Draft reply", keywords: ["reply", "draft"] },
    { id: "mail-tasks", label: "Extract tasks", keywords: ["task", "action item"] },
  ],
  calendar: [
    { id: "calendar-schedule", label: "Schedule meeting", keywords: ["schedule", "meeting", "event"] },
    { id: "calendar-conflicts", label: "Find conflicts", keywords: ["conflict", "free slot"] },
  ],
  tasks: [
    { id: "tasks-prioritize", label: "Prioritize tasks", keywords: ["prioritize", "task"] },
    { id: "tasks-plan", label: "Plan today", keywords: ["today", "plan"] },
  ],
  drive: [
    { id: "drive-search", label: "Search files", keywords: ["search", "file"] },
    { id: "drive-organize", label: "Organize folder", keywords: ["folder", "organize"] },
  ],
  slides: [
    { id: "slides-outline", label: "Create outline", keywords: ["outline", "deck"] },
    { id: "slides-headline", label: "Rewrite headline", keywords: ["headline", "rewrite"] },
    { id: "slides-chart", label: "Add chart", keywords: ["chart"] },
  ],
  docs: [{ id: "docs-structure", label: "Improve structure", keywords: ["structure", "rewrite"] }],
  research: [{ id: "research-brief", label: "Create research brief", keywords: ["research", "brief"] }],
  weather: [{ id: "weather-plan", label: "Weather-based planning", keywords: ["weather", "forecast"] }],
  translate: [{ id: "translate-quick", label: "Translate selection", keywords: ["translate"] }],
};

function actionNeedle(action: UiQuickAction) {
  return `${action.label} ${action.intent} ${action.tool_ref} ${action.app_id}`.toLowerCase();
}

export function resolveShortcutsForSurface(actions: UiQuickAction[], surface: AIDockSurfaceId): UiQuickAction[] {
  const surfaceMatched = actions.filter((action) => matchesActionToSurface(action, surface));
  if (surfaceMatched.length > 0) {
    return surfaceMatched.slice(0, 8);
  }

  const presets = PRESETS[surface];
  if (!presets.length) return actions.slice(0, 8);

  const ranked = actions
    .map((action) => {
      const needle = actionNeedle(action);
      const score = presets.reduce((acc, preset) => {
        const matches = preset.keywords.some((keyword) => needle.includes(keyword));
        return acc + (matches ? 1 : 0);
      }, 0);
      return { action, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked.map((entry) => entry.action).slice(0, 8);
}
