export type OrbStatus = "calm" | "focus" | "thinking" | "warning" | "error" | "offline";

export type OrbState = {
  status: OrbStatus;
  intensity: number;
  ringProgress: number;
  label?: string;
};

export const ORB_STATUS_INTENSITY: Record<OrbStatus, number> = {
  calm: 0.35,
  focus: 0.8,
  thinking: 0.65,
  warning: 0.72,
  error: 0.9,
  offline: 0.2,
};

export const ORB_STATUS_LABELS: Record<OrbStatus, string[]> = {
  calm: ["Worker OK", "Calm core", "Ready for new beams"],
  focus: ["Laser focus", "Input locked", "Eyes on the stack"],
  thinking: ["Synthesizing", "Weaving context", "Merlin is processing"],
  warning: ["Alert ready", "Amber tick", "Keep an eye"],
  error: ["Fracture stage", "Red alert", "Retry recommended"],
  offline: ["Offline", "Standby mode", "No signal"],
};

export const ORB_STATUS_CYCLE: OrbStatus[] = ["calm", "focus", "thinking", "warning", "error", "offline"];

export function pickOrbLabel(status: OrbStatus) {
  const options = ORB_STATUS_LABELS[status] ?? [];
  if (!options.length) {
    return "Merlin ready";
  }
  const index = Math.floor(Math.random() * options.length);
  return options[index] ?? "Merlin ready";
}
