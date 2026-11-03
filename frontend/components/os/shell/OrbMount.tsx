"use client";

import { useEffect } from "react";
import { SHELL_LAYERS } from "@/components/os/shell/layers";
import { ORB_TOP_PX, orbSizeForViewport } from "@/components/os/shell/orbMetrics";
import { useOrbVariant } from "@/components/merlin/orbs/useOrbVariant";
import { ORB_PRESETS } from "@/components/merlin/orbs/orbRegistry";
import type { SystemState } from "@/components/merlin/systemState";
import type { OrbRuntimeState } from "@/components/os/windowing/windowTypes";

type OrbPresenceState = "idle" | "hover" | "active" | "thinking" | "warning" | "success" | "error";

type OrbMountProps = {
  accent: string;
  state: OrbPresenceState;
  runtimeState?: OrbRuntimeState;
};

/** Map presence / runtime state → Merlin orb SystemState for animation control */
function toSystemState(presenceState: OrbPresenceState, runtimeState?: OrbRuntimeState): SystemState {
  if (runtimeState) {
    if (runtimeState === "error") return "error";
    if (runtimeState === "executing" || runtimeState === "planning" || runtimeState === "thinking") return "working";
    if (runtimeState === "waiting_for_auth" || runtimeState === "waiting_for_approval") return "attention";
    if (runtimeState === "listening" || runtimeState === "success") return "calm";
  }
  if (presenceState === "error") return "error";
  if (presenceState === "warning") return "attention";
  if (presenceState === "thinking" || presenceState === "active") return "working";
  return "calm";
}

function visualStateStyles(state: OrbPresenceState, accent: string) {
  const glow = `${accent}88`;

  if (state === "thinking") {
    return {
      transform: "translateX(-50%) scale(1.01)",
      filter: `drop-shadow(0 10px 22px ${glow}) brightness(1.08) saturate(1.12)`,
      opacity: 1,
    };
  }

  if (state === "error") {
    return {
      transform: "translateX(-50%) scale(1.01)",
      filter: "drop-shadow(0 10px 20px rgba(248,113,113,0.34)) brightness(0.95) saturate(0.84)",
      opacity: 0.9,
    };
  }

  if (state === "warning") {
    return {
      transform: "translateX(-50%) scale(1.01)",
      filter: "drop-shadow(0 10px 20px rgba(245,158,11,0.28)) brightness(1.02) saturate(1.07)",
      opacity: 0.96,
    };
  }

  if (state === "success") {
    return {
      transform: "translateX(-50%) scale(1.02)",
      filter: "drop-shadow(0 10px 20px rgba(16,185,129,0.28)) brightness(1.08) saturate(1.1)",
      opacity: 1,
    };
  }

  if (state === "active") {
    return {
      transform: "translateX(-50%) scale(1.015)",
      filter: `drop-shadow(0 10px 20px ${glow}) brightness(1.06) saturate(1.1)`,
      opacity: 1,
    };
  }

  if (state === "hover") {
    return {
      transform: "translateX(-50%) scale(1.01)",
      filter: `drop-shadow(0 8px 16px ${glow}) brightness(1.04) saturate(1.08)`,
      opacity: 0.98,
    };
  }

  return {
    transform: "translateX(-50%) scale(1)",
    filter: "brightness(1.02) saturate(1.08)",
    opacity: 0.95,
  };
}

export default function OrbMount({ accent, state, runtimeState }: OrbMountProps) {
  useEffect(() => {
    // Cleanup legacy WebGL orb root from previous implementation.
    const legacy = document.getElementById("orb-root");
    legacy?.remove();
  }, []);

  const [orbVariant] = useOrbVariant();
  const size = orbSizeForViewport();
  const visualStyles = visualStateStyles(state, accent);
  const systemState = toSystemState(state, runtimeState);

  const preset = ORB_PRESETS.find((p) => p.id === orbVariant) ?? ORB_PRESETS[0];
  const OrbComponent = preset?.Component;

  return (
    <div
      className="pointer-events-none fixed left-1/2 transition duration-300"
      data-orb-thinking={state === "thinking" ? "true" : undefined}
      style={{
        top: `${ORB_TOP_PX}px`,
        width: size,
        height: size,
        zIndex: SHELL_LAYERS.orb,
        ...visualStyles,
      }}
      aria-hidden="true"
    >
      {OrbComponent && <OrbComponent size={size} systemState={systemState} />}
    </div>
  );
}
