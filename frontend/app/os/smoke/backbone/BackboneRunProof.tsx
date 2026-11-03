"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type RunState = "idle" | "starting" | "running" | "succeeded" | "failed";

type ArtifactRow = {
  id: string;
  title: string;
  kind: string;
};

const STORAGE_KEY = "elyra.smoke.backbone_run_id";

function parseArtifacts(payload: unknown): ArtifactRow[] {
  const data = Array.isArray((payload as { artifacts?: unknown[] })?.artifacts)
    ? ((payload as { artifacts?: unknown[] }).artifacts as unknown[])
    : [];
  return data.map((row, index) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item.id ?? `artifact-${index}`),
      title: String(item.title ?? "Artifact"),
      kind: String(item.kind ?? item.type ?? "artifact"),
    };
  });
}

export default function BackboneRunProof() {
  const [hydrated, setHydrated] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [state, setState] = useState<RunState>("idle");
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useMemo(() => `status:${state}`, [state]);

  const pollRun = useCallback(async (id: string) => {
    const response = await fetch(`/api/os/runs/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: await withSupabaseAuthorization(),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("Unable to read run status");
    }
    const status = String((payload as { run?: { status?: unknown } })?.run?.status ?? "running");
    if (status === "succeeded") {
      setState("succeeded");
      setArtifacts(parseArtifacts(payload));
      return true;
    }
    if (status === "failed" || status === "cancelled") {
      setState("failed");
      return true;
    }
    setState("running");
    return false;
  }, []);

  const startRun = useCallback(async () => {
    setError(null);
    setArtifacts([]);
    setState("starting");

    const headers = await withSupabaseAuthorization({
      "content-type": "application/json",
    });
    const response = await fetch("/api/os/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        intent_text: "smoke_browser_close",
        nodes: [
          {
            id: "smoke-node-1",
            type: "tool",
            tool_name: "weather.getForecast",
            input: { location: "Berlin", days: 3 },
          },
        ],
      }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("Unable to start run");
    }
    const id = String((payload as { run?: { id?: unknown } })?.run?.id ?? "");
    if (!id) throw new Error("Run id missing");

    localStorage.setItem(STORAGE_KEY, id);
    setRunId(id);
    setState("running");
  }, []);

  useEffect(() => {
    setHydrated(true);
    const savedRunId = localStorage.getItem(STORAGE_KEY);
    if (savedRunId) {
      setRunId(savedRunId);
      setState("running");
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") !== "1") return;
    if (runId) return;
    void startRun().catch((err: unknown) => {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unexpected start error");
    });
  }, [hydrated, runId, startRun]);

  useEffect(() => {
    if (!runId || state === "succeeded" || state === "failed") return;
    let active = true;

    const tick = async () => {
      try {
        const done = await pollRun(runId);
        if (!active || done) return;
        setTimeout(() => {
          void tick();
        }, 300);
      } catch (err) {
        if (!active) return;
        setState("failed");
        setError(err instanceof Error ? err.message : "Unexpected poll error");
      }
    };

    void tick();
    return () => {
      active = false;
    };
  }, [pollRun, runId, state]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Backbone Browser-Close Proof</h1>
      <p className="text-xs opacity-60" data-testid="backbone-hydrated">{hydrated ? "hydrated:yes" : "hydrated:no"}</p>
      <p className="text-sm opacity-70" data-testid="backbone-status">{statusLabel}</p>
      <p className="text-sm opacity-70" data-testid="backbone-run-id">{runId ?? "no-run"}</p>
      <button
        type="button"
        className="w-fit rounded-md border px-4 py-2 text-sm"
        data-testid="start-backbone-run"
        onClick={() => {
          void startRun().catch((err: unknown) => {
            setState("failed");
            setError(err instanceof Error ? err.message : "Unexpected start error");
          });
        }}
      >
        Start Run
      </button>
      {error ? (
        <p className="text-sm text-red-600" data-testid="backbone-error">{error}</p>
      ) : null}
      <ul className="flex flex-col gap-2" data-testid="artifact-list">
        {artifacts.map((artifact) => (
          <li key={artifact.id} className="rounded-md border p-2 text-sm">
            {artifact.title} ({artifact.kind})
          </li>
        ))}
      </ul>
    </main>
  );
}
