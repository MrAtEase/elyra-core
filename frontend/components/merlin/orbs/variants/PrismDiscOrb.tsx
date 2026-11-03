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

export default function PrismDiscOrb({ className, preview, size }: Props) {
  const reducedMotion = useMemo(getReducedMotionPreference, []);
  const inlineSize = size ? { width: size, height: size } : undefined;
  const staticMode = reducedMotion || preview;
  const motionClass = staticMode ? "prism-disc-orb--static" : "";

  return (
    <div
      className={`prism-disc-orb ${motionClass} ${className ?? ""}`}
      style={inlineSize}
      aria-hidden="true"
    >
      <div className="prism-disc-orb__facet prism-disc-orb__facet--one" />
      <div className="prism-disc-orb__facet prism-disc-orb__facet--two" />
    </div>
  );
}
