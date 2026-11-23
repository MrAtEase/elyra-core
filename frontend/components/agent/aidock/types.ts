export type AIDockSurfaceId =
  | "home"
  | "agent"
  | "goals"
  | "apps"
  | "system"
  | "mail"
  | "calendar"
  | "tasks"
  | "drive"
  | "slides"
  | "docs"
  | "research"
  | "weather"
  | "translate";

export type DockPanelId = "actions" | "runs" | "artifacts" | "project" | "chat" | "intents";

export type AIDockContext = {
  projectId: string | null;
  artifactId: string | null;
  runId: string | null;
  threadId: string | null;
};

export type DockRunStatus = "idle" | "planning" | "running" | "awaiting_approval" | "success" | "error";
