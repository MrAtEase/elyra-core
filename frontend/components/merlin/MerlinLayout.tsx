"use client";

import { useEffect, useMemo, useState } from "react";
import MerlinChatPanel from "./MerlinChatPanel";
import Orb from "./Orb";

type MerlinView =
  | "home"
  | "planner"
  | "dev"
  | "knowledge"
  | "calendar"
  | "email"
  | "slides"
  | "tasks";

type MerlinLayoutProps = {
  initialView?: MerlinView;
};

type ModeMeta = {
  label: string;
  description: string;
};

const NAV_ITEMS: { id: MerlinView; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "planner", label: "Planner" },
  { id: "dev", label: "Dev" },
  { id: "knowledge", label: "Knowledge" },
  { id: "calendar", label: "Calendar" },
  { id: "email", label: "Mail" },
  { id: "slides", label: "Slides" },
  { id: "tasks", label: "Tasks" },
];

const MODE_META: Record<"holo" | "classic", ModeMeta> = {
  holo: {
    label: "Holo Mode",
    description: "Orb-powered, immersive workspace für den ersten Wow-Moment",
  },
  classic: {
    label: "Classic Mode",
    description: "Vertrauter Chat plus strukturierter Workspace für tiefes Arbeiten",
  },
};

const HERO_FACTS = [
  {
    label: "Autopilot",
    value: "Merlin observiert deinen Stack & schlägt die nächsten Schritte vor.",
  },
  {
    label: "Context",
    value: "Calendar, Mail, Slides, Tasks ergeben eine einzige Sicht auf dein Unternehmen.",
  },
  {
    label: "Ready",
    value: "Local Dev + Planner + Knowledge – alles in einer Shell, ohne Layout-Noise.",
  },
];

