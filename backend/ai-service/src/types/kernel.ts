/** Mirrors frontend/components/os/kernel/types.ts */

export type AppId =
  | "mail"
  | "calendar"
  | "tasks"
  | "files"
  | "builder"
  | "settings_ai"
  | "settings_os"
  | "settings_admin";

export type OrbVisualState = "idle" | "thinking" | "attention" | "degraded";

export type WorkspaceType = "individual" | "organization" | "platform";
