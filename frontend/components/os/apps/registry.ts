import type { AppDefinition, AppId } from "@/components/os/windowing/windowTypes";

export const APP_REGISTRY: Record<AppId, AppDefinition> = {
  mail: {
    id: "mail",
    title: "Mail",
    defaultRect: { x: 80, y: 100, width: 820, height: 520 },
    minWidth: 560,
    minHeight: 360,
    singleton: true,
  },
  calendar: {
    id: "calendar",
    title: "Calendar",
    defaultRect: { x: 140, y: 120, width: 740, height: 520 },
    minWidth: 480,
    minHeight: 360,
    singleton: true,
  },
  tasks: {
    id: "tasks",
    title: "Tasks",
    defaultRect: { x: 180, y: 120, width: 560, height: 480 },
    minWidth: 400,
    minHeight: 340,
    singleton: true,
  },
  files: {
    id: "files",
    title: "Files",
    defaultRect: { x: 200, y: 140, width: 640, height: 460 },
    minWidth: 400,
    minHeight: 300,
    singleton: true,
  },
  slides: {
    id: "slides",
    title: "Slides",
    defaultRect: { x: 160, y: 110, width: 700, height: 480 },
    minWidth: 480,
    minHeight: 340,
    singleton: true,
  },
  runs: {
    id: "runs",
    title: "Runs",
    defaultRect: { x: 120, y: 100, width: 680, height: 480 },
    minWidth: 400,
    minHeight: 300,
    singleton: true,
  },
  approvals: {
    id: "approvals",
    title: "Approvals",
    defaultRect: { x: 180, y: 130, width: 560, height: 420 },
    minWidth: 360,
    minHeight: 280,
    singleton: true,
  },
  audit: {
    id: "audit",
    title: "Audit",
    defaultRect: { x: 200, y: 120, width: 600, height: 440 },
    minWidth: 400,
    minHeight: 300,
    singleton: true,
  },
  admin: {
    id: "admin",
    title: "Admin",
    defaultRect: { x: 160, y: 110, width: 640, height: 460 },
    minWidth: 400,
    minHeight: 300,
    singleton: true,
  },
  design_ai: {
    id: "design_ai",
    title: "Design AI",
    defaultRect: { x: 140, y: 100, width: 700, height: 480 },
    minWidth: 480,
    minHeight: 340,
    singleton: true,
  },
  drive: {
    id: "drive",
    title: "Drive",
    defaultRect: { x: 180, y: 130, width: 640, height: 460 },
    minWidth: 400,
    minHeight: 300,
    singleton: true,
  },
  docs: {
    id: "docs",
    title: "Docs",
    defaultRect: { x: 120, y: 100, width: 700, height: 500 },
    minWidth: 480,
    minHeight: 360,
    singleton: true,
  },
  build: {
    id: "build",
    title: "Build",
    defaultRect: { x: 100, y: 100, width: 760, height: 520 },
    minWidth: 520,
    minHeight: 380,
    singleton: true,
  },
  marketplace: {
    id: "marketplace",
    title: "Marketplace",
    defaultRect: { x: 160, y: 110, width: 680, height: 480 },
    minWidth: 440,
    minHeight: 320,
    singleton: true,
  },
  settings: {
    id: "settings",
    title: "Settings",
    defaultRect: { x: 200, y: 130, width: 560, height: 420 },
    minWidth: 360,
    minHeight: 280,
    singleton: true,
  },
  image_studio: {
    id: "image_studio",
    title: "Image Studio",
    defaultRect: { x: 160, y: 100, width: 680, height: 540 },
    minWidth: 480,
    minHeight: 380,
    singleton: true,
  },
};

export type DockApp = {
  id: AppId;
  label: string;
  monogram: string;
  color: string;
};

export const DOCK_APPS: DockApp[] = [
  { id: "mail", label: "Mail", monogram: "M", color: "rgba(56, 189, 248, 0.8)" },
  { id: "calendar", label: "Calendar", monogram: "C", color: "rgba(168, 85, 247, 0.8)" },
  { id: "tasks", label: "Tasks", monogram: "T", color: "rgba(251, 191, 36, 0.8)" },
  { id: "files", label: "Files", monogram: "F", color: "rgba(34, 197, 94, 0.8)" },
  { id: "slides", label: "Slides", monogram: "S", color: "rgba(251, 146, 60, 0.8)" },
  { id: "docs", label: "Docs", monogram: "D", color: "rgba(96, 165, 250, 0.8)" },
  { id: "settings", label: "Settings", monogram: "G", color: "rgba(148, 163, 184, 0.7)" },
];
