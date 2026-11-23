"use client";

import { useState } from "react";
import { fetchAssistantJson } from "@/lib/apiClient";

export default function AppDesignAIWindow() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const runDesign = async () => {
    const value = prompt.trim();
    if (!value) return;
    setStatus("Running design intelligence...");
    try {
      const payload = await fetchAssistantJson<{ run?: { id?: string; status?: string } }>("/v1/runs", {
        method: "POST",
        body: JSON.stringify({ prompt: `Design AI: ${value}` }),
      });
      setStatus(`Run ${payload.run?.status ?? "queued"}${payload.run?.id ? ` · ${payload.run.id}` : ""}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Design run failed");
    }
  };

  return (
    <section className="ec-panel ec-panel-scroll" style={{ padding: 14 }}>
      <p className="ec-overline">Design AI</p>
      <article className="ec-card">
        <strong>Intelligent Design System</strong>
        <p>Generate UI direction, component behavior, and visual strategy from one prompt.</p>
      </article>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={4}
        placeholder="Describe the product surface to design"
        className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-2 text-sm text-white outline-none"
      />
      <button type="button" className="ec-button ec-button--primary mt-2" onClick={() => void runDesign()}>
        Start Design Run
      </button>
      {status ? <p className="mt-2 text-xs text-white/70">{status}</p> : null}
    </section>
  );
}