export default function MerlinLayout({ initialView = "home" }: MerlinLayoutProps) {
  const [view, setView] = useState<MerlinView>(initialView);
  const [mode, setMode] = useState<"holo" | "classic">("holo");
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isHoloChatOpen, setIsHoloChatOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
    const stored = window.localStorage.getItem("merlin.uiMode");
    if (stored === "holo" || stored === "classic") {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    window.localStorage.setItem("merlin.uiMode", mode);
  }, [mode, hasHydrated]);

  useEffect(() => {
    if (mode === "classic") {
      setIsHoloChatOpen(false);
    }
  }, [mode]);

  const layoutColumns = useMemo(
    () => (mode === "classic" ? "lg:grid-cols-[320px_minmax(0,1fr)_280px]" : "lg:grid-cols-[minmax(0,1fr)_280px]"),
    [mode]
  );

  const modeMeta = MODE_META[mode];
  const heroPaddingTop = mode === "holo" ? "pt-[220px] lg:pt-[240px]" : "pt-10";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="relative mx-auto flex min-h-screen max-w-screen-xl flex-col gap-6 px-5 py-8 lg:px-8">
        <header className="flex flex-col gap-4 rounded-3xl border border-white/15 bg-white/5 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.8)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-300/80">Fish Delish / Merlin Shell</p>
              <h1 className="text-2xl font-semibold text-white">V1 Merlin Shell</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-[999px] border border-white/20 bg-slate-900/70 p-1 shadow-sm">
                {(["holo", "classic"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setMode(option)}
                    className={`rounded-[999px] px-4 py-1 text-sm font-semibold transition ${
                      mode === option
                        ? "bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 shadow-lg"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {option === "holo" ? "Holo" : "Classic"}
                  </button>
                ))}
              </div>
              {mode === "holo" && (
                <button
                  onClick={() => setIsHoloChatOpen((prev) => !prev)}
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/90"
                >
                  {isHoloChatOpen ? "Hide Chat" : "Chat"}
                </button>
              )}
              <button
                onClick={() => setShowSettings(true)}
                className="rounded-2xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 transition hover:border-white/50"
              >
                Settings
              </button>
              <button
                onClick={() => setShowHelp(true)}
                className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/50"
              >
                Help
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-300">{modeMeta.description}</p>
        </header>

        <div className={`grid gap-6 ${layoutColumns}`}>
          {mode === "classic" && (
            <MerlinChatPanel className="sticky top-4" />
          )}

          <main className="flex flex-col gap-6">
            <section
              className={`relative flex flex-col gap-6 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-cyan-500/30 via-slate-900/80 to-slate-950 px-6 pb-10 shadow-[0_30px_80px_rgba(2,6,23,0.85)] ${heroPaddingTop}`}
            >
              {mode === "holo" && (
                <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                  <Orb mode={mode} />
                </div>
              )}
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-100/70">{modeMeta.label}</p>
                  <h2 className="text-3xl font-semibold text-white">Merlin is your orbital assistant</h2>
                </div>
              </div>
              <p className="max-w-2xl text-sm text-slate-100/90">
                Im Holo Modus erstrahlt Merlin als zentrierter Orb, der deinen Kontext scannt und dich mit einem
                holographischen Glow auf dem Laufenden hält. Classic Mode behält stattdessen seinen Fokus auf
                klassischem Chat + Workspace.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                {HERO_FACTS.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100"
                  >
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-300/80">{card.label}</p>
                    <p className="text-sm leading-relaxed text-slate-200">{card.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-6">
              {view === "home" && <MerlinHome />}
              {view === "planner" && <MerlinPlanner />}
              {view === "dev" && <MerlinDev />}
              {view !== "home" && view !== "planner" && view !== "dev" && (
                <PlaceholderPanel title={NAV_ITEMS.find((entry) => entry.id === view)?.label ?? "Workspace"} />
              )}
            </div>
          </main>

          <aside className="flex min-h-[200px] flex-col gap-4">
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.6)]">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-300/80">Views</h3>
                <span className="text-xs text-slate-400">Active: {NAV_ITEMS.find((item) => item.id === view)?.label}</span>
              </div>
              <div className="mt-4 grid gap-2">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={`w-full rounded-2xl border px-3 py-2 text-left text-sm transition ${
                      view === item.id
                        ? "border-cyan-400/70 bg-cyan-400/10 text-white"
                        : "border-white/10 text-slate-300 hover:border-white/30"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/60 to-slate-950 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.7)]">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-300/70">Signals</p>
              <div className="text-sm text-slate-200">Merlin beobachtet: Dev Sessions, Planner Updates, Calendar Sync.</div>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Arbeitspuls</span>
                  <span className="font-semibold text-white">stable</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Inbox</span>
                  <span className="font-semibold text-white">0 prioritär</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Tasks</span>
                  <span className="font-semibold text-white">Planned</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {mode === "holo" && isHoloChatOpen && (
        <div className="fixed bottom-6 right-6 z-40 w-full max-w-sm">
          <MerlinChatPanel compact onClose={() => setIsHoloChatOpen(false)} />
        </div>
      )}

      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
      {showHelp && <MerlinHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function MerlinHome() {
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">Willkommen bei Merlin</h2>
        <p className="text-sm text-slate-200">
          Merlin ist dein AI-CTO für Fish Delish. Er hilft dir beim Planen, Bauen und Überwachen deines Unternehmens – von
          Code über Marketing bis hin zu Investor-Story.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard title="Planen" description="Definiere Ziele wie 'Investor-Landingpage' oder 'Pitch-Deck-Refresh' und lass Merlin daraus Tasks generieren." />
        <InfoCard title="Bauen" description="Dev Autopilot verbindet sich mit deinem Code und übernimmt Refactors, Tests und Deployments (Spoiler: bald)." />
        <InfoCard title="Wissen" description="Knowledge, Calendar, Mail und Slides geben dir Kontext, damit Merlin immer informiert ist." />
      </div>
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Beispiel-Prompts</p>
        <div className="flex flex-wrap gap-3">
          <PromptChip label='„Merlin, baue mir eine erste Investor-Landingpage für elyra-core.app.“' />
          <PromptChip label='„Merlin, analysiere meinen Kalender der nächsten 2 Wochen und markiere alle kritischen Termine.“' />
          <PromptChip label='„Merlin, plane die nächsten 3 Sprints für den Dev-Autopilot.“' />
          <PromptChip label='„Merlin, fasse die wichtigsten Aufgaben aus meinen letzten 10 E-Mails zusammen.“' />
        </div>
      </div>
    </section>
  );
}

function MerlinPlanner() {
  return (
    <section className="space-y-4 rounded-3xl border border-cyan-500/30 bg-white/5 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.35)]">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">Planner</h2>
        <p className="text-sm text-slate-200">Definiere Ziele und Features. Merlin übersetzt sie später in Tasks und Dev Sessions.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-200">
        <p>Der Planner ist aktuell ein Layout-Entwurf. Bald ergibt sich daraus ein automatisiertes Task-Board.</p>
      </div>
    </section>
  );
}

function MerlinDev() {
  return (
    <section className="space-y-4 rounded-3xl border border-emerald-500/30 bg-white/5 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.35)]">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">Dev Autopilot</h2>
        <p className="text-sm text-slate-200">Merlin verbindet sich mit deinem lokalen Code und startet später Sessions für Dich.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-200">
        <p>Aktuell ist das eine Vorschau ohne Schreibzugriff. In Zukunft kannst du hier Sessions starten, Refactors prüfen und Deploys managen.</p>
      </div>
    </section>
  );
}

function PlaceholderPanel({ title }: { title: string }) {
  const descriptions: Record<string, string> = {
    Knowledge: "Hier bündelt Merlin dein Wissen: Notion-Pages, wichtige Docs, Meeting-Notizen.",
    Calendar: "Merlin analysiert deinen Kalender, erkennt Engpässe und bereitet Meetings vor.",
    Mail: "Hier versteht Merlin deine Kommunikation, fasst E-Mails zusammen und schlägt Antworten vor.",
    Slides: "Merlin unterstützt dich bei Investor-Pitch, Deck-Updates und Storytelling.",
    Tasks: "Zentrale Aufgabenübersicht: verbunden mit Planner, Kalender und Mail.",
  };

  const description = descriptions[title] ?? "Dieser Bereich bleibt ein Layout-Entwurf, bis die Funktionalität live geht.";

  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.35)]">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
        <p className="text-sm text-slate-200">{description}</p>
      </div>
      <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Was du siehst, ist ein stabiler Shell-Prototyp – echte Integrationen folgen.</p>
    </section>
  );
}

