"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronRight, Loader2, Lock, Play, Plug, Plus, RotateCcw, Search, Sparkles, Store, Trash2, Wand2, X,
} from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { CATALOG, MARKETPLACE_CATEGORIES, isItemInstalled, type CatalogItem } from "@/lib/marketplace/catalog";
import { TEMPLATES, TEMPLATE_CATEGORIES, templateById, type MiniAppTemplate } from "@/lib/marketplace/templates";
import { selectToolboxTool } from "@/components/os/apps/toolbox/ToolboxWindow";
import {
  MARKETPLACE_OPEN_EVENT, marketplaceRequest, openMiniApp, prefillIntent, refreshMarketplace, requestOpenApp, useMarketplace,
  type MarketplaceOpenDetail,
} from "@/lib/marketplace/client";
import MiniAppFrame from "@/components/os/apps/marketplace/MiniAppFrame";
import { LauncherIcon } from "@/components/os/apps/marketplace/icons";

type Tab = "apps" | "templates" | "skills" | "connectors" | "build";
type Draft = { name: string; icon: string; description: string; html: string };

const card = { background: "var(--bg-surface)", border: "1px solid var(--os-border-faint)" } as const;

function ItemCard({
  item, installed, canManage, busy, onToggle, onUse,
}: {
  item: CatalogItem; installed: boolean; canManage: boolean; busy: boolean; onToggle: () => void; onUse: () => void;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl p-3.5" style={card}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "var(--bg-elevated)", border: "1px solid var(--os-border-soft)" }}>
          <LauncherIcon name={item.icon} size={18} className="text-[color:var(--text-secondary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">{item.name}</p>
            {installed ? <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400" style={{ background: "rgba(16,185,129,0.12)" }}><Check size={9} /> Installiert</span> : null}
          </div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-tertiary)]">{item.kind === "skill" ? "Skill · " : ""}{item.category}</p>
        </div>
      </div>
      <p className="flex-1 text-[12px] leading-snug text-[color:var(--text-secondary)]">{item.description}</p>
      <div className="flex items-center gap-2">
        {installed ? (
          <>
            <button type="button" onClick={onUse} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90" style={{ background: "var(--os-accent)" }}>
              {item.kind === "skill" ? <><Sparkles size={11} /> Verwenden</> : <><Play size={11} /> Öffnen</>}
            </button>
            {canManage ? (
              <button type="button" onClick={onToggle} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-[11px] text-[color:var(--text-tertiary)] transition hover:bg-white/5 hover:text-[color:var(--text-primary)] disabled:opacity-50">
                {busy ? "…" : "Entfernen"}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            disabled={busy || !canManage}
            title={canManage ? undefined : "Nur Owner oder Admin können installieren"}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--text-primary)] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: "var(--os-border-soft)" }}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Installieren
          </button>
        )}
      </div>
    </article>
  );
}

function TemplateCard({ tpl, locked, canManage, onBuild }: { tpl: MiniAppTemplate; locked: boolean; canManage: boolean; onBuild: () => void }) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl p-3.5" style={card}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: "var(--bg-elevated)", border: "1px solid var(--os-border-soft)" }}>{tpl.icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">{tpl.name}</p>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-tertiary)]">Vorlage · {tpl.category}</p>
        </div>
      </div>
      <p className="flex-1 text-[12px] leading-snug text-[color:var(--text-secondary)]">{tpl.description}</p>
      {locked ? (
        <p className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-tertiary)]"><Lock size={11} /> Nur im eigenen Personal-Workspace (sensible Daten)</p>
      ) : (
        <button type="button" onClick={onBuild} disabled={!canManage}
          className="inline-flex w-fit items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "var(--os-accent)" }}>
          <Wand2 size={11} /> Mit Elly bauen
        </button>
      )}
    </article>
  );
}

