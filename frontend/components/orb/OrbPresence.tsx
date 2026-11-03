"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import OrganicSphere from "@/components/orb2035/OrganicSphere";
import type { OrbRuntimeState } from "@/components/os/windowing/windowTypes";

type OrbStoreValue = {
  orbState: OrbRuntimeState;
  setOrbState: (state: OrbRuntimeState) => void;
};

const OrbStateContext = createContext<OrbStoreValue | null>(null);

export function OrbStateProvider({ children }: { children: ReactNode }) {
  const [orbState, setOrbState] = useState<OrbRuntimeState>("idle");
  const value = useMemo(() => ({ orbState, setOrbState }), [orbState]);
  return <OrbStateContext.Provider value={value}>{children}</OrbStateContext.Provider>;
}

export function useOrbStateStore() {
  const context = useContext(OrbStateContext);
  if (!context) {
    throw new Error("useOrbStateStore must be used within OrbStateProvider");
  }
  return context;
}

function toVisualState(state: OrbRuntimeState): "idle" | "thinking" | "running" | "error" {
  if (state === "error") return "error";
  if (state === "executing" || state === "success") return "running";
  if (
    state === "thinking" ||
    state === "planning" ||
    state === "listening" ||
    state === "waiting_for_auth" ||
    state === "waiting_for_approval"
  ) {
    return "thinking";
  }
  return "idle";
}

type OrbPresenceProps = {
  reduceMotion?: boolean;
};

export default function OrbPresence({ reduceMotion = false }: OrbPresenceProps) {
  const { orbState } = useOrbStateStore();
  const visualState = toVisualState(orbState);

  return (
    <div className="elyraOrbPresence pointer-events-none fixed left-1/2 top-2 z-[130] -translate-x-1/2">
      <div className="elyraOrbPresence__halo" data-orb-visual={visualState} data-reduced-motion={reduceMotion}>
        <OrganicSphere size={150} />
      </div>
    </div>
  );
}