type InfoCardProps = {
  title: string;
  description: string;
};

function InfoCard({ title, description }: InfoCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-200 shadow-[0_10px_30px_rgba(2,6,23,0.5)]">
      <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{description}</p>
    </div>
  );
}

function SettingsDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col gap-4 rounded-l-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-sm font-semibold text-slate-200 transition hover:border-white/30"
          >
            Close
          </button>
        </div>
        <div className="space-y-3 text-sm text-slate-200">
          <div>
            <p className="font-semibold text-white">Profile</p>
            <p className="text-slate-400">Name, Avatar, Zeitzone folgen.</p>
          </div>
          <div>
            <p className="font-semibold text-white">Appearance</p>
            <p className="text-slate-400">Background, Glow, Accent-Color, Holo/Classic Mode.</p>
          </div>
          <div>
            <p className="font-semibold text-white">Integrations</p>
            <p className="text-slate-400">Planer, Mail, Kalender, Dev, Slides – Connectors folgen.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MerlinHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl space-y-4 rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-[0_20px_60px_rgba(2,6,23,0.8)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Was macht Merlin?</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-sm font-semibold text-slate-200 transition hover:border-white/30"
          >
            Close
          </button>
        </div>
        <p className="text-sm text-slate-200">
          Merlin ist dein AI-CTO für Fish Delish. Er hilft dir, deine Firma zu führen – mit Fokus auf Planung, Code und
          Kommunikation.
        </p>
        <ul className="space-y-2 text-sm text-slate-200">
          <li>
            <span className="font-semibold text-white">Planner:</span> Definiert Ziele, Epics und Roadmaps, die später zu Tasks
            werden.
          </li>
          <li>
            <span className="font-semibold text-white">Dev:</span> Lokaler Agent für Refactors, Tests, Features und (später)
            Deployments.
          </li>
          <li>
            <span className="font-semibold text-white">Knowledge &amp; Tools:</span> Kalender, Mail, Slides, Tasks – damit Merlin
            deinen Kontext kennt.
          </li>
        </ul>
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
          Aktuell siehst du Layout, Struktur und eine Hypothetical Shell – echte APIs folgen in den nächsten Sprints.
        </p>
      </div>
    </div>
  );
}

function PromptChip({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="text-xs rounded-full border border-white/10 bg-white/10 px-3 py-2 text-left font-semibold text-slate-200 transition hover:border-white/30"
    >
      {label}
    </button>
  );
}
