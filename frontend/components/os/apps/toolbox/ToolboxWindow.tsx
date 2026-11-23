"use client";

/**
 * Werkzeuge – one window for the tool apps without a window of their own:
 * Elly (Texte), Recherche, Übersetzen, Wetter, Tagesplanung, Company Builder.
 * Open a specific tool with openToolbox("company_builder").
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Building2, CalendarClock, Check, CloudSun, Copy, Globe, Languages, Loader2, Play, Plug, Sparkles, ListTodo, Wand2,
} from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import McpPanel from "@/components/os/apps/toolbox/McpPanel";

export type ToolAppId = "mcp" | "elli" | "research" | "translate" | "weather" | "daily_planner" | "company_builder";

export const TOOLBOX_SELECT_KEY = "elyra:toolbox-select";
export const TOOLBOX_SELECT_EVENT = "elyra:toolbox-select";

/** Remember which tool to show, then the caller opens the "toolbox" app. */
export function selectToolboxTool(tool: ToolAppId) {
  try { window.sessionStorage.setItem(TOOLBOX_SELECT_KEY, tool); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(TOOLBOX_SELECT_EVENT, { detail: tool }));
}

type Field =
  | { key: string; label: string; kind: "text"; placeholder?: string; optional?: boolean }
  | { key: string; label: string; kind: "textarea"; placeholder?: string; optional?: boolean; rows?: number }
  | { key: string; label: string; kind: "select"; options: Array<{ value: string; label: string }>; optional?: boolean };

type ToolAction = { id: string; label: string; hint: string; fields: Field[]; run?: string };

type ToolDef = { id: ToolAppId; name: string; tagline: string; icon: typeof Sparkles; color: string; actions: ToolAction[] };

const LANGS = ["Portugiesisch (Portugal)", "Englisch", "Deutsch", "Kroatisch", "Portugiesisch (Brasilien)", "Spanisch", "Französisch", "Italienisch", "Niederländisch", "Polnisch", "Türkisch"]
  .map((l) => ({ value: l, label: l }));

