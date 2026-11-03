"use client";

import { useMemo } from "react";

import type { SystemState } from "@/components/merlin/systemState";

type Props = {
  className?: string;
  preview?: boolean;
  size?: number;
  systemState?: SystemState;
};

const getReducedMotionPreference = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)")?.matches ?? false;
};

export default function DarkNeonOrb({ className, preview, size }: Props) {
  const reducedMotion = useMemo(getReducedMotionPreference, []);
  const inlineSize = size ? { width: size, height: size } : undefined;
  const staticMode = reducedMotion || preview;
  const motionClass = staticMode ? "dark-neon-orb--static" : "";

  return (
    <div
      className={`dark-neon-orb ${motionClass} ${className ?? ""}`}
      style={inlineSize}
      aria-hidden="true"
    >
      <span className="dark-neon-orb__inner" />
      <span className="dark-neon-orb__rim" />
    </div>
  );
}
