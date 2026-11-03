"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAssistantEndpoint } from "@utils/auth-guard";
import type { OrbStatus } from "./orbConfig";

const CALM_INTENSITY = 0;

const ORB_STATUS_INTENSITY: Partial<Record<OrbStatus, number>> = {
  calm: CALM_INTENSITY,
};

const STATUS_ENDPOINT = buildAssistantEndpoint("/assistant/status");
const POLL_INTERVAL = 120_000;
const SYNC_PULSE_DURATION = 900;

type MerlinSystemHealth = "ok" | "auth_required" | "error";

export type MerlinSystemStatusPayload = {
  health: MerlinSystemHealth;
  lastSyncAt: string | null;
  mail: {
    unread: number;
    important: number;
  };
  calendar: {
    todayCount: number;
    nextEventAt: string | null;
  };
  meta: {
    version: string;
    latencyMs: number;
    errorCode?: string;
    errorMessage?: string;
  };
};

type OrbVisualState = {
  mode: OrbStatus;
  intensity: number;
  phase: number;
};


type MerlinAwarenessState = "idle" | "thinking" | "planning" | "analyzing" | "error";

const mapMerlinAwarenessToOrbStatus = (awarenessState: MerlinAwarenessState): OrbStatus => {
  switch (awarenessState) {
    case "idle":
      return "calm";
    case "thinking":
    case "planning":
    case "analyzing":
      return "thinking";
    case "error":
      return "error";
    default:
      return "calm"; // Fallback
  }
};

const deriveVisualStateForHealth = (health: MerlinSystemHealth): Omit<OrbVisualState, "phase"> => {
  if (health === "error") {
    return { mode: "error", intensity: 0.9 };
  }
  if (health === "auth_required") {
    return { mode: "warning", intensity: 0.72 };
  }
  return { mode: "calm", intensity: 0.45 };
};

const normalizeFetchError = (value: unknown): string => {
  if (!value) return "unknown error";
  if (typeof value === "string") return value.slice(0, 120);
  if (value instanceof Error && value.message) return value.message.slice(0, 120);
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return String(value).slice(0, 120);
  }
};

export type UseMerlinSystemStatusResult = {
  status: MerlinSystemStatusPayload | null;
  orbState: OrbVisualState;
};

export function useMerlinSystemStatus(): UseMerlinSystemStatusResult {
  const [status, setStatus] = useState<MerlinSystemStatusPayload | null>(null);
  const [merlinAwarenessOrbStatus, setMerlinAwarenessOrbStatus] = useState<OrbStatus>("calm");
  const [orbState, setOrbState] = useState<OrbVisualState>({
    mode: "calm",
    intensity: 0.45,
    phase: 0,
  });
  const lastSyncRef = useRef<string | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const versionRef = useRef<string>("unknown");

  const applyVisualState = useCallback(
    (health: MerlinSystemHealth, currentMerlinAwarenessStatus: OrbStatus) => {
      let mode: OrbStatus;
      let intensity: number;

      if (currentMerlinAwarenessStatus && currentMerlinAwarenessStatus !== "calm") {
        mode = currentMerlinAwarenessStatus;
        intensity = ORB_STATUS_INTENSITY[currentMerlinAwarenessStatus] ?? CALM_INTENSITY;
      } else {
        // Fallback to system health if no active awareness state from Merlin client
        const derived = deriveVisualStateForHealth(health);
        mode = derived.mode;
        intensity = derived.intensity;
      }

      setOrbState((current) => ({
        ...current,
        mode,
        intensity,
      }));
    },
    []
  );

  const triggerSyncPulse = useCallback((incoming: string | null) => {
    if (!incoming) {
      lastSyncRef.current = null;
      return;
    }
    if (incoming === lastSyncRef.current) {
      return;
    }
    lastSyncRef.current = incoming;
    setOrbState((current) => ({ ...current, phase: 1 }));
    if (pulseTimerRef.current) {
      clearTimeout(pulseTimerRef.current);
    }
    if (typeof window === "undefined") {
      return;
    }
    pulseTimerRef.current = window.setTimeout(() => {
      setOrbState((current) => ({ ...current, phase: 0 }));
      pulseTimerRef.current = null;
    }, SYNC_PULSE_DURATION);
  }, []);

  const fetchStatus = useCallback(
    async (signal?: AbortSignal) => {
      try {
      const response = await fetch(STATUS_ENDPOINT, {
        cache: "no-store",
        credentials: "include",
        signal: signal ?? null,
      });
        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }
        const payload = (await response.json()) as MerlinSystemStatusPayload;
        versionRef.current = payload.meta?.version ?? versionRef.current ?? "unknown";
        setStatus(payload);
        applyVisualState(payload.health, merlinAwarenessOrbStatus);
        triggerSyncPulse(payload.lastSyncAt);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const fallback: MerlinSystemStatusPayload = {
          health: "error",
          lastSyncAt: lastSyncRef.current,
          mail: { unread: 0, important: 0 },
          calendar: { todayCount: 0, nextEventAt: null },
          meta: {
            version: versionRef.current ?? "unknown",
            latencyMs: 0,
            errorCode: "fetch_error",
            errorMessage: normalizeFetchError(error),
          },
        };
        setStatus(fallback);
        applyVisualState("error", merlinAwarenessOrbStatus);
      }
    },
    [applyVisualState, triggerSyncPulse, merlinAwarenessOrbStatus]
  );

  const runCheck = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    fetchStatus(controller.signal);
  }, [fetchStatus]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.Merlin || !window.Merlin.awareness) {
      return;
    }

    const assistantAwarenessEl = document.querySelector("[data-assistant-awareness]");

    const updateFromMerlinAwareness = () => {
      const awareness = (window as any).Merlin?.awareness;
      const merlinState = (awareness?.state || "idle") as MerlinAwarenessState;
      setMerlinAwarenessOrbStatus(mapMerlinAwarenessToOrbStatus(merlinState));
    };

    // Initial state
    updateFromMerlinAwareness();

    // Set up MutationObserver to watch for changes to the element's dataset (specifically data-assistant-state)
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "data-assistant-state"
        ) {
          updateFromMerlinAwareness();
        }
      }
    });

    if (assistantAwarenessEl) {
      observer.observe(assistantAwarenessEl, { attributes: true });
    }

    // Also listen to a custom event if Merlin.awareness decides to emit one for more direct updates
    const handleMerlinAwarenessChange = (event: Event) => {
      updateFromMerlinAwareness();
    };
    document.addEventListener("merlin:awareness:change", handleMerlinAwarenessChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("merlin:awareness:change", handleMerlinAwarenessChange);
    };
  }, []);

  useEffect(() => {
    runCheck();
    if (typeof window === "undefined") {
      return;
    }
    const intervalId = window.setInterval(runCheck, POLL_INTERVAL);
    const handleFocus = () => runCheck();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        runCheck();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [runCheck]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (pulseTimerRef.current) {
        clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  return { status, orbState };
}