const TOOLS: ToolDef[] = [
  {
    id: "mcp", name: "Dienste (MCP)", tagline: "Notion, Linear, GitHub … per Auftrag steuern", icon: Plug, color: "#0f766e",
    actions: [{ id: "agent", label: "Auftrag", hint: "", fields: [] }],
  },
  {
    id: "elli", name: "Elly – Texte", tagline: "Entwürfe, Zusammenfassungen, Gliederungen", icon: Sparkles, color: "#8b5cf6",
    actions: [
      { id: "write_draft", label: "Entwurf schreiben", hint: "E-Mail, Nachricht, Post, Antwort …", fields: [
        { key: "brief", label: "Worum geht es?", kind: "textarea", rows: 5, placeholder: "z. B. Antwort an den Vermieter: Übergabe auf den 15. verschieben, freundlich aber bestimmt" },
        { key: "tone", label: "Ton", kind: "select", optional: true, options: [
          { value: "freundlich-professionell", label: "Freundlich-professionell" }, { value: "locker", label: "Locker" },
          { value: "formell", label: "Formell" }, { value: "bestimmt", label: "Bestimmt" }, { value: "überzeugend", label: "Überzeugend" },
        ] },
      ] },
      { id: "summarize", label: "Zusammenfassen", hint: "Langen Text auf den Punkt bringen", fields: [
        { key: "text", label: "Text", kind: "textarea", rows: 10, placeholder: "Text hier einfügen …" },
      ] },
      { id: "outline", label: "Gliederung", hint: "Struktur für Artikel, Konzept, Präsentation", fields: [
        { key: "topic", label: "Thema", kind: "textarea", rows: 3, placeholder: "z. B. Konzept für einen KI-Workshop für Agenturen" },
      ] },
    ],
  },
  {
    id: "research", name: "Recherche", tagline: "Web-Recherche mit Google-Suche und Quellen", icon: Globe, color: "#0ea5e9",
    actions: [
      { id: "research", label: "Recherchieren", hint: "Aktuelle Fakten mit Quellen", fields: [
        { key: "query", label: "Thema / Frage", kind: "textarea", rows: 3, placeholder: "z. B. Wie hoch sind 2026 die Lebenshaltungskosten in Lissabon vs. Zagreb?" },
        { key: "depth", label: "Umfang", kind: "select", optional: true, options: [{ value: "gründlich", label: "Gründlich" }, { value: "kurz", label: "Kurz" }] },
      ] },
    ],
  },
  {
    id: "translate", name: "Übersetzen", tagline: "Natürliche Übersetzung in viele Sprachen", icon: Languages, color: "#10b981",
    actions: [
      { id: "translate", label: "Übersetzen", hint: "Ton und Formatierung bleiben erhalten", fields: [
        { key: "text", label: "Text", kind: "textarea", rows: 8, placeholder: "Text hier einfügen …" },
        { key: "target", label: "Zielsprache", kind: "select", options: LANGS },
      ] },
    ],
  },
  {
    id: "weather", name: "Wetter", tagline: "Aktuelles Wetter und 7-Tage-Vorhersage", icon: CloudSun, color: "#f59e0b",
    actions: [
      { id: "forecast", label: "Vorhersage", hint: "Jetzt und die nächsten 7 Tage", fields: [
        { key: "location", label: "Ort", kind: "text", placeholder: "z. B. Costa da Caparica" },
      ] },
    ],
  },
  {
    id: "daily_planner", name: "Tagesplanung", tagline: "Briefing und Tagesplan aus deinen Aufgaben", icon: CalendarClock, color: "#ec4899",
    actions: [
      { id: "plan_day", label: "Tagesplan", hint: "Zeitblöcke für heute", fields: [
        { key: "notes", label: "Was steht heute an? (optional)", kind: "textarea", rows: 4, optional: true, placeholder: "Termine, Energie-Level, was unbedingt fertig werden muss …" },
      ] },
      { id: "morning_brief", label: "Morgen-Briefing", hint: "Das Wichtigste auf einen Blick", fields: [
        { key: "notes", label: "Notizen (optional)", kind: "textarea", rows: 3, optional: true },
      ] },
      { id: "startpunkt", label: "Wo anfangen?", hint: "Der eine nächste Schritt", fields: [
        { key: "notes", label: "Was blockiert dich gerade? (optional)", kind: "textarea", rows: 3, optional: true },
      ] },
      { id: "next_steps", label: "Nächste Schritte", hint: "Die 5 wichtigsten To-dos", fields: [
        { key: "notes", label: "Kontext (optional)", kind: "textarea", rows: 3, optional: true },
      ] },
    ],
  },
  {
    id: "company_builder", name: "Company Builder", tagline: "Aufbaupläne, Prozesse, Dokumente, Reviews", icon: Building2, color: "#6366f1",
    actions: [
      { id: "build_plan", label: "Aufbauplan", hint: "Phasen, Meilensteine, Risiken", fields: [
        { key: "company", label: "Unternehmen", kind: "text", placeholder: "z. B. Elyra Core, Fish Delish Portugal" },
        { key: "focus", label: "Fokus (optional)", kind: "text", optional: true, placeholder: "z. B. Markteintritt, Finanzierung, erste Kunden" },
        { key: "context", label: "Kontext zum Unternehmen (optional)", kind: "textarea", rows: 4, optional: true, placeholder: "Was macht das Unternehmen, wo steht es, Budget, Team …" },
      ] },
      { id: "create_process", label: "Prozess", hint: "Schritt-für-Schritt mit Checkliste", fields: [
        { key: "company", label: "Unternehmen", kind: "text", placeholder: "z. B. Elyra Core, Fish Delish Portugal" },
        { key: "name", label: "Welcher Prozess?", kind: "text", placeholder: "z. B. Kunden-Onboarding, Rechnungsstellung" },
        { key: "context", label: "Kontext (optional)", kind: "textarea", rows: 3, optional: true },
      ] },
      { id: "create_document", label: "Dokument", hint: "Businessplan, SOP, Angebot …", fields: [
        { key: "company", label: "Unternehmen", kind: "text", placeholder: "z. B. Elyra Core, Fish Delish Portugal" },
        { key: "type", label: "Dokumenttyp", kind: "select", options: [
          { value: "business_plan", label: "Businessplan" }, { value: "pitch_deck", label: "Pitch-Deck-Gliederung" },
          { value: "ops_manual", label: "Betriebshandbuch" }, { value: "sop", label: "SOP / Arbeitsanweisung" },
          { value: "offer", label: "Angebot" }, { value: "email", label: "Geschäfts-E-Mail" }, { value: "contract", label: "Vertragsentwurf" },
        ] },
        { key: "title", label: "Titel", kind: "text", placeholder: "z. B. Businessplan Elyra Core 2027" },
        { key: "context", label: "Kontext / Inhalte (optional)", kind: "textarea", rows: 4, optional: true },
      ] },
      { id: "weekly_review", label: "Wochenreview", hint: "Fortschritt, Blocker, Fokus", fields: [
        { key: "company", label: "Unternehmen", kind: "text", placeholder: "z. B. Elyra Core, Fish Delish Portugal" },
        { key: "notes", label: "Was ist diese Woche passiert? (optional)", kind: "textarea", rows: 4, optional: true },
      ] },
    ],
  },
];

