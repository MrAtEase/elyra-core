"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3, Bot, Bug, Check, Code2, Copy, Download, Globe, GraduationCap, ImageIcon, Landmark, LineChart, Loader2, Mail, Megaphone,
  Palette, PenLine, Presentation, RefreshCw, RotateCcw, ScanSearch, Search, Send, Share2, ShieldCheck, Swords, Target, Upload, UserRound, Users, X,
} from "lucide-react";
import ChatMarkdown from "@/components/agent/ChatMarkdown";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import {
  fetchAgentTeamRun,
  fetchAgentTeamRuns,
  reviseAgentTeamAgent,
  startAgentTeamRun,
  type AgentTeamAgentId,
  type AgentTeamAgentState,
  type AgentTeamRun,
} from "@/components/os/kernel/aiClient";

/**
 * Agenten-Team: Ein Orchestrator verteilt einen Auftrag an Spezial-Agenten
 * (Online-Marketing, Texter, Design, Coding parallel; Präsentation baut darauf auf)
 * und führt die Ergebnisse zusammen. Alles sind Entwürfe – der Mensch gibt frei.
 */

type AgentGroup = "marketing" | "creative" | "personal" | "dev";

const AGENT_META: Record<AgentTeamAgentId, { label: string; icon: typeof Bot; color: string; role: string; example: string; group: AgentGroup; tool?: string }> = {
  marketing: { group: "marketing", label: "Online-Marketing", icon: Megaphone, color: "#7B61FF", role: "Strategie, Zielgruppen, Kanäle, KPIs",
    example: "Erstelle eine Online-Marketing-Strategie für einen Laufschuh-Onlineshop mit 3.000 € Monatsbudget." },
  sea: { group: "marketing", label: "SEA-Analyst", icon: ScanSearch, color: "#DC2626", role: "Google Ads: Verschwendung, Ausschlüsse, Gebote", tool: "Ads Audit (CSV)",
    example: "Analysiere mein Google-Ads-Konto und sag mir, wo Budget verschwendet wird." },
  seo: { group: "marketing", label: "SEO", icon: Search, color: "#0891B2", role: "Keyword-Cluster, Struktur, Meta-Texte",
    example: "Erstelle Keyword-Cluster und Meta-Titel für einen Online-Shop für Laufschuhe." },
  social: { group: "marketing", label: "Social Media", icon: Share2, color: "#EC4899", role: "Redaktionsplan, Posts, Bildideen",
    example: "Erstelle einen 2-Wochen-Redaktionsplan für LinkedIn und Instagram für eine KI-Agentur." },
  copy: { group: "marketing", label: "Texter", icon: PenLine, color: "#0EA5E9", role: "Anzeigentexte, Landingpage, Posts",
    example: "Schreib Anzeigentitel und Beschreibungen für einen Steuerberater in Stuttgart, der neue Mandanten sucht." },
  reporting: { group: "marketing", label: "Reporting", icon: BarChart3, color: "#7B61FF", role: "Kundenreport + Deck aus Kampagnendaten", tool: "Reporting-App (Beispieldaten)",
    example: "Erstelle den Monatsreport für den Kunden mit Empfehlungen und Präsentation." },
  leads: { group: "marketing", label: "Lead-Recherche", icon: Target, color: "#16A34A", role: "Firmen finden, bewerten, ansprechen", tool: "Leads-App (Beispieldaten)",
    example: "Finde passende Zahnarztpraxen in Stuttgart und schreib eine Erstansprache." },
  competitor: { group: "marketing", label: "Wettbewerb", icon: Swords, color: "#B45309", role: "Konkurrenz vergleichen, Chancen finden",
    example: "Vergleiche die Positionierung von drei Performance-Agenturen (Namen im Kontext)." },
  tracking: { group: "marketing", label: "Tracking & Daten", icon: LineChart, color: "#0D9488", role: "GA4, GTM, Conversions, dataLayer",
    example: "Erstelle einen GA4-Tracking-Plan für einen Online-Shop inkl. dataLayer für Käufe." },
  design: { group: "creative", label: "Design", icon: Palette, color: "#D946EF", role: "Logos, Farben, Schriften, Entwürfe", tool: "Bildmodell",
    example: "Designe ein Logo für Elyra Core – modern, technisch, vertrauenswürdig." },
  presentation: { group: "creative", label: "Präsentation", icon: Presentation, color: "#16A34A", role: "Decks für Kunden und Team", tool: "Slides",
    example: "Mach eine 8-Folien-Präsentation: Warum KI-Agenten für Marketing-Agenturen jetzt relevant sind." },
  application: { group: "personal", label: "Bewerbung", icon: UserRound, color: "#7C3AED", role: "CV anpassen, Anschreiben, Video-Skript",
    example: "Analysiere die Stellenanzeige im Kontext und schreib mir ein Video-Skript für die Bewerbung." },
  mail: { group: "personal", label: "Mail & Termine", icon: Mail, color: "#2563EB", role: "Posteingang sortieren, Antworten entwerfen", tool: "Gmail & Kalender (nur lesen)",
    example: "Was in meinem Posteingang ist wichtig, und wann habe ich diese Woche Zeit?" },
  authority: { group: "personal", label: "Behörden-Brief", icon: Landmark, color: "#475569", role: "Formelle Briefe PT + deutsche Übersetzung",
    example: "Schreib einen Brief an die Finanças: Ich bitte um eine Bestätigung meiner Steuernummer (NIF) für meinen Arbeitgeber." },
  research: { group: "personal", label: "Recherche", icon: Globe, color: "#0EA5E9", role: "Websuche mit Quellen", tool: "Google-Suche (Gemini)",
    example: "Welche Förderprogramme für die Digitalisierung kleiner Unternehmen gibt es aktuell in Deutschland?" },
  coach: { group: "personal", label: "Lern-Coach", icon: GraduationCap, color: "#F59E0B", role: "Lernpläne: Tools, Sprachen, Weiterbildung",
    example: "Mach einen 2-Wochen-Lernplan, damit unser Team Google Ads Editor sicher bedienen kann, 20 Minuten pro Tag." },
  coding: { group: "dev", label: "Coding", icon: Code2, color: "#F97316", role: "Scripts, Automatisierungen, Tools",
    example: "Schreib ein Google-Ads-Script, das mir täglich Kampagnen mit stark gestiegenem CPA meldet." },
  review: { group: "dev", label: "Code-Review", icon: ShieldCheck, color: "#059669", role: "Fehler, Sicherheit, Lesbarkeit prüfen",
    example: "Prüfe den Code im Kontext auf Fehler und Sicherheitsprobleme." },
  qa: { group: "dev", label: "QA / Tester", icon: Bug, color: "#E11D48", role: "Testpläne und Tests schreiben",
    example: "Schreib Vitest-Tests für die Funktion im Kontext." },
};

