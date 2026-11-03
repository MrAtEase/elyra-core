"use client";

import OrganicSphere from "@/components/orb2035/OrganicSphere";
import type { OrbVisualState } from "@/components/orb2035/OrganicSphere";
import type { OrbComponentProps } from "../orbRegistry";
import type { SystemState } from "@/components/merlin/systemState";

/** Map Merlin SystemState → OrganicSphere OrbVisualState */
function toVisualState(s?: SystemState): OrbVisualState {
  if (!s || s === "calm") return "idle";
  if (s === "working") return "thinking";
  if (s === "attention") return "warning";
  if (s === "error") return "error";
  return "idle";
}

export default function OrganicSphereOrb({ size = 200, systemState, className }: OrbComponentProps) {
  return (
    <div className={className} style={{ width: size, height: size }}>
      <OrganicSphere size={size} state={toVisualState(systemState)} />
    </div>
  );
}