// ── Minimal Markdown renderer (headings, lists, tables, bold, italics, links, code) ─────────

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("**")) out.push(<strong key={key} className="font-semibold text-[color:var(--text-primary)]">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key} className="rounded bg-[color:var(--bg-surface-hover)] px-1 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      out.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer noopener" className="text-[color:var(--os-accent,#6366f1)] underline underline-offset-2">{label}</a>);
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    if (/^#{1,4}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 2;
      const content = trimmed.replace(/^#+\s*/, "");
      blocks.push(level <= 2
        ? <h3 key={i} className="mt-5 mb-2 text-[15px] font-semibold text-[color:var(--text-primary)] first:mt-0">{inline(content, `h${i}`)}</h3>
        : <h4 key={i} className="mt-4 mb-1.5 text-[13px] font-semibold text-[color:var(--text-primary)]">{inline(content, `h${i}`)}</h4>);
      i++; continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        const cells = (lines[i] ?? "").trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={`t${i}`} className="my-3 overflow-x-auto rounded-lg border border-[color:var(--os-border-soft)]">
          <table className="w-full text-left text-[12.5px]">
            {head ? <thead className="bg-[color:var(--bg-surface)]"><tr>{head.map((c, j) => <th key={j} className="px-3 py-2 font-semibold text-[color:var(--text-primary)]">{inline(c, `th${i}${j}`)}</th>)}</tr></thead> : null}
            <tbody>{body.map((r, k) => <tr key={k} className="border-t border-[color:var(--os-border-soft)]">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top text-[color:var(--text-secondary)]">{inline(c, `td${i}${k}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^([-*•]|\d+[.)])\s/.test(trimmed)) {
      const ordered = /^\d/.test(trimmed);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").trim().replace(/^([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={`l${i}`} className={`my-2 space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-[color:var(--text-secondary)] ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, j) => <li key={j}>{inline(it, `li${i}${j}`)}</li>)}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,4}\s|\||([-*•]|\d+[.)])\s)/.test((lines[i] ?? "").trim())) {
      para.push((lines[i] ?? "").trim());
      i++;
    }
    blocks.push(<p key={`p${i}`} className="my-2 text-[13.5px] leading-relaxed text-[color:var(--text-secondary)]">{para.map((p, j) => <Fragment key={j}>{j > 0 ? <br /> : null}{inline(p, `p${i}${j}`)}</Fragment>)}</p>);
  }
  return <div>{blocks}</div>;
}

// ── Window ──────────────────────────────────────────────────────────────────

type RunState = { status: "idle" } | { status: "running" } | { status: "error"; error: string } | {
  status: "done"; markdown: string; sources?: Array<{ title: string; uri: string }>; model?: string;
};

/** Tool requested by the launcher. The key is removed a moment later (React dev runs effects twice). */
function readInitialTool(): ToolAppId | null {
  try {
    const v = window.sessionStorage.getItem(TOOLBOX_SELECT_KEY) as ToolAppId | null;
    if (v && TOOLS.some((t) => t.id === v)) {
      window.setTimeout(() => { try { window.sessionStorage.removeItem(TOOLBOX_SELECT_KEY); } catch { /* ignore */ } }, 1500);
      return v;
    }
  } catch { /* ignore */ }
  return null;
}

export default function ToolboxWindow() {
  const { activeWorkspace } = useKernel();
  const [toolId, setToolId] = useState<ToolAppId>("company_builder");
  const [actionId, setActionId] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const initial = readInitialTool();
    if (initial) setToolId(initial);
    const onSelect = (e: Event) => {
      const tool = (e as CustomEvent<ToolAppId>).detail;
      if (TOOLS.some((t) => t.id === tool)) {
        setToolId(tool);
        try { window.sessionStorage.removeItem(TOOLBOX_SELECT_KEY); } catch { /* ignore */ }
      }
    };
    window.addEventListener(TOOLBOX_SELECT_EVENT, onSelect);
    return () => window.removeEventListener(TOOLBOX_SELECT_EVENT, onSelect);
  }, []);

  const tool = useMemo(() => TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]!, [toolId]);
  const action = useMemo(() => tool.actions.find((a) => a.id === actionId) ?? tool.actions[0]!, [tool, actionId]);

  useEffect(() => { setActionId(tool.actions[0]?.id ?? ""); setRun({ status: "idle" }); }, [tool]);
  useEffect(() => {
    const name = activeWorkspace.label?.trim();
    if (name) setValues((v) => (v.company ? v : { ...v, company: name }));
  }, [activeWorkspace.label]);
  useEffect(() => {
    // defaults for selects
    setValues((prev) => {
      const next = { ...prev };
      for (const f of action.fields) if (f.kind === "select" && !next[f.key]) next[f.key] = f.options[0]?.value ?? "";
      return next;
    });
  }, [action]);

  async function execute() {
    const missing = action.fields.find((f) => !f.optional && !(values[f.key] ?? "").trim());
    if (missing) { setRun({ status: "error", error: `Bitte „${missing.label}“ ausfüllen.` }); return; }
    setRun({ status: "running" });
    try {
      const fields: Record<string, string> = {};
      for (const f of action.fields) fields[f.key] = values[f.key] ?? "";
      const res = await fetch("/api/os/tool-apps/run", {
        method: "POST",
        credentials: "include",
        headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
        body: JSON.stringify({ workspaceId: activeWorkspace.id, tool: tool.id, action: action.id, fields }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; markdown?: string; sources?: Array<{ title: string; uri: string }>; model?: string } | null;
      if (!res.ok || !data?.ok || !data.markdown) throw new Error(data?.error ?? `Fehler ${res.status}`);
      setRun({ status: "done", markdown: data.markdown, ...(data.sources ? { sources: data.sources } : {}), ...(data.model ? { model: data.model } : {}) });
    } catch (err) {
      setRun({ status: "error", error: err instanceof Error ? err.message : "Unbekannter Fehler" });
    }
  }

  async function copyResult() {
    if (run.status !== "done") return;
    try { await navigator.clipboard.writeText(run.markdown); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  async function saveAsTask() {
    if (run.status !== "done") return;
    const title = `${tool.name}: ${action.label}${values.title ? ` – ${values.title}` : values.name ? ` – ${values.name}` : ""}`.slice(0, 200);
    try {
      await fetch("/api/os/tasks", {
        method: "POST", credentials: "include",
        headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
        body: JSON.stringify({ workspaceId: activeWorkspace.id, title }),
      });
    } catch { /* ignore */ }
  }

  const inputCls = "w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-[13px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-accent,#6366f1)]";

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)] bg-[color:var(--bg-canvas)] text-[color:var(--text-primary)]">
      {/* Tool list */}
      <aside className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-[color:var(--os-border-soft)] p-3">
        <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Werkzeuge</div>
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tool.id;
          return (
            <button key={t.id} type="button" onClick={() => setToolId(t.id)}
              className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${active ? "bg-[color:var(--bg-surface-hover)]" : "hover:bg-[color:var(--bg-surface)]"}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}><Icon size={16} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{t.name}</span>
                <span className="block truncate text-[11px] text-[color:var(--text-muted)]">{t.tagline}</span>
              </span>
            </button>
          );
        })}
      </aside>

      {/* Workspace */}
      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex flex-wrap items-center gap-2 border-b border-[color:var(--os-border-soft)] px-5 py-3">
          <h2 className="mr-3 text-[15px] font-semibold">{tool.name}</h2>
          {tool.actions.length > 1 && tool.actions.map((a) => (
            <button key={a.id} type="button" onClick={() => { setActionId(a.id); setRun({ status: "idle" }); }}
              className={`rounded-full border px-3 py-1 text-[12px] transition ${a.id === action.id ? "border-transparent text-white" : "border-[color:var(--os-border-soft)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-surface)]"}`}
              style={a.id === action.id ? { background: tool.color } : undefined}>
              {a.label}
            </button>
          ))}
        </header>

        {tool.id === "mcp" ? (
          <McpPanel workspaceId={activeWorkspace.id} color={tool.color} renderMarkdown={(text) => <Markdown text={text} />} />
        ) : (
        <div className="grid min-h-0 grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          {/* Form */}
          <form className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-[color:var(--os-border-soft)] p-5"
            onSubmit={(e) => { e.preventDefault(); void execute(); }}>
            <p className="text-[12px] text-[color:var(--text-muted)]">{action.hint}</p>
            {action.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-[color:var(--text-secondary)]">{f.label}</span>
                {f.kind === "textarea" ? (
                  <textarea rows={f.rows ?? 4} value={values[f.key] ?? ""} placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void execute(); } }}
                    className={`${inputCls} resize-y`} />
                ) : f.kind === "select" ? (
                  <select value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={inputCls}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input value={values[f.key] ?? ""} placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={inputCls} />
                )}
              </label>
            ))}
            <button type="submit" disabled={run.status === "running"}
              className="mt-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-60"
              style={{ background: tool.color }}>
              {run.status === "running" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {run.status === "running" ? "Läuft …" : action.label}
            </button>
            <p className="text-[10.5px] text-[color:var(--text-muted)]">⌘↩ zum Starten</p>
          </form>

          {/* Result */}
          <div className="min-h-0 overflow-y-auto p-6">
            {run.status === "idle" ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[color:var(--text-muted)]">
                <Wand2 size={28} style={{ color: tool.color }} />
                <p className="max-w-sm text-[13px]">Links ausfüllen und starten – das Ergebnis erscheint hier und lässt sich kopieren oder als Aufgabe merken.</p>
              </div>
            ) : run.status === "running" ? (
              <div className="flex h-full items-center justify-center gap-2 text-[13px] text-[color:var(--text-muted)]">
                <Loader2 size={16} className="animate-spin" /> {tool.id === "research" ? "Recherchiere im Web …" : "Wird erstellt …"}
              </div>
            ) : run.status === "error" ? (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-[13px] text-rose-600">{run.error}</div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[color:var(--text-muted)]">{run.model ?? ""}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void copyResult()} className="flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[11.5px] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-surface)]">
                      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Kopiert" : "Kopieren"}
                    </button>
                    <button type="button" onClick={() => void saveAsTask()} className="flex items-center gap-1.5 rounded-lg border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[11.5px] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-surface)]">
                      <ListTodo size={12} /> Als Aufgabe
                    </button>
                  </div>
                </div>
                <Markdown text={run.markdown} />
                {run.sources && run.sources.length > 0 ? (
                  <div className="mt-6 border-t border-[color:var(--os-border-soft)] pt-3">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Quellen</div>
                    <ol className="list-decimal space-y-1 pl-5 text-[12px]">
                      {run.sources.map((s, i) => (
                        <li key={i}><a href={s.uri} target="_blank" rel="noreferrer noopener" className="text-[color:var(--os-accent,#6366f1)] underline underline-offset-2">{s.title}</a></li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
        )}
      </section>
    </div>
  );
}
