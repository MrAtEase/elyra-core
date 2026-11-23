"use client";

/**
 * Elly's approval card for marketplace installs.
 * Triggered by "elyra:install-request" (see WorkspaceOS → intent line): Elly suggests matching
 * apps/skills, the user approves, then the item is installed and opened.
 */
import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, Store, X } from "lucide-react";
import { catalogItem, isItemInstalled, type CatalogItem } from "@/lib/marketplace/catalog";
import { templateById, type MiniAppTemplate } from "@/lib/marketplace/templates";
import { selectToolboxTool } from "@/components/os/apps/toolbox/ToolboxWindow";
import { INSTALL_REQUEST_EVENT, openMarketplace, prefillIntent, requestOpenApp, useMarketplace } from "@/lib/marketplace/client";
import { LauncherIcon } from "@/components/os/apps/marketplace/icons";
import { SHELL_LAYERS } from "@/components/os/shell/layers";

export type InstallRequestDetail = { itemIds: string[]; templateIds?: string[]; query: string };

export function requestInstall(detail: InstallRequestDetail) {
  window.dispatchEvent(new CustomEvent<InstallRequestDetail>(INSTALL_REQUEST_EVENT, { detail }));
}

export default function InstallPrompt({ workspaceId, rightInset = 0 }: { workspaceId: string; rightInset?: number }) {
  const market = useMarketplace(workspaceId);
  const [request, setRequest] = useState<{ items: CatalogItem[]; templates: MiniAppTemplate[]; query: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<InstallRequestDetail>).detail;
      const items = detail.itemIds.map(catalogItem).filter((i): i is CatalogItem => Boolean(i));
      const templates = (detail.templateIds ?? []).map(templateById).filter((t): t is MiniAppTemplate => Boolean(t));
      setRequest({ items, templates, query: detail.query });
      setDone(null);
      setError(null);
    };
    window.addEventListener(INSTALL_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(INSTALL_REQUEST_EVENT, onRequest);
  }, []);

  if (!request) return null;

  const use = (item: CatalogItem) => {
    if (item.kind === "connector") { selectToolboxTool("mcp"); requestOpenApp("toolbox"); }
    else if (item.kind === "app" && item.launch) requestOpenApp(item.launch);
    else prefillIntent(`[Skill: ${item.name}] ${item.instructions ?? ""}\n\n${item.starter ?? ""}`);
    setRequest(null);
  };

  const install = async (item: CatalogItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      await market.setItem(item.id, true);
      setDone(item.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed bottom-[104px] left-1/2 w-[min(520px,calc(100%-32px))] -translate-x-1/2" style={{ zIndex: SHELL_LAYERS.elyPanel + 1, marginLeft: -rightInset / 2 }}>
      <div className="rounded-2xl border p-4 shadow-2xl backdrop-blur-xl" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}>
        <div className="flex items-start gap-2">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: "rgba(108,156,252,0.15)", color: "var(--os-accent)" }}><Sparkles size={14} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Elly</p>
            <p className="text-[12px] text-[color:var(--text-secondary)]">
              {request.items.length === 0 && request.templates.length === 0 ? "Dafür habe ich im Marktplatz nichts Passendes gefunden. Soll ich dir eine eigene App bauen?" : "Dafür passt aus dem Marktplatz:"}
            </p>
          </div>
          <button type="button" onClick={() => setRequest(null)} className="rounded p-1 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]" aria-label="Schließen"><X size={14} /></button>
        </div>

        <div className="mt-3 space-y-2">
          {request.items.map((item) => {
            const installed = item.kind === "connector" || isItemInstalled(market.installed, item.id) || done === item.id;
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
                <LauncherIcon name={item.icon} size={16} className="shrink-0 text-[color:var(--text-secondary)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-[color:var(--text-primary)]">{item.name}{item.kind === "skill" ? " · Skill" : item.kind === "connector" ? " · Anbindung" : ""}</p>
                  <p className="line-clamp-2 text-[11px] text-[color:var(--text-secondary)]">{item.description}</p>
                </div>
                {item.id === "conn-bank" ? (
                  <span className="shrink-0 text-[10px] text-[color:var(--text-tertiary)]">geplant · bis dahin CSV-Import</span>
                ) : installed ? (
                  <button type="button" onClick={() => use(item)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--os-accent)" }}>
                    {done === item.id ? <Check size={11} /> : null}{item.kind === "skill" ? "Verwenden" : item.kind === "connector" ? "Verbinden" : "Öffnen"}
                  </button>
                ) : market.canManage ? (
                  <button type="button" onClick={() => void install(item)} disabled={busyId === item.id} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60" style={{ background: "#16a34a" }}>
                    {busyId === item.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Installieren
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] text-[color:var(--text-tertiary)]">Owner muss installieren</span>
                )}
              </div>
            );
          })}
          {request.templates.map((tpl) => {
            const locked = Boolean(tpl.personalOnly) && !market.personal && market.loaded;
            return (
              <div key={tpl.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" }}>
                <span className="shrink-0 text-lg">{tpl.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-[color:var(--text-primary)]">{tpl.name} · Vorlage</p>
                  <p className="line-clamp-2 text-[11px] text-[color:var(--text-secondary)]">{tpl.description}</p>
                </div>
                {locked ? (
                  <span className="shrink-0 text-[10px] text-[color:var(--text-tertiary)]">Nur im Personal-Workspace</span>
                ) : (
                  <button type="button" onClick={() => { openMarketplace(tpl.prebuilt ? { tab: "build", templateId: tpl.id } : { tab: "build", buildDescription: tpl.prompt, autoBuild: true }); requestOpenApp("marketplace"); setRequest(null); }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--os-accent)" }}>
                    <Sparkles size={11} /> Bauen
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error ? <p className="mt-2 text-[11px] text-rose-300">{error}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <button type="button" onClick={() => { openMarketplace({ tab: "apps" }); requestOpenApp("marketplace"); setRequest(null); }} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
            <Store size={11} /> Marktplatz öffnen
          </button>
          <button type="button" onClick={() => { openMarketplace({ tab: "build", buildDescription: request.query }); requestOpenApp("marketplace"); setRequest(null); }} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
            <Sparkles size={11} /> Eigene App bauen lassen
          </button>
        </div>
      </div>
    </div>
  );
}
