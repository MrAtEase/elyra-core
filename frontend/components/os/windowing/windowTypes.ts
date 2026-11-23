export type OrbRuntimeState =
  | "idle"
  | "thinking"
  | "listening"
  | "planning"
  | "executing"
  | "waiting_for_auth"
  | "waiting_for_approval"
  | "success"
  | "error";

export type AppId =
  | "runs"
  | "approvals"
  | "audit"
  | "admin"
  | "design_ai"
  | "mail"
  | "calendar"
  | "tasks"
  | "files"
  | "drive"
  | "slides"
  | "docs"
  | "build"
  | "marketplace"
  | "settings"
  | "image_studio";

export type DensityMode = "normal" | "compact";

export type WallpaperPreset = {
  id: string;
  label: string;
  type: "gradient" | "image";
  value: string;
};

export type AppearanceSettings = {
  wallpaperId: string;
  density: DensityMode;
  reduceMotion: boolean;
  grain: boolean;
};

export type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowInstance = {
  id: string;
  appId: AppId;
  title: string;
  rect: WindowRect;
  minWidth: number;
  minHeight: number;
  minimized: boolean;
  maximized: boolean;
  z: number;
  lastRectBeforeMaximize?: WindowRect;
};

export type AppDefinition = {
  id: AppId;
  title: string;
  defaultRect: WindowRect;
  minWidth: number;
  minHeight: number;
  singleton?: boolean;
};
