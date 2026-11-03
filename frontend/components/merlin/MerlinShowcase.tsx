"use client";

import { useEffect, useState } from "react";
import MerlinChatPanel from "./MerlinChatPanel";
import Orb from "./Orb";
import { OrbStatus } from "./orbConfig";
import { useOrbDemoState } from "./useOrbDemoState";

type UIMode = "classic" | "holo";
type Mood = "calm" | "focus" | "thinking";

const NAV_ITEMS = [
  "Home",
  "Planner",
  "Dev",
  "Knowledge",
  "Calendar",
  "Mail",
  "Slides",
  "Tasks",
];

const STATUS_OPTIONS: Array<{ id: OrbStatus; label: string; detail: string }> = [
  { id: "calm", label: "Calm", detail: "Soft cobalt glow for grounding." },
  { id: "focus", label: "Focus", detail: "Crisp cyan fiber with steady intensity." },
  { id: "thinking", label: "Thinking", detail: "Lavender layers spinning through context." },
  { id: "warning", label: "Warning", detail: "Amber pulse, extra attention on hold." },
  { id: "error", label: "Error", detail: "Red alert flicker, diagnostic lights up." },
  { id: "offline", label: "Offline", detail: "Quartz haze, gentle standby presence." },
];

const MOOD_OPTIONS: Array<{ id: Mood; label: string; detail: string }> = [
  { id: "calm", label: "Calm Tide", detail: "Evening impressions, slow orbit." },
  { id: "focus", label: "Hyper Focus", detail: "Morning sprint, laser clarity." },
  { id: "thinking", label: "Reflective", detail: "Context building, multiverse pulse." },
];

const HIGHLIGHT_CARDS = [
  {
    title: "Project Pulse",
    description: "Holistic overview of every safe, design and engineering thread.",
    accent: "from-sky-500/70 to-indigo-500/70",
  },
  {
    title: "Velocity Board",
    description: "Predictive estimates and blockers that are purely illustrative.",
    accent: "from-emerald-400/60 to-cyan-500/60",
  },
  {
    title: "Knowledge Hub",
    description: "Stub modules surface reusable ideas and thoughtful context.",
    accent: "from-fuchsia-500/70 to-rose-500/60",
  },
];

const deriveMoodFromHour = (hour: number): Mood => {
  if (hour >= 19 || hour < 6) {
    return "calm";
  }
  if (hour >= 6 && hour < 10) {
    return "focus";
  }
  return "thinking";
};

