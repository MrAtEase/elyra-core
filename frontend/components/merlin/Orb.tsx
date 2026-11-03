"use client";

import type { CSSProperties } from "react";
import type { OrbStatus } from "./orbConfig";

type Props = {
  mode: "classic" | "holo";
  status?: OrbStatus;
  intensity?: number;
  size?: "hero" | "mini";
  progress?: number;
  className?: string;
};

const FALLBACK_STATUS: OrbStatus = "calm";
const FALLBACK_INTENSITY = 0.6;

export default function Orb({
  mode,
  status,
  intensity,
  size = "hero",
  progress = 0,
  className = "",
}: Props) {
  const resolvedStatus = status ?? FALLBACK_STATUS;
  const clampedIntensity = Math.max(0, Math.min(1, intensity ?? FALLBACK_INTENSITY));
  const normalizedProgress = Math.max(0, Math.min(1, progress ?? 0));
  const timerActive = normalizedProgress > 0;
  const inlineStyle = {
    "--mesh-orb-intensity": clampedIntensity,
    "--mesh-orb-progress-angle": `${normalizedProgress * 360}deg`,
  } as CSSProperties & {
    "--mesh-orb-intensity": number;
    "--mesh-orb-progress-angle": string;
  };

  const rootClass = [
    "mesh-orb",
    `mesh-orb--${size}`,
    `mesh-orb--${mode}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      data-mode={mode}
      data-status={resolvedStatus}
      data-size={size}
      data-timer-active={timerActive ? "true" : "false"}
      style={inlineStyle}
      aria-hidden="true"
    >
      <div className="mesh-orb__halo" />
      <div className="mesh-orb__wireframe" />
      <div className="mesh-orb__core">
        <span className="mesh-orb__core-sheen" />
        <span className="mesh-orb__core-depth" />
      </div>
      <div className="mesh-orb__scan" />
      <div className="mesh-orb__ring" />
      <span className="mesh-orb__noise" />
    </div>
  );
}
