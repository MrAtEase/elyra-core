"use client";

import { useMemo } from "react";

import type { SystemState } from "@/components/merlin/systemState";

type Props = {
  className?: string;
  size?: number;
  preview?: boolean;
  systemState?: SystemState;
};

const getReducedMotionPreference = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)")?.matches ?? false;
};

export default function GlassIrisOrb({ className, size, preview }: Props) {
  const reducedMotion = useMemo(getReducedMotionPreference, []);
  const inlineSize = size ? { width: size, height: size } : undefined;
  const staticMode = reducedMotion || preview;
  const motionClass = staticMode ? "glass-iris-orb--static" : "";

  return (
    <div
      className={`glass-iris-orb ${motionClass} ${className ?? ""}`}
      style={inlineSize}
      aria-hidden="true"
    >
      <div className="glass-iris-orb__iris" />
      <div className="glass-iris-orb__sheen" />
    </div>
  );
}
