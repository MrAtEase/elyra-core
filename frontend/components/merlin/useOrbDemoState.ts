"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OrbState, OrbStatus, ORB_STATUS_CYCLE, ORB_STATUS_INTENSITY, pickOrbLabel } from "./orbConfig";

const AUTO_CYCLE_MS = 10_000;
const USER_ACTIVITY_MS = 3_000;

const getRandomLabel = (status: OrbStatus) => pickOrbLabel(status);

type UseOrbDemoStateOptions = {
  active?: boolean;
};

export function useOrbDemoState(options: UseOrbDemoStateOptions = {}) {
  const { active = true } = options;
  const [status, setStatus] = useState<OrbStatus>("calm");
  const [intensity, setIntensity] = useState<number>(ORB_STATUS_INTENSITY.calm);
  const [ringProgress, setRingProgress] = useState<number>(1);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [autoDemo, setAutoDemo] = useState(true);

  const activityTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleStartRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const applyStatus = useCallback((nextStatus: OrbStatus, customLabel?: string) => {
    setStatus(nextStatus);
    setIntensity(ORB_STATUS_INTENSITY[nextStatus] ?? 0.5);
    setLabel((prev) => {
      if (customLabel) {
        return customLabel;
      }
      if (!activeRef.current) {
        return prev;
      }
      return getRandomLabel(nextStatus);
    });
  }, []);

  const resetCycle = useCallback(() => {
    if (typeof performance !== "undefined") {
      cycleStartRef.current = performance.now();
    }
  }, []);

  const rollRandomStatus = useCallback(() => {
    const next = ORB_STATUS_CYCLE[Math.floor(Math.random() * ORB_STATUS_CYCLE.length)];
    if (!next) {
      return;
    }
    applyStatus(next);
  }, [applyStatus]);

  const setOrbStatus = useCallback(
    (nextStatus: OrbStatus, customLabel?: string) => {
      applyStatus(nextStatus, customLabel);
      setRingProgress(1);
      resetCycle();
    },
    [applyStatus, resetCycle]
  );

  const notifyUserActivity = useCallback(
    (activityStatus?: "focus" | "thinking") => {
      if (activityTimeout.current) {
        clearTimeout(activityTimeout.current);
      }
      const next: OrbStatus = activityStatus ?? (Math.random() > 0.5 ? "focus" : "thinking");
      applyStatus(next, "Chat activity");
      activityTimeout.current = setTimeout(() => {
        applyStatus("calm");
      }, USER_ACTIVITY_MS);
    },
    [applyStatus]
  );

  useEffect(() => {
    return () => {
      if (activityTimeout.current) {
        clearTimeout(activityTimeout.current);
      }
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    setLabel((prev) => prev ?? getRandomLabel(status));
  }, [active, status]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const tick = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - cycleStartRef.current;
      const progress = Math.min(1, elapsed / AUTO_CYCLE_MS);
      setRingProgress(1 - progress);
      if (elapsed >= AUTO_CYCLE_MS) {
        resetCycle();
        setRingProgress(1);
        if (autoDemo) {
          rollRandomStatus();
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    resetCycle();
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [active, autoDemo, rollRandomStatus, resetCycle]);

  return {
    orbState: {
      status,
      intensity,
      ringProgress,
      label,
    },
    autoDemo,
    setAutoDemo,
    toggleAutoDemo: () => setAutoDemo((prev) => !prev),
    setOrbStatus,
    notifyUserActivity,
  };
}
