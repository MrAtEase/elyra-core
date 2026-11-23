"use client";

import { useState } from "react";

type Deck = {
  id: string;
  title: string;
  slides: number;
  updated: string;
  color: string;
};

const MOCK_DECKS: Deck[] = [
  { id: "d1", title: "Q3 Strategy Review", slides: 24, updated: "Feb 14", color: "rgba(56, 189, 248, 0.15)" },
  { id: "d2", title: "Product Roadmap 2026", slides: 18, updated: "Feb 12", color: "rgba(168, 85, 247, 0.15)" },
  { id: "d3", title: "Investor Update", slides: 12, updated: "Feb 10", color: "rgba(34, 197, 94, 0.12)" },
  { id: "d4", title: "Brand Guidelines", slides: 32, updated: "Feb 8", color: "rgba(251, 146, 60, 0.12)" },
  { id: "d5", title: "Team Onboarding", slides: 15, updated: "Jan 28", color: "rgba(236, 72, 153, 0.12)" },
  { id: "d6", title: "Sprint Demo — Week 7", slides: 8, updated: "Jan 25", color: "rgba(96, 165, 250, 0.12)" },
];

const SLIDE_TITLES = [
  "Title Slide",
  "Agenda",
  "Executive Summary",
  "Market Overview",
  "Key Metrics",
  "Financial Projections",
  "Growth Strategy",
  "Team Structure",
  "Timeline",
  "Q&A",
];

export default function SlidesApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = MOCK_DECKS.find((d) => d.id === selectedId) ?? null;

  if (selected) {
    return (
      <div className="h-full overflow-auto text-white">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="text-xs text-white/50 hover:text-white/80"
          >
            &larr; Back
          </button>
          <h2 className="text-sm font-semibold">{selected.title}</h2>
          <span className="text-xs text-white/35">{selected.slides} slides</span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          {Array.from({ length: Math.min(selected.slides, 10) }, (_, i) => (
            <div
              key={i}
              className="aspect-[16/10] rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-col justify-between"
            >
              <p className="text-[11px] font-medium text-white/60">
                {SLIDE_TITLES[i] ?? `Slide ${i + 1}`}
              </p>
              <div className="mt-2 space-y-1.5">
                <div className="h-1.5 w-3/4 rounded bg-white/8" />
                <div className="h-1.5 w-1/2 rounded bg-white/6" />
                <div className="h-1.5 w-2/3 rounded bg-white/5" />
              </div>
              <p className="mt-auto pt-2 text-[9px] text-white/25">{i + 1}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-5 text-white">
      <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
        Decks
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {MOCK_DECKS.map((deck) => (
          <button
            key={deck.id}
            type="button"
            onClick={() => setSelectedId(deck.id)}
            className="rounded-xl border border-white/10 p-4 text-left transition-colors hover:bg-white/[0.04]"
            style={{ background: deck.color }}
          >
            <p className="text-sm font-semibold">{deck.title}</p>
            <p className="mt-1 text-[11px] text-white/45">
              {deck.slides} slides &middot; {deck.updated}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
