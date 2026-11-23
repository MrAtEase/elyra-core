"use client";

/** Werkzeuge › Dienste (MCP): Aufgaben in natürlicher Sprache – Elly nutzt die Werkzeuge der verbundenen Dienste. */

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Play, ShieldAlert, X } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type Server = { id: string; name: string; status: string; enabled: boolean; tools: Array<{ name: string }> };
type Step = { server: string; tool: string; args: Record<string, unknown>; ok: boolean; output: string };
type Pending = { serverId: string; serverName: string; tool: string; args: Record<string, unknown>; reason: string };
type Result = { answer: string; steps: Step[]; pending?: Pending; model?: string };

const inputCls = "w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-[13px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]";

export default function McpPanel({ workspaceId, color, renderMarkdown }: { workspaceId: string; color: string; renderMarkdown: (text: string) => ReactNode }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [allowWrites, setAllowWrites] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/os/mcp?workspaceId=${encodeURIComponent(workspaceId)}`, { credentials: "include", cache: "no-store", headers: await withSupabaseAuthorization() });
        const data = (await res.json()) as { servers?: Server[] };
        const usable = (data.servers ?? []).filter((s) => s.enabled && s.status === "connected");
        setServers(usable);
        let only: string | null = null;
        try {
          only = window.sessionStorage.getItem("elyra:mcp-server");
          if (only) window.setTimeout(() => { try { window.sessionStorage.removeItem("elyra:mcp-server"); } catch { /* ignore */ } }, 1500);
        } catch { /* ignore */ }
        setSelected(only && usable.some((s) => s.id === only) ? [only] : usable.map((s) => s.id));
      } finally {
        setLoaded(true);
      }
    })();
  }, [workspaceId]);

  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setSelected([id]);
      try { window.sessionStorage.removeItem("elyra:mcp-server"); } catch { /* ignore */ }
    };
    window.addEventListener("elyra:mcp-server", onSelect);
    return () => window.removeEventListener("elyra:mcp-server", onSelect);
  }, []);

  async function execute(approved?: Pending) {
    if (!prompt.trim()) { setError("Bitte eine Aufgabe eingeben."); return; }
    setRunning(true); setError(null);
    try {
      const res = await fetch("/api/os/mcp", {
        method: "POST", credentials: "include",
        headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          workspaceId, action: "agent", prompt, serverIds: selected, allowWrites,
          ...(approved ? { approvedCall: { serverId: approved.serverId, tool: approved.tool, args: approved.args } } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as (Result & { ok?: boolean; error?: string }) | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Fehler ${res.status}`);
      setResult((prev) => (approved && prev ? { ...data, steps: [...prev.steps, ...data.steps] } : data));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (loaded && servers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">Noch kein Dienst verbunden</p>
        <p className="max-w-md text-[12.5px] text-[color:var(--text-muted)]">Verbinde Notion, Linear, GitHub oder andere Dienste unter <b>Workspace Admin › Marketplace › Dienste verbinden (MCP)</b>. Danach kannst du ihnen hier Aufgaben geben.</p>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
      <form className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-[color:var(--os-border-soft)] p-5" onSubmit={(e) => { e.preventDefault(); void execute(); }}>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[color:var(--text-secondary)]">Dienste</p>
          <div className="flex flex-wrap gap-1.5">
            {servers.map((s) => {
              const on = selected.includes(s.id);
              return (
                <button key={s.id} type="button" onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${on ? "border-transparent text-white" : "border-[color:var(--os-border-soft)] text-[color:var(--text-secondary)]"}`}
                  style={on ? { background: color } : undefined}>
                  {s.name} <span className="opacity-70">({s.tools.length})</span>
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[color:var(--text-secondary)]">Aufgabe</span>
          <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={`${inputCls} resize-y`}
            placeholder="z. B. Suche in Notion meine Notizen zu Fish Delish und fasse die offenen Punkte zusammen."
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void execute(); } }} />
        </label>
        <label className="flex items-start gap-2 text-[12px] text-[color:var(--text-secondary)]">
          <input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} className="mt-0.5" />
          <span>Änderungen ohne Rückfrage erlauben <span className="block text-[10.5px] text-[color:var(--text-muted)]">Sonst fragt Elly vor jedem Anlegen, Ändern oder Löschen.</span></span>
        </label>
        <button type="submit" disabled={running || selected.length === 0} className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: color }}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {running ? "Arbeitet …" : "Ausführen"}
        </button>
      </form>

      <div className="min-h-0 overflow-y-auto p-6">
        {error ? <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[13px] text-rose-600">{error}</div> : null}
        {!result && !running && !error ? (
          <p className="pt-16 text-center text-[13px] text-[color:var(--text-muted)]">Elly plant die Schritte selbst, ruft die Werkzeuge der Dienste auf und zeigt hier das Ergebnis.</p>
        ) : null}
        {running && !result ? <div className="flex items-center justify-center gap-2 pt-16 text-[13px] text-[color:var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Arbeitet mit den Diensten …</div> : null}
        {result ? (
          <div>
            {renderMarkdown(result.answer)}

            {result.pending ? (
              <div className="mt-4 rounded-xl border border-amber-400/50 bg-amber-500/10 p-4">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-800"><ShieldAlert size={15} /> Freigabe nötig: {result.pending.tool} ({result.pending.serverName})</p>
                <p className="mt-1 text-[11.5px] text-amber-800/80">{result.pending.reason}</p>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[color:var(--bg-elevated)] p-2 text-[11px] text-[color:var(--text-secondary)]">{JSON.stringify(result.pending.args, null, 2)}</pre>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={running} onClick={() => void execute(result.pending)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: color }}>
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Freigeben & ausführen
                  </button>
                  <button type="button" disabled={running} onClick={() => setResult({ answer: `${result.answer}\n\n_Aktion abgelehnt._`, steps: result.steps, ...(result.model ? { model: result.model } : {}) })} className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--os-border-soft)] px-3 py-1.5 text-[12px] text-[color:var(--text-secondary)]">
                    <X size={12} /> Ablehnen
                  </button>
                </div>
              </div>
            ) : null}

            {result.steps.length > 0 ? (
              <div className="mt-6 border-t border-[color:var(--os-border-soft)] pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Schritte ({result.steps.length})</p>
                {result.steps.map((s, i) => (
                  <div key={i} className="mb-1.5 rounded-lg border border-[color:var(--os-border-soft)]">
                    <button type="button" onClick={() => setOpenStep(openStep === i ? null : i)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]">
                      {openStep === i ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className={s.ok ? "text-emerald-600" : "text-rose-600"}>{s.ok ? "✓" : "✕"}</span>
                      <span className="font-medium text-[color:var(--text-primary)]">{s.server}</span>
                      <span className="font-mono text-[11px] text-[color:var(--text-muted)]">{s.tool}</span>
                    </button>
                    {openStep === i ? (
                      <div className="border-t border-[color:var(--os-border-soft)] p-3">
                        <pre className="mb-2 max-h-32 overflow-auto text-[11px] text-[color:var(--text-muted)]">{JSON.stringify(s.args, null, 2)}</pre>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11.5px] text-[color:var(--text-secondary)]">{s.output}</pre>
                      </div>
                    ) : null}
                  </div>
                ))}
                {result.model ? <p className="mt-2 text-[10.5px] text-[color:var(--text-muted)]">{result.model}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
