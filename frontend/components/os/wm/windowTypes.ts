export type AppId =
  | "mail"
  | "calendar"
  | "tasks"
  | "files"
  | "slides"
  | "docs"
  | "settings";

export type OrbState = "idle" | "thinking" | "active" | "attention" | "error";

export type WizardType = "mailCompose" | "calendarEvent" | "tasksBatch";

export type WindowInstance = {
  id: string;
  type: AppId;
  title: string;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  isMaximized: boolean;
};

export type IntentRecord = {
  id: string;
  text: string;
  createdAt: number;
};

export type WizardState = {
  isOpen: boolean;
  type: WizardType | null;
  intentId: string | null;
};

export const APP_TITLES: Record<AppId, string> = {
  mail: "Mail",
  calendar: "Calendar",
  tasks: "Tasks",
  files: "Files",
  slides: "Slides",
  docs: "Docs",
  settings: "Settings",
};

export const APP_ORDER: AppId[] = [
  "mail",
  "calendar",
  "tasks",
  "files",
  "slides",
  "docs",
  "settings",
];
