import type { ComponentType } from "react";

import type { SystemState } from "@/components/elyra/systemState";

import OrganicSphereOrb from "./variants/OrganicSphereOrb";
import ThinkingOrb from "./variants/ThinkingOrb";

export type OrbVariant =
  | "thinkingOrb"  // 3-D dot sphere with pulse waves — paired with Pulse themes
  | "ribbonLoop";  // OrganicSphere fluid blob — paired with Elly themes (ID kept for localStorage compat)

export type OrbComponentProps = {
  className?: string;
  preview?: boolean;
  size?: number;
  systemState?: SystemState;
};

export type OrbPreset = {
  id: OrbVariant;
  name: string;
  description: string;
  Component: ComponentType<OrbComponentProps>;
};

export const ORB_PRESETS: OrbPreset[] = [
  {
    id: "ribbonLoop", // keeping ID for localStorage backward compat
    name: "Elly",
    description: "Organic fluid sphere — Elly's visual identity.",
    Component: OrganicSphereOrb,
  },
  {
    id: "thinkingOrb",
    name: "Pulse",
    description: "Orbiting dots with travelling pulse waves.",
    Component: ThinkingOrb,
  },
];