const GROUPS: Array<{ id: AgentGroup; label: string }> = [
  { id: "marketing", label: "Marketing" },
  { id: "creative", label: "Kreativ" },
  { id: "personal", label: "Persönlich" },
  { id: "dev", label: "Entwicklung" },
];
const AGENT_IDS = Object.keys(AGENT_META) as AgentTeamAgentId[];

const EXAMPLES = [
  "Designe ein Logo für Elyra Core – modern, technisch, vertrauenswürdig.",
  "Launch-Kampagne für einen Online-Shop mit Laufschuhen: Strategie, Anzeigentexte, Look für die Landingpage und eine Kundenpräsentation.",
  "Google-Ads-Konto aufräumen: Analyse, Ausschluss-Keywords, ein Script zur täglichen Kontrolle und ein kurzes Deck fürs Team.",
];

type Review = "approved" | "rejected";

function elapsed(from: string | null, to: string | null): string {
  if (!from) return "";
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from);
  return `${Math.max(0, Math.round(ms / 1000))} s`;
}

function download(filename: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ state }: { state: AgentTeamAgentState }) {
  if (state.status === "running") {
    return <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-muted)]"><Loader2 size={11} className="animate-spin" /> arbeitet · {elapsed(state.startedAt, null)}</span>;
  }
  if (state.status === "queued") return <span className="text-[11px] text-[color:var(--text-muted)]">{state.phase === 2 ? "wartet auf Team" : "in Warteschlange"}</span>;
  if (state.status === "failed") return <span className="text-[11px] text-[#dc2626]">Fehler</span>;
  return (
    <span className="text-[11px] text-[color:var(--text-muted)]">
      fertig · {elapsed(state.startedAt, state.finishedAt)} · {state.source === "template" ? "Vorlage" : state.model ?? "KI"}
      {state.revisions ? ` · ${state.revisions}× überarbeitet` : ""}
    </span>
  );
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Erzeugt mit Elyras Bildmodell (Bilder-App) echte Logo-Bilder aus den Prompts des Design-Agenten. */
function LogoImages({ prompts, workspaceId }: { prompts: string[]; workspaceId: string | null }) {
  const [images, setImages] = useState<Array<{ prompt: string; dataUrl: string | null; error: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  const generate = useCallback(async () => {
    if (!workspaceId || prompts.length === 0) return;
    setLoading(true);
    setImages(prompts.map((prompt) => ({ prompt, dataUrl: null, error: null })));
    const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
    await Promise.all(prompts.map(async (prompt, i) => {
      try {
        const res = await fetch("/api/os/generate/image", { method: "POST", headers, body: JSON.stringify({ prompt, workspaceId, aspectRatio: "1:1" }) });
        const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; images?: Array<{ dataUrl: string }>; error?: string };
        const url = data.ok ? data.images?.[0]?.dataUrl ?? null : null;
        setImages((prev) => prev.map((x, j) => (j === i ? { ...x, dataUrl: url, error: url ? null : data.error ?? "Bild konnte nicht erzeugt werden" } : x)));
      } catch (err) {
        setImages((prev) => prev.map((x, j) => (j === i ? { ...x, error: (err as Error).message } : x)));
      }
    }));
    setLoading(false);
  }, [prompts, workspaceId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void generate();
  }, [generate]);

  if (!workspaceId) return <p className="text-[11px] text-[color:var(--text-muted)]">Für Logo-Bilder fehlt der Workspace in der Adresse.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="mr-auto flex items-center gap-1 text-[11px] font-medium text-[color:var(--text-muted)]"><ImageIcon size={12} /> Bild-Entwürfe (Bildmodell)</p>
        <button type="button" onClick={() => void generate()} disabled={loading} className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:underline disabled:opacity-50">
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Neu erzeugen
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {images.map((img, i) => (
          <div key={`${i}-${img.prompt.slice(0, 20)}`} className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--os-border-soft)" }}>
            {img.dataUrl ? (
              <a href={img.dataUrl} download={`logo-bild-${i + 1}.png`} title="Herunterladen">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={`Logo-Bild ${i + 1}`} className="aspect-square w-full object-contain" />
              </a>
            ) : (
              <div className="flex aspect-square items-center justify-center p-2 text-center text-[10px] text-[color:var(--text-muted)]">
                {img.error ? img.error : <Loader2 size={16} className="animate-spin" />}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[color:var(--text-muted)]">KI-Bilder sind Ideenskizzen. Für ein finales Logo die beste Richtung als Vektor nachbauen lassen.</p>
    </div>
  );
}

function AgentOutputView({ state, onOpenDeck, workspaceId }: { state: AgentTeamAgentState; onOpenDeck: (s: AgentTeamAgentState) => void; workspaceId: string | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const out = state.output;
  if (!out) return null;
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div className="space-y-3">
      {out.markdown ? <ChatMarkdown text={out.markdown} /> : null}
      {out.kind === "design" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {out.design.palette.map((p) => (
              <div key={p.hex + p.name} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "var(--os-border-soft)" }}>
                <span className="h-4 w-4 rounded" style={{ background: p.hex, border: "1px solid rgba(0,0,0,.1)" }} />
                <span className="text-[color:var(--text-primary)]">{p.name}</span>
                <code className="text-[color:var(--text-muted)]">{p.hex}</code>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[color:var(--text-muted)]">Schriften: {out.design.fonts.heading} / {out.design.fonts.body}</p>
          {out.design.principles.length ? (
            <ul className="list-disc pl-5 text-[12px] text-[color:var(--text-primary)]">{out.design.principles.map((p) => <li key={p}>{p}</li>)}</ul>
          ) : null}
          {out.design.deliverable === "logo" ? (
            <>
              <p className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--text-muted)]"><Palette size={12} /> Vektor-Entwürfe (SVG, editierbar)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {out.design.logos.map((logo, i) => (
                  <div key={`${i}-${logo.name}`} className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--os-border-soft)" }}>
                    {/* SVG als Bild: Skripte laufen in <img> nie */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={svgDataUrl(logo.svg)} alt={logo.name} className="aspect-[2/1] w-full bg-white object-contain p-3" />
                    <div className="flex items-start gap-2 border-t px-3 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
                      <div className="mr-auto">
                        <p className="text-[12px] font-medium text-[color:var(--text-primary)]">{logo.name}</p>
                        {logo.idea ? <p className="text-[11px] text-[color:var(--text-muted)]">{logo.idea}</p> : null}
                      </div>
                      <button type="button" onClick={() => download(`logo-${i + 1}.svg`, logo.svg, "image/svg+xml")} className="flex shrink-0 items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:underline">
                        <Download size={11} /> SVG
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {out.design.imagePrompts.length ? <LogoImages prompts={out.design.imagePrompts} workspaceId={workspaceId} /> : null}
            </>
          ) : (
            <>
              {/* sandbox ohne Rechte: kein JavaScript, keine Formulare, kein Zugriff auf Elyra */}
              <iframe title={`Design-Entwurf ${state.agent}`} sandbox="" srcDoc={out.design.html} className="h-[320px] w-full rounded-xl border bg-white" style={{ borderColor: "var(--os-border-soft)" }} />
              <button type="button" onClick={() => download("design-entwurf.html", out.design.html, "text/html")} className="flex items-center gap-1 text-[11px] text-[color:var(--text-muted)] hover:underline">
                <Download size={11} /> HTML herunterladen
              </button>
            </>
          )}
        </>
      ) : null}
      {out.kind === "code" ? (
        <div className="space-y-2">
          {out.files.map((f) => (
            <div key={f.path} className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--os-border-soft)" }}>
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[11px]" style={{ borderColor: "var(--os-border-soft)" }}>
                <code className="mr-auto text-[color:var(--text-primary)]">{f.path}</code>
                <button type="button" onClick={() => copy(f.path, f.content)} className="flex items-center gap-1 text-[color:var(--text-muted)] hover:underline">
                  <Copy size={11} /> {copied === f.path ? "Kopiert" : "Kopieren"}
                </button>
                <button type="button" onClick={() => download(f.path.split("/").pop() || "code.txt", f.content)} className="flex items-center gap-1 text-[color:var(--text-muted)] hover:underline">
                  <Download size={11} /> Datei
                </button>
              </div>
              <pre className="max-h-72 overflow-auto p-3 text-[11px] leading-relaxed text-[color:var(--text-primary)]"><code>{f.content}</code></pre>
            </div>
          ))}
          <p className="text-[10px] text-[color:var(--text-muted)]">Code wird nicht automatisch ausgeführt oder ins Repo übernommen. Erst prüfen, dann im Prüfmodus testen.</p>
        </div>
      ) : null}
      {out.kind === "deck" ? (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[color:var(--text-primary)]">{out.deck.title}</p>
          <ol className="list-decimal pl-5 text-[12px] text-[color:var(--text-primary)]">
            {out.deck.slides.map((s, i) => <li key={`${i}-${s.title}`}>{s.title} <span className="text-[10px] text-[color:var(--text-muted)]">({s.layout ?? "bullets"})</span></li>)}
          </ol>
          <button type="button" onClick={() => onOpenDeck(state)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white" style={{ background: "#16A34A" }}>
            <Presentation size={12} /> In Slides öffnen
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AgentTeamWindow({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "team">("single");
  const [singleAgent, setSingleAgent] = useState<AgentTeamAgentId>("design");
  const searchParams = useSearchParams();
  const [task, setTask] = useState("");
  const [context, setContext] = useState("");
  const [selected, setSelected] = useState<AgentTeamAgentId[]>([]);
  const [adsCsv, setAdsCsv] = useState<{ name: string; text: string } | null>(null);
  const [run, setRun] = useState<AgentTeamRun | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; task: string; status: string; createdAt: string; mode: "single" | "team"; agents: AgentTeamAgentId[] }>>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [feedbackFor, setFeedbackFor] = useState<AgentTeamAgentId | null>(null);
  const [feedback, setFeedback] = useState("");
  const [, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = run !== null && (run.status === "planning" || run.status === "running" || run.status === "merging");

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await fetchAgentTeamRuns()).runs);
    } catch {
      // Verlauf ist optional
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // Live-Status abfragen, solange das Team arbeitet
  useEffect(() => {
    if (!run || !busy) return;
    const id = run.id;
    const timer = window.setInterval(() => {
      setTick((t) => t + 1);
      void fetchAgentTeamRun(id).then(setRun).catch((err: unknown) => setError((err as Error).message));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [run, busy]);

  useEffect(() => {
    if (run && run.status === "done") void loadHistory();
  }, [run, loadHistory]);

  const toggleAgent = useCallback((id: AgentTeamAgentId) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const start = useCallback(async () => {
    if (task.trim().length < 5) {
      setError("Bitte beschreibe den Auftrag in mindestens einem Satz.");
      return;
    }
    setStarting(true);
    setError(null);
    setReviews({});
    try {
      const created = await startAgentTeamRun({
        task: task.trim(),
        mode,
        ...(searchParams.get("workspaceId") ? { workspaceId: searchParams.get("workspaceId") ?? "" } : {}),
        ...(context.trim() ? { context: context.trim() } : {}),
        ...(mode === "single" ? { agents: [singleAgent] } : selected.length ? { agents: selected } : {}),
        ...(adsCsv && (mode === "team" || singleAgent === "marketing" || singleAgent === "sea") ? { adsCsv: adsCsv.text } : {}),
      });
      setRun(created);
    } catch (err) {
      setError((err as Error).message || "Start fehlgeschlagen");
    } finally {
      setStarting(false);
    }
  }, [task, context, selected, adsCsv, mode, singleAgent, searchParams]);

  const openRun = useCallback(async (id: string) => {
    try {
      setRun(await fetchAgentTeamRun(id));
      setReviews({});
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const submitRevision = useCallback(async () => {
    if (!run || !feedbackFor || feedback.trim().length < 3) return;
    try {
      setRun(await reviseAgentTeamAgent(run.id, feedbackFor, feedback.trim()));
      setReviews((prev) => {
        const next = { ...prev };
        delete next[feedbackFor];
        return next;
      });
      setFeedbackFor(null);
      setFeedback("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [run, feedbackFor, feedback]);

  const openDeck = useCallback((state: AgentTeamAgentState) => {
    if (state.output?.kind !== "deck") return;
    try {
      window.sessionStorage.setItem("elyra:pending-deck", JSON.stringify({
        id: `team-${Date.now()}`,
        title: state.output.deck.title,
        slides: state.output.deck.slides,
        source: "generated",
        theme: "executive",
        providerLabel: state.source === "template" ? "Agenten-Team (Vorlage)" : `Agenten-Team · ${state.model ?? "KI"}`,
      }));
    } catch {
      setError("Präsentation konnte nicht übergeben werden (Browser-Speicher nicht verfügbar).");
      return;
    }
    const ws = searchParams.get("workspaceId");
    router.push(`/os/slides${ws ? `?workspaceId=${encodeURIComponent(ws)}` : ""}`);
  }, [router, searchParams]);

  const exportAll = useCallback(() => {
    if (!run) return;
    const parts = [`# ${run.mode === "single" ? run.agents[0]?.name ?? "Agent" : "Agenten-Team"}: ${run.task}`, "", run.final?.markdown ?? "", ""];
    for (const a of run.agents) {
      const review = reviews[a.agent];
      parts.push(`## ${a.name} – ${review === "approved" ? "freigegeben" : review === "rejected" ? "abgelehnt" : "offen"}${a.source === "template" ? " (Vorlage)" : ""}`);
      parts.push(`_Auftrag: ${a.brief}_`, "");
      const o = a.output;
      if (o) {
        parts.push(o.markdown);
        if (o.kind === "design") parts.push("", `Farben: ${o.design.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}`, `Schriften: ${o.design.fonts.heading} / ${o.design.fonts.body}`, ...o.design.logos.map((l) => `\n**${l.name}** – ${l.idea}\n\n\`\`\`svg\n${l.svg}\n\`\`\``));
        if (o.kind === "code") for (const f of o.files) parts.push("", `\`${f.path}\``, "```" + f.language, f.content, "```");
        if (o.kind === "deck") parts.push("", ...o.deck.slides.map((s, i) => `${i + 1}. ${s.title}`));
      }
      parts.push("");
    }
    download("agenten-team-ergebnis.md", parts.join("\n"), "text/markdown");
  }, [run, reviews]);

  const approvedCount = useMemo(() => Object.values(reviews).filter((r) => r === "approved").length, [reviews]);

  return (
    <div className={`flex overflow-hidden ${embedded ? "h-[780px] rounded-2xl border" : "h-full"}`} style={embedded ? { borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" } : undefined}>
      {/* Auftrag */}
      <aside className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-r p-4" style={{ borderColor: "var(--os-border-soft)" }}>
        <div className="flex items-center gap-2">
          <Users size={18} className="text-[color:var(--text-primary)]" />
          <div>
            <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">Agenten</p>
            <p className="text-[11px] text-[color:var(--text-muted)]">Einzeln oder als Team – du gibst frei</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border p-1" style={{ borderColor: "var(--os-border-soft)" }}>
          {(["single", "team"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className="rounded-lg px-2 py-1.5 text-[11px] font-medium"
              style={{ background: mode === m ? "#7B61FF" : "transparent", color: mode === m ? "#fff" : "var(--text-primary)" }}>
              {m === "single" ? "Einzelner Agent" : "Team"}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="space-y-3">
            {GROUPS.map((g) => (
            <div key={g.id} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">{g.label}</p>
            {AGENT_IDS.filter((id) => AGENT_META[id].group === g.id).map((id) => {
              const meta = AGENT_META[id];
              const Icon = meta.icon;
              const on = singleAgent === id;
              return (
                <button key={id} type="button" onClick={() => setSingleAgent(id)}
                  className="flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left"
                  style={{ borderColor: on ? meta.color : "var(--os-border-soft)", background: on ? `${meta.color}1a` : "transparent" }}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={14} /></span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[color:var(--text-primary)]">{meta.label}</span>
                    <span className="block truncate text-[10px] text-[color:var(--text-muted)]">{meta.role}</span>
                    {meta.tool ? <span className="block truncate text-[9px]" style={{ color: meta.color }}>Werkzeug: {meta.tool}</span> : null}
                  </span>
                </button>
              );
            })}
            </div>
            ))}
          </div>
        ) : null}

        <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={5} placeholder={mode === "single" ? `Was soll ${AGENT_META[singleAgent].label} erledigen?` : "Was soll das Team erledigen?"}
          className="min-h-[132px] w-full shrink-0 resize-y rounded-xl border bg-transparent p-3 text-[13.5px] leading-relaxed text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }} />
        <div className="flex flex-col gap-1">
          {(mode === "single" ? [AGENT_META[singleAgent].example] : EXAMPLES).map((ex) => (
            <button key={ex} type="button" onClick={() => setTask(ex)} className="text-left text-[12px] leading-snug text-[color:var(--text-muted)] hover:underline">→ {ex.slice(0, 90)}…</button>
          ))}
        </div>

        {mode === "team" ? (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-[color:var(--text-muted)]">Agenten {selected.length ? "(manuell gewählt)" : "(der Orchestrator wählt)"}</p>
          <div className="space-y-2">
          {GROUPS.map((g) => (
          <div key={g.id}>
          <p className="mb-1 text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_IDS.filter((id) => AGENT_META[id].group === g.id).map((id) => {
              const meta = AGENT_META[id];
              const on = selected.includes(id);
              const Icon = meta.icon;
              return (
                <button key={id} type="button" onClick={() => toggleAgent(id)}
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
                  style={{ borderColor: on ? meta.color : "var(--os-border-soft)", background: on ? `${meta.color}22` : "transparent", color: "var(--text-primary)" }}>
                  <Icon size={11} /> {meta.label}
                </button>
              );
            })}
          </div>
          </div>
          ))}
          </div>
        </div>
        ) : null}

        <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3} placeholder="Kontext (optional): Kunde, Budget, Zielgruppe, Notizen …"
          className="min-h-[88px] w-full shrink-0 resize-y rounded-xl border bg-transparent p-3 text-[13px] leading-relaxed text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }} />

        {mode === "team" || singleAgent === "marketing" || singleAgent === "sea" ? (
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
          <Upload size={13} /> {adsCsv ? `Ads-Bericht: ${adsCsv.name}` : "Google-Ads-Suchbegriffe (CSV, optional)"}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((text) => setAdsCsv({ name: f.name, text }));
          }} />
        </label>
        ) : null}
        {adsCsv && (mode === "team" || singleAgent === "marketing" || singleAgent === "sea") ? (
          <button type="button" onClick={() => { setAdsCsv(null); if (fileRef.current) fileRef.current.value = ""; }} className="-mt-2 text-left text-[10px] text-[color:var(--text-muted)] hover:underline">entfernen</button>
        ) : null}

        <button type="button" onClick={() => void start()} disabled={starting || busy}
          className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "#7B61FF" }}>
          {starting || busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {busy ? "Arbeitet …" : mode === "single" ? `An ${AGENT_META[singleAgent].label} senden` : "Team starten"}
        </button>

        {error ? <p className="text-[11px] text-[#dc2626]">{error}</p> : null}

        {history.length ? (
          <div className="mt-2">
            <p className="mb-1 text-[11px] font-medium text-[color:var(--text-muted)]">Letzte Aufträge</p>
            <ul className="space-y-1">
              {history.slice(0, 8).map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => void openRun(h.id)} className="w-full truncate text-left text-[11px] text-[color:var(--text-primary)] hover:underline">
                    {h.status === "done" ? "✓" : "…"} {h.mode === "single" && h.agents[0] ? `[${AGENT_META[h.agents[0]].label}] ` : "[Team] "}{h.task}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      {/* Team-Arbeit */}
      <main className="flex-1 overflow-y-auto p-5">
        {!run ? (
          <div className="mx-auto mt-20 max-w-lg text-center text-[13px] text-[color:var(--text-muted)]">
            <Users size={30} className="mx-auto mb-3 opacity-60" />
            <p>{mode === "single"
              ? `Wähle links einen Agenten und gib ihm einen Auftrag – ${AGENT_META[singleAgent].label} arbeitet allein und direkt.`
              : "Beschreibe einen Auftrag. Der Orchestrator verteilt ihn an Online-Marketing, Texter, Design und Coding – sie arbeiten parallel. Danach baut der Präsentations-Agent aus allem ein Deck."}</p>
            <p className="mt-2 text-[11px]">Alles sind Entwürfe. Nichts wird veröffentlicht, gesendet oder ins Repo übernommen, bevor du es freigibst.</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                {run.mode === "single" ? `Einzelner Agent · ${run.agents[0]?.name ?? ""} · ` : "Team · "}
                {run.status === "planning" ? "Orchestrator plant …" : run.status === "running" ? "arbeitet" : run.status === "merging" ? "Ergebnisse werden zusammengeführt …" : run.status === "done" ? "Fertig" : "Fehlgeschlagen"}
              </p>
              <p className="mt-1 text-[15px] font-semibold text-[color:var(--text-primary)]">{run.task}</p>
              {run.plan?.summary ? <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{run.plan.summary}</p> : null}
              {run.error ? <p className="mt-1 text-[12px] text-[#dc2626]">{run.error}</p> : null}
            </div>

            {run.final ? (
              <section className="mb-4 rounded-2xl border p-4" style={{ borderColor: "#7B61FF55", background: "var(--bg-surface)" }}>
                <div className="mb-2 flex items-center gap-2">
                  <Bot size={14} className="text-[color:var(--text-primary)]" />
                  <h3 className="mr-auto text-[13px] font-semibold text-[color:var(--text-primary)]">Gesamtergebnis</h3>
                  <span className="text-[11px] text-[color:var(--text-muted)]">{approvedCount}/{run.agents.length} freigegeben</span>
                  <button type="button" onClick={exportAll} className="flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                    <Download size={11} /> Alles als .md
                  </button>
                </div>
                <ChatMarkdown text={run.final.markdown} />
              </section>
            ) : null}

            <div className={`grid gap-4 ${run.agents.length > 1 ? "xl:grid-cols-2" : ""}`}>
              {run.agents.map((a) => {
                const meta = AGENT_META[a.agent];
                const Icon = meta.icon;
                const review = reviews[a.agent];
                return (
                  <section key={a.agent} className="rounded-2xl border p-4" style={{
                    borderColor: review === "approved" ? "#16a34a88" : review === "rejected" ? "#dc262655" : "var(--os-border-soft)",
                    background: "var(--bg-surface)",
                  }}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={14} /></span>
                      <div className="mr-auto">
                        <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{a.name}{a.phase === 2 ? " · Phase 2" : ""}</p>
                        <StatusBadge state={a} />
                      </div>
                    </div>
                    {run.mode === "team" ? <p className="mb-3 text-[11px] italic text-[color:var(--text-muted)]">Auftrag: {a.brief}</p> : null}
                    {a.error ? <p className="mb-2 text-[11px] text-[#b45309]">{a.error}</p> : null}
                    {a.status === "done" ? <AgentOutputView state={a} onOpenDeck={openDeck} workspaceId={searchParams.get("workspaceId")} /> : null}

                    {a.status === "done" && run.status === "done" ? (
                      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--os-border-soft)" }}>
                        {feedbackFor === a.agent ? (
                          <div className="space-y-2">
                            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} placeholder="Was soll anders werden?"
                              className="w-full resize-none rounded-lg border bg-transparent p-2 text-[11px] text-[color:var(--text-primary)] outline-none" style={{ borderColor: "var(--os-border-soft)" }} />
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => void submitRevision()} className="rounded-md px-2 py-0.5 text-[11px] text-white" style={{ background: "#7B61FF" }}>Überarbeiten lassen</button>
                              <button type="button" onClick={() => { setFeedbackFor(null); setFeedback(""); }} className="rounded-md border px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }}>Abbrechen</button>
                            </div>
                          </div>
                        ) : review ? (
                          <button type="button" onClick={() => setReviews((prev) => { const next = { ...prev }; delete next[a.agent]; return next; })}
                            className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }}>
                            <RotateCcw size={11} /> {review === "approved" ? "Freigegeben" : "Abgelehnt"} · zurücksetzen
                          </button>
                        ) : (
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setReviews((prev) => ({ ...prev, [a.agent]: "approved" }))} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-white" style={{ background: "#16a34a" }}>
                              <Check size={11} /> Freigeben
                            </button>
                            <button type="button" onClick={() => { setFeedbackFor(a.agent); setFeedback(""); }} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-[color:var(--text-primary)]" style={{ borderColor: "var(--os-border-soft)" }}>
                              <PenLine size={11} /> Überarbeiten
                            </button>
                            <button type="button" onClick={() => setReviews((prev) => ({ ...prev, [a.agent]: "rejected" }))} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)" }}>
                              <X size={11} /> Ablehnen
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
