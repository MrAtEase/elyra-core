export const LAYOUT = {
  maxWidth: "1180px",
  gutters: {
    horizontal: "clamp(1.25rem, 3vw, 2.4rem)",
    vertical: "clamp(1rem, 2vw, 1.75rem)",
  },
  verticalRhythm: "1.5rem",
};

export const COLORS = {
  neutralSurface: "var(--panel)",
  neutralBackdrop: "color-mix(in srgb, var(--text) 18%, transparent)",
  accentGradient:
    "linear-gradient(135deg, color-mix(in srgb, var(--accent) 80%, transparent), color-mix(in srgb, var(--accent) 40%, transparent))",
};

export const ORB = {
  size: "320px",
  topOffset: "1.75rem",
  safeArea: "2.5rem",
};

export const COMMAND_LINE = {
  height: "62px",
  bottomOffset: "1.8rem",
  maxWidth: "720px",
};

export const UI = {
  labelPolicy: "minimal",
  chipStyle: {
    background: "rgba(255, 255, 255, 0.12)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    borderRadius: "999px",
    padding: "0.35rem 1rem",
    fontSize: "0.78rem",
  },
};