export default function MerlinShowcase() {
  const [mode, setMode] = useState<UIMode>("classic");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mood, setMood] = useState<Mood>("calm");
  const { orbState, setOrbStatus, autoDemo, toggleAutoDemo, notifyUserActivity } = useOrbDemoState({
    active: mounted,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const stored = window.localStorage.getItem("merlin.uiMode");
    if (stored === "classic" || stored === "holo") {
      setMode(stored);
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem("merlin.uiMode", mode);
  }, [mode, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    setMood(deriveMoodFromHour(new Date().getHours()));
  }, [mounted]);

  const handleModeChange = (nextMode: UIMode) => {
    setMode(nextMode);
    if (nextMode === "classic") {
      setDrawerOpen(false);
    }
  };

  const statusOption = STATUS_OPTIONS.find((option) => option.id === orbState.status);
  const moodMeta = MOOD_OPTIONS.find((option) => option.id === mood) ?? MOOD_OPTIONS[0]!;
  const isTimerActive = orbState.status === "thinking" || orbState.status === "warning";
  const statusLabel = orbState.label ?? "System ready for your next move.";
  const statusTitle = `Status · ${orbState.status.charAt(0).toUpperCase() + orbState.status.slice(1)}`;
  const autoLabel = autoDemo ? "Auto demo is cycling" : "Manual status control";
  const heroSize = mode === "holo" ? "hero" : "mini";

  const handleStatusButton = (nextStatus: OrbStatus) => {
    setOrbStatus(nextStatus, `${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)} mode`);
  };

  return (
    <div className="mock-shell">
      <div className="mock-card">
        <header className="mock-card__header">
          <div>
            <p className="mock-card__eyebrow">Workspace preview</p>
            <h1 className="mock-card__title">/workspace/mock — Orb Status Suite</h1>
            <p className="mock-card__subtitle">
              Design-first Showcase mit Classic &amp; Holo Layouts, Mood-Toggles und einem lebendigen Status-Orb.
            </p>
          </div>
          <div className="mock-toolbar">
            <div className="toolbar-group">
              <p className="toolbar-label">Interface</p>
              <div className="mode-toggle">
                {(["classic", "holo"] as UIMode[]).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => handleModeChange(candidate)}
                    className={`mode-toggle__button ${mode === candidate ? "is-active" : ""}`}
                  >
                    {candidate === "classic" ? "Classic" : "Holo"}
                  </button>
                ))}
              </div>
            </div>

            <div className="toolbar-group">
              <p className="toolbar-label">Orb Status</p>
              <div className="status-toggle">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleStatusButton(option.id)}
                    className={`status-toggle__button ${orbState.status === option.id ? "is-active" : ""}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="toolbar-group">
              <p className="toolbar-label">Mood</p>
              <div className="mood-toggle">
                {MOOD_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMood(option.id)}
                    className={`mood-toggle__button ${mood === option.id ? "is-active" : ""}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={toggleAutoDemo}
              className={`auto-demo-toggle ${autoDemo ? "is-active" : ""}`}
            >
              {autoDemo ? "Auto demo ON" : "Auto demo OFF"}
            </button>
          </div>
        </header>

        <div className={`mock-grid ${mode === "classic" ? "mock-grid--classic" : "mock-grid--holo"}`}>
          <aside className="mock-nav">
            <p className="mock-nav__title">Navigation</p>
            <nav className="mock-nav__list">
              {NAV_ITEMS.map((item) => (
                <span key={item} className="mock-nav__item">
                  {item}
                </span>
              ))}
            </nav>
            <div className="mock-nav__foot">
              <span>Mock status · {statusOption?.label ?? "Calm"}</span>
              <span>Mood · {moodMeta.label}</span>
            </div>
          </aside>

          <section className={`mock-canvas ${mode === "holo" ? "mock-canvas--holo" : ""}`}>
            <div className={`mock-orb-wrapper ${mode === "holo" ? "mock-orb-wrapper--holo" : ""}`}>
              <Orb
                mode={mode}
                status={orbState.status}
                intensity={orbState.intensity}
                size={heroSize}
                progress={isTimerActive ? orbState.ringProgress : 0}
              />
              <div className="mock-orb-meta">
                <p className="mock-orb-meta__status">{statusTitle}</p>
                <p className="mock-orb-meta__detail">{statusOption?.detail}</p>
                <p className="mock-orb-meta__mood">
                  Mood · {moodMeta.label} <span className="mock-orb-meta__help-text">{moodMeta.detail}</span>
                </p>
                <p className="mock-orb-meta__auto">{autoLabel}</p>
              </div>
            </div>

            <div className="mock-description">
              <p>{statusLabel}</p>
              <div className="mock-description__chips">
                <span>{isTimerActive ? "Health timer running" : "Pulse stable"}</span>
                <span>{mode === "classic" ? "Chat persistent" : "Chat drawer"}</span>
              </div>
            </div>

            <div className="mock-highlights">
              {HIGHLIGHT_CARDS.map((card) => (
                <article key={card.title} className="mock-highlights__card">
                  <p className="mock-highlights__title">{card.title}</p>
                  <p className="mock-highlights__body">{card.description}</p>
                  <span className={`mock-highlights__accent bg-gradient-to-r ${card.accent}`} />
                </article>
              ))}
            </div>
          </section>

          {mode === "classic" && (
            <aside className="mock-chat-col">
              <MerlinChatPanel className="mock-chat-col__panel h-full" onUserActivity={notifyUserActivity} />
            </aside>
          )}
        </div>
      </div>

      {mode === "holo" && (
        <>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="mock-floating-chat-button"
          >
            Chat öffnen
          </button>
          {drawerOpen && (
            <div className="mock-drawer-backdrop">
              <div className="mock-drawer" role="dialog" aria-modal="true">
                <MerlinChatPanel
                  compact
                  className="h-full"
                  onClose={() => setDrawerOpen(false)}
                  onUserActivity={notifyUserActivity}
                />
              </div>
              <button
                type="button"
                className="mock-drawer-backdrop__layer"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close chat drawer"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
