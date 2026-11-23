export type SystemState = "calm" | "working" | "attention" | "error";

export const DEFAULT_STATE: SystemState = "calm";

export type SystemStatePreset = {
  accentA: string;
  accentB: string;
  glow: number;
  speed: number;
  wobble: number;
};

export const STATE_PRESETS: Record<SystemState, SystemStatePreset> = {
  calm: {
    accentA: "#7dd3fc",
    accentB: "#a78bfa",
    glow: 0.45,
    speed: 0.55,
    wobble: 0.35,
  },
  working: {
    accentA: "#93c5fd",
    accentB: "#818cf8",
    glow: 0.62,
    speed: 0.9,
    wobble: 0.6,
  },
  attention: {
    accentA: "#fde68a",
    accentB: "#f472b6",
    glow: 0.7,
    speed: 1,
    wobble: 0.8,
  },
  error: {
    accentA: "#fb7185",
    accentB: "#fb923c",
    glow: 0.68,
    speed: 1.15,
    wobble: 0.9,
  },
};
