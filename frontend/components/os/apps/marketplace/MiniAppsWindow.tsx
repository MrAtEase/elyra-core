"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import {
  MINI_APP_OPEN_EVENT, marketplaceRequest, openMarketplace, requestOpenApp, useMarketplace,
} from "@/lib/marketplace/client";
import MiniAppFrame from "@/components/os/apps/marketplace/MiniAppFrame";

type Loaded = { id: string; name: string; icon: string; description: string; html: string; data: Record<string, unknown> };

/** Runs the mini-apps Elly has built for this workspace. */
export default function MiniAppsWindow() {
  const { activeWorkspace } = useKernel();
  const workspaceId = activeWorkspace.id;
  const market = useMarketplace(workspaceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [app, setApp] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem(MINI_APP_OPEN_EVENT);
      if (pending) { setSelectedId(pending); window.sessionStorage.removeItem(MINI_APP_OPEN_EVENT); }
    } catch { /* ignore */ }
    const onOpen = (e: Event) => {
      setSelectedId((e as CustomEvent<string>).detail);
      try { window.sessionStorage.removeItem(MINI_APP_OPEN_EVENT); } catch { /* ignore */ }
    };
    window.addEventListener(MINI_APP_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(MINI_APP_OPEN_EVENT, onOpen);
  }, []);

  // Default to the newest app.
  useEffect(() => {
    if (!selectedId && market.miniApps[0]) setSelectedId(market.miniApps[0].id);
  }, [market.miniApps, selectedId]);

  useEffect(() => {
    if (!selectedId) { setApp(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/os/marketplace?workspaceId=${encodeURIComponent(workspaceId)}&miniApp=${encodeURIComponent(selectedId)}`, { credentials: "include", cache: "no-store" })
      .then((res) => res.json() as Promise<{ ok?: boolean; error?: string; miniApp?: Loaded }>)
      .then((data) => {
        if (cancelled) return;
        if (!data.ok || !data.miniApp) throw new Error(data.error || "Mini-App nicht gefunden");
        setApp({ ...data.miniApp, data: data.miniApp.data ?? {} });
      })
      .catch((err: Error) => { if (!cancelled) { setApp(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, workspaceId]);

  const ask = useCallback(async (prompt: string) => {
    const res = await marketplaceRequest<{ text: string }>(workspaceId, { action: "miniapp.ask", prompt });
    return res.text;
  }, [workspaceId]);

  // Save the app's data shortly after the last change.
  const onDataChange = useCallback((data: Record<string, unknown>) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = selectedId;
    saveTimer.current = setTimeout(() => {
      void marketplaceRequest(workspaceId, { action: "miniapp.data", id, data }).catch((err: Error) => setError(err.message));
    }, 600);
  }, [selectedId, workspaceId]);

  const buildNew = () => { openMarketplace({ tab: "build" }); requestOpenApp("marketplace"); };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--bg-canvas)" }}>
      <aside className="flex w-[210px] shrink-0 flex-col gap-1 overflow-y-auto p-2.5" style={{ borderRight: "1px solid var(--os-border-faint)" }}>
        <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--text-tertiary)]">Meine Mini-Apps</p>
        {market.miniApps.map((m) => (
          <button key={m.id} type="button" onClick={() => setSelectedId(m.id)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
            style={{ background: m.id === selectedId ? "var(--bg-elevated)" : "transparent" }}>
            <span className="text-base">{m.icon}</span>
            <span className="min-w-0 truncate text-[12px] text-[color:var(--text-primary)]">{m.name}</span>
          </button>
        ))}
        <button type="button" onClick={buildNew} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
          <Wand2 size={12} /> Neue App bauen
        </button>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col p-2">
        {error ? <p className="mb-2 rounded-lg border px-3 py-2 text-xs text-rose-300" style={{ borderColor: "rgba(239,68,68,0.4)" }}>{error}</p> : null}
        {loading ? (
          <div className="grid flex-1 place-items-center text-xs text-[color:var(--text-tertiary)]"><Loader2 size={16} className="animate-spin" /></div>
        ) : app ? (
          <MiniAppFrame key={app.id} html={app.html} initialData={app.data} onDataChange={onDataChange} onAsk={ask} />
        ) : (
          <div className="grid flex-1 place-items-center text-center text-[13px] text-[color:var(--text-secondary)]">
            <div>
              <p>Noch keine Mini-App.</p>
              <button type="button" onClick={buildNew} className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--os-accent)" }}>
                <Wand2 size={12} /> Erste App bauen
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
