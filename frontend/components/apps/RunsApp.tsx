"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api/client";

type RunRecord = {
  id: string;
  status: string;
  prompt: string;
  created_at: number;
};

type RunsResponse = {
  ok: boolean;
  runs: RunRecord[];
};

type RunsAppProps = {
  focusSignal?: number;
};

export default function RunsApp({ focusSignal }: RunsAppProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadRuns = async () => {
    try {
      const response = await apiClient<RunsResponse>("/v1/runs?limit=60", { method: "GET" });
      setRuns(response.runs ?? []);
    } catch {
      setRuns([]);
    }
  };

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (focusSignal === undefined) return;
    inputRef.current?.focus();
  }, [focusSignal]);

  const submit = async () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || busy) return;

    setBusy(true);
    setError(null);
    try {
      await apiClient("/v1/runs", {
        method: "POST",
        body: JSON.stringify({ prompt: nextPrompt }),
      });
      setPrompt("");
      await loadRuns();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Run could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-[color:var(--text-primary)]">
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 py-3">
        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Recent Runs</p>
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run.id} className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{run.status}</p>
              <p className="mt-1 text-sm text-[color:var(--text-primary)]">{run.prompt}</p>
            </div>
          ))}
          {runs.length === 0 ? <p className="text-sm text-[color:var(--text-secondary)]">No runs yet.</p> : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 py-3">
        <label className="mb-3 block text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">New Run</label>
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe what should run"
          className="h-24 w-full resize-none rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            className="rounded-full border border-[color:var(--border-focus)] bg-[color:var(--bg-surface-active)] px-4 py-2 text-xs font-medium text-[color:var(--text-primary)]"
            disabled={busy}
          >
            {busy ? "Starting..." : "Start Run"}
          </button>
          {error ? <span className="text-xs text-rose-300">{error}</span> : null}
        </div>
      </div>
    </div>
  );
}