function ConnectorCard({ item, onConnect }: { item: CatalogItem; onConnect: () => void }) {
  const planned = item.id === "conn-bank";
  return (
    <article className="flex flex-col gap-2 rounded-2xl p-3.5" style={card}>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "var(--bg-elevated)", border: "1px solid var(--os-border-soft)" }}><Plug size={18} className="text-[color:var(--text-secondary)]" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">{item.name}</p>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-tertiary)]">Anbindung · {item.category}{planned ? " · geplant" : ""}</p>
        </div>
      </div>
      <p className="text-[12px] leading-snug text-[color:var(--text-secondary)]">{item.description}</p>
      {item.setup ? <p className="flex-1 rounded-lg px-2.5 py-2 text-[11px] leading-snug text-[color:var(--text-tertiary)]" style={{ background: "var(--bg-canvas)" }}>{item.setup}</p> : null}
      {planned ? null : (
        <button type="button" onClick={onConnect} className="inline-flex w-fit items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--text-primary)] transition hover:bg-white/5" style={{ borderColor: "var(--os-border-soft)" }}>
          <Plug size={11} /> Verbinden
        </button>
      )}
    </article>
  );
}

export default function MarketplaceWindow() {
  const { activeWorkspace } = useKernel();
  const workspaceId = activeWorkspace.id;
  const market = useMarketplace(workspaceId);
  const [tab, setTab] = useState<Tab>("apps");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Builder state
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [autoBuild, setAutoBuild] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Elly / other places can open the marketplace on a specific tab, e.g. "build" with a description.
  useEffect(() => {
    const apply = (detail: MarketplaceOpenDetail | null) => {
      if (!detail) return;
      if (detail.tab) setTab(detail.tab);
      if (detail.buildDescription) { setDescription(detail.buildDescription); setDraft(null); setEditingId(null); }
      if (detail.autoBuild) setAutoBuild(true);
      if (detail.templateId) { const tpl = templateById(detail.templateId); if (tpl) void buildFromTemplateRef.current(tpl); }
    };
    try {
      const raw = window.sessionStorage.getItem(MARKETPLACE_OPEN_EVENT);
      if (raw) { apply(JSON.parse(raw) as MarketplaceOpenDetail); window.sessionStorage.removeItem(MARKETPLACE_OPEN_EVENT); }
    } catch { /* ignore */ }
    const onOpen = (e: Event) => { apply((e as CustomEvent<MarketplaceOpenDetail>).detail); try { window.sessionStorage.removeItem(MARKETPLACE_OPEN_EVENT); } catch { /* ignore */ } };
    window.addEventListener(MARKETPLACE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(MARKETPLACE_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => { if (tab === "build") descriptionRef.current?.focus(); }, [tab]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kind = tab === "skills" ? "skill" : tab === "connectors" ? "connector" : "app";
    return CATALOG.filter((item) => item.kind === kind).filter((item) =>
      !q || `${item.name} ${item.description} ${item.category} ${item.hints.join(" ")}`.toLowerCase().includes(q),
    );
  }, [tab, query]);

  const templates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => !q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q));
  }, [query]);

  const categoriesFor = (list: CatalogItem[]) =>
    [...MARKETPLACE_CATEGORIES.filter((c) => list.some((i) => i.category === c)), ...Array.from(new Set(list.map((i) => i.category))).filter((c) => !(MARKETPLACE_CATEGORIES as readonly string[]).includes(c))];

  const buildFromTemplate = async (tpl: MiniAppTemplate) => {
    setDescription(tpl.prompt);
    setDraft(null);
    setTab("build");
    // Replace an earlier version with the same name instead of creating a duplicate.
    const existing = market.miniApps.find((m) => m.name.trim().toLowerCase() === tpl.name.toLowerCase());
    setEditingId(existing?.id ?? null);
    if (!tpl.prebuilt) { setAutoBuild(true); return; }
    // Hand-built, tested version: no AI involved.
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch(tpl.prebuilt, { cache: "no-store" });
      if (!res.ok) throw new Error(`Vorlage nicht gefunden (${res.status})`);
      setDraft({ name: tpl.name, icon: tpl.icon, description: tpl.description, html: await res.text() });
      setPreviewError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  };
  const buildFromTemplateRef = useRef(buildFromTemplate);
  buildFromTemplateRef.current = buildFromTemplate;

  const connect = () => {
    selectToolboxTool("mcp");
    requestOpenApp("toolbox");
  };

  const toggle = async (item: CatalogItem) => {
    const installed = isItemInstalled(market.installed, item.id);
    setBusyId(item.id);
    setError(null);
    try { await market.setItem(item.id, !installed); } catch (err) { setError((err as Error).message); } finally { setBusyId(null); }
  };

  const use = (item: CatalogItem) => {
    if (item.kind === "app" && item.launch) { requestOpenApp(item.launch); return; }
    prefillIntent(`[Skill: ${item.name}] ${item.instructions ?? ""}\n\n${item.starter ?? ""}`);
  };

  const fixPreviewError = async () => {
    if (!draft || !previewError) return;
    setBuilding(true);
    setError(null);
    try {
      const res = await marketplaceRequest<{ draft: Draft }>(workspaceId, {
        action: "miniapp.generate",
        description,
        previousHtml: draft.html,
        feedback: `Die App zeigt diesen Fehler: "${previewError}". Behebe ihn und prüfe den restlichen Code auf ähnliche Fehler. Funktion und Aussehen sonst unverändert lassen.`,
      });
      setDraft(res.draft);
      setPreviewError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const build = async (withFeedback: boolean) => {
    setBuilding(true);
    setError(null);
    try {
      const res = await marketplaceRequest<{ draft: Draft }>(workspaceId, {
        action: "miniapp.generate",
        description,
        ...(withFeedback && draft ? { previousHtml: draft.html, feedback } : {}),
      });
      setDraft(res.draft);
      setPreviewError(null);
      if (withFeedback) setFeedback("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  useEffect(() => {
    if (!autoBuild || building || description.trim().length < 8 || !market.loaded) return;
    setAutoBuild(false);
    void build(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuild, description, market.loaded]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await marketplaceRequest<{ miniApp: { id: string } }>(workspaceId, {
        action: "miniapp.save", id: editingId ?? market.miniApps.find((m) => m.name.trim().toLowerCase() === draft.name.trim().toLowerCase())?.id ?? null, name: draft.name, icon: draft.icon, description: draft.description, prompt: description, html: draft.html,
      });
      await refreshMarketplace(workspaceId);
      setDraft(null); setDescription(""); setEditingId(null);
      openMiniApp(res.miniApp.id);
      requestOpenApp("mini_apps");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const editMiniApp = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/os/marketplace?workspaceId=${encodeURIComponent(workspaceId)}&miniApp=${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; error?: string; miniApp?: Draft & { prompt: string } };
      if (!data.ok || !data.miniApp) throw new Error(data.error || "Mini-App nicht gefunden");
      setDescription(data.miniApp.prompt || data.miniApp.description);
      setDraft({ name: data.miniApp.name, icon: data.miniApp.icon, description: data.miniApp.description, html: data.miniApp.html });
      setEditingId(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeMiniApp = async (id: string) => {
    setError(null);
    try {
      await marketplaceRequest(workspaceId, { action: "miniapp.delete", id });
      await refreshMarketplace(workspaceId);
      if (editingId === id) { setDraft(null); setEditingId(null); }
    } catch (err) { setError((err as Error).message); }
  };

  const ask = useCallback(async (prompt: string) => {
    const res = await marketplaceRequest<{ text: string }>(workspaceId, { action: "miniapp.ask", prompt });
    return res.text;
  }, [workspaceId]);

  const installedCount = CATALOG.filter((i) => i.kind !== "connector" && isItemInstalled(market.installed, i.id)).length;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-canvas)" }}>
      <header className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid var(--os-border-faint)" }}>
        <div className="flex items-center gap-2">
          <Store size={16} className="text-[color:var(--text-secondary)]" />
          <div>
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">Marktplatz</p>
            <p className="text-[10px] text-[color:var(--text-tertiary)]">{installedCount} installiert · {TEMPLATES.length} Vorlagen · {market.miniApps.length} eigene Mini-Apps</p>
          </div>
        </div>
        <div className="flex rounded-lg p-0.5" style={card}>
          {([["apps", "Apps"], ["templates", "Vorlagen"], ["skills", "Skills"], ["connectors", "Anbindungen"], ["build", "Selbst bauen"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className="rounded-md px-3 py-1 text-xs font-medium transition"
              style={{ background: tab === id ? "var(--bg-elevated)" : "transparent", color: tab === id ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {id === "build" ? <span className="inline-flex items-center gap-1"><Wand2 size={11} /> {label}</span> : label}
            </button>
          ))}
        </div>
        {tab !== "build" ? (
          <div className="ml-auto flex min-w-[200px] items-center gap-2 rounded-lg px-2.5 py-1.5" style={card}>
            <Search size={13} className="text-[color:var(--text-secondary)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen …" className="w-full bg-transparent text-xs text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-tertiary)]" />
          </div>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {market.setupError ? (
          <p className="mb-3 rounded-lg border px-3 py-2 text-xs text-amber-300" style={{ borderColor: "rgba(245,158,11,0.4)" }}>
            {market.setupError} Bis dahin bleiben alle Apps sichtbar.
          </p>
        ) : null}
        {!market.canManage && market.loaded ? (
          <p className="mb-3 text-[11px] text-[color:var(--text-tertiary)]">Du kannst Apps nutzen. Installieren und Entfernen dürfen nur Owner oder Admin dieses Workspace.</p>
        ) : null}
        {error ? (
          <p className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-rose-300" style={{ borderColor: "rgba(239,68,68,0.4)" }}>
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)}><X size={12} /></button>
          </p>
        ) : null}

        {tab === "templates" ? (
          <div className="space-y-5">
            <p className="text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
              Vorlagen sind fertige Bauanleitungen: Elly baut daraus mit einem Klick deine eigene Mini-App, die du danach anpassen kannst („füge eine Kategorie Hund hinzu“).
            </p>
            {TEMPLATE_CATEGORIES.map((category) => {
              const group = templates.filter((t) => t.category === category);
              if (group.length === 0) return null;
              return (
                <section key={category}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--text-tertiary)]">{category}</p>
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {group.map((tpl) => (
                      <TemplateCard key={tpl.id} tpl={tpl} locked={Boolean(tpl.personalOnly) && !market.personal && market.loaded} canManage={market.canManage} onBuild={() => void buildFromTemplate(tpl)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : tab === "connectors" ? (
          <div className="space-y-5">
            <p className="text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
              Anbindungen holen Daten aus Systemen, die du schon nutzt – die Daten bleiben dort. Verbunden wird über den MCP-Bereich in den Werkzeugen.
            </p>
            {categoriesFor(items).map((category) => (
              <section key={category}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--text-tertiary)]">{category}</p>
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                  {items.filter((i) => i.category === category).map((item) => <ConnectorCard key={item.id} item={item} onConnect={connect} />)}
                </div>
              </section>
            ))}
          </div>
        ) : tab !== "build" ? (
          <div className="space-y-5">
            {categoriesFor(items).map((category) => {
              const group = items.filter((i) => i.category === category);
              if (group.length === 0) return null;
              return (
                <section key={category}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--text-tertiary)]">{category}</p>
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {group.map((item) => (
                      <ItemCard key={item.id} item={item} installed={isItemInstalled(market.installed, item.id)} canManage={market.canManage}
                        busy={busyId === item.id} onToggle={() => void toggle(item)} onUse={() => use(item)} />
                    ))}
                  </div>
                </section>
              );
            })}
            {tab === "skills" ? (
              <p className="text-[11px] leading-relaxed text-[color:var(--text-tertiary)]">
                Ein Skill ist keine eigene App, sondern eine Arbeitsanleitung für Elly. „Verwenden“ setzt sie ins Eingabefeld – du ergänzt nur noch deine Angaben.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
            <div className="space-y-3">
              <div className="rounded-2xl p-3.5" style={card}>
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{editingId ? "Mini-App ändern" : "Was soll deine App können?"}</p>
                <p className="mt-0.5 text-[11px] text-[color:var(--text-secondary)]">Elly baut daraus eine kleine App. Sie läuft abgeschottet: ohne Internet und ohne Zugriff auf deine Daten.</p>
                <textarea
                  ref={descriptionRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="z. B. Ein Surf-Logbuch: Spot, Datum, Wellenhöhe und Notizen eintragen, Liste mit Filter nach Spot."
                  className="mt-2.5 min-h-[120px] w-full resize-y rounded-xl px-3 py-2 text-[13px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-tertiary)]"
                  style={{ background: "var(--bg-canvas)", border: "1px solid var(--os-border-soft)" }}
                />
                <button type="button" onClick={() => void build(false)} disabled={building || description.trim().length < 8 || !market.canManage}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "var(--os-accent)" }}>
                  {building && !draft ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} {draft ? "Neu bauen" : "Bauen"}
                </button>
                {building ? <p className="mt-2 text-[11px] text-[color:var(--text-tertiary)]">Elly baut … das dauert meist 20–60 Sekunden.</p> : null}
              </div>

              {draft ? (
                <div className="rounded-2xl p-3.5" style={card}>
                  <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{draft.icon} {draft.name}</p>
                  <p className="mt-0.5 text-[11px] text-[color:var(--text-secondary)]">{draft.description}</p>
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Änderungswunsch, z. B. „Füge einen Export als CSV hinzu“"
                    className="mt-2.5 min-h-[70px] w-full resize-y rounded-xl px-3 py-2 text-[12px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-tertiary)]"
                    style={{ background: "var(--bg-canvas)", border: "1px solid var(--os-border-soft)" }} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void build(true)} disabled={building || feedback.trim().length < 3}
                      className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--text-primary)] disabled:opacity-50" style={{ borderColor: "var(--os-border-soft)" }}>
                      {building ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Ändern
                    </button>
                    <button type="button" onClick={() => void save()} disabled={saving || building}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50" style={{ background: "#16a34a" }}>
                      {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {editingId ? "Änderung speichern" : "Freigeben & installieren"}
                    </button>
                    <button type="button" onClick={() => { setDraft(null); setEditingId(null); }} className="rounded-lg px-2.5 py-1.5 text-[11px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]">Verwerfen</button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl p-3.5" style={card}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--text-tertiary)]">Meine Mini-Apps</p>
                {market.miniApps.length === 0 ? (
                  <p className="text-[11px] text-[color:var(--text-secondary)]">Noch keine. Beschreibe oben deine erste App – oder sag Elly „Bau mir eine App, die …“.</p>
                ) : (
                  <div className="space-y-1">
                    {market.miniApps.map((app) => (
                      <div key={app.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/5">
                        <span className="text-base">{app.icon}</span>
                        <button type="button" onClick={() => { openMiniApp(app.id); requestOpenApp("mini_apps"); }} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-[12px] font-medium text-[color:var(--text-primary)]">{app.name}</span>
                          <span className="block truncate text-[10px] text-[color:var(--text-tertiary)]">{app.description}</span>
                        </button>
                        {market.canManage ? (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                            <button type="button" title="Ändern" onClick={() => void editMiniApp(app.id)} className="rounded p-1 text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"><Wand2 size={12} /></button>
                            <button type="button" title="Löschen" onClick={() => void removeMiniApp(app.id)} className="rounded p-1 text-[color:var(--text-tertiary)] hover:text-rose-400"><Trash2 size={12} /></button>
                          </div>
                        ) : null}
                        <ChevronRight size={12} className="shrink-0 text-[color:var(--text-tertiary)]" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-[480px] flex-col rounded-2xl p-2" style={card}>
              <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--text-tertiary)]">Vorschau</p>
              {draft ? (
                <MiniAppFrame
                  key={draft.html.length}
                  html={draft.html}
                  onAsk={ask}
                  onError={(message) => setPreviewError((prev) => prev ?? message)}
                  errorAction={
                    <button type="button" onClick={() => void fixPreviewError()} disabled={building}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60" style={{ background: "var(--os-accent)" }}>
                      {building ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Automatisch beheben
                    </button>
                  }
                />
              ) : (
                <div className="grid flex-1 place-items-center text-center text-[12px] text-[color:var(--text-tertiary)]">
                  {building ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Elly baut deine App …</span> : "Hier erscheint die App, sobald Elly sie gebaut hat. Du kannst sie ausprobieren, bevor du sie freigibst."}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
