"use client";

import { useState } from "react";

type MailThread = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  body: string;
};

const MOCK_THREADS: MailThread[] = [
  {
    id: "t1",
    from: "Sarah Chen",
    subject: "Q3 Strategy Deck — Final Review",
    snippet: "Hi, attached is the updated deck with the revisions we discussed...",
    date: "10:42 AM",
    unread: true,
    body: "Hi,\n\nAttached is the updated deck with the revisions we discussed in yesterday's session. The financial projections on slides 8-12 now reflect the conservative scenario.\n\nPlease review and confirm by EOD so we can lock this for the board meeting.\n\nBest,\nSarah",
  },
  {
    id: "t2",
    from: "DevOps Bot",
    subject: "Deploy #482 — Production (success)",
    snippet: "Build completed successfully. All 147 tests passed...",
    date: "9:15 AM",
    unread: true,
    body: "Deploy #482 completed successfully.\n\nBranch: main\nCommit: a3f82c1\nTests: 147/147 passed\nCoverage: 91.2%\nDuration: 3m 42s\n\nAll services healthy. No rollback required.",
  },
  {
    id: "t3",
    from: "Marcus Liu",
    subject: "Re: Partnership proposal — Meridian",
    snippet: "Thanks for the intro. I've reviewed their terms and have a few...",
    date: "Yesterday",
    unread: false,
    body: "Thanks for the intro. I've reviewed their terms and have a few concerns about the exclusivity clause in section 4.2.\n\nCan we schedule a 30-min call tomorrow to align before responding?\n\nMarcus",
  },
  {
    id: "t4",
    from: "Ava Patel",
    subject: "Design system tokens — updated",
    snippet: "The new color primitives are live in Figma. Spacing scale...",
    date: "Yesterday",
    unread: false,
    body: "The new color primitives are live in Figma. Spacing scale has been rationalized to 4px increments.\n\nKey changes:\n- Neutral palette simplified from 12 to 8 steps\n- Semantic tokens for surface, border, and text\n- Motion tokens for duration and easing\n\nLet me know if anything feels off before I publish to the component library.",
  },
  {
    id: "t5",
    from: "Billing",
    subject: "Invoice #1094 — Payment received",
    snippet: "Your payment of $2,400.00 has been processed...",
    date: "Feb 12",
    unread: false,
    body: "Your payment of $2,400.00 for Invoice #1094 has been processed successfully.\n\nTransaction ID: TXN-8827364\nDate: Feb 12, 2026\nMethod: ACH Transfer\n\nThank you for your business.",
  },
];

export default function MailApp() {
  const [selectedId, setSelectedId] = useState<string>("t1");
  const selected = MOCK_THREADS.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="grid h-full grid-cols-[260px_minmax(0,1fr)] text-white">
      <section className="border-r border-white/10 p-3 overflow-auto">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
          Inbox
        </p>
        <div className="grid gap-1">
          {MOCK_THREADS.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setSelectedId(thread.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                selectedId === thread.id
                  ? "border-white/20 bg-white/[0.08]"
                  : "border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`truncate text-[13px] ${thread.unread ? "font-semibold" : "font-normal text-white/80"}`}>
                  {thread.from}
                </p>
                <span className="shrink-0 text-[10px] text-white/40">{thread.date}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-white/65">{thread.subject}</p>
              <p className="mt-0.5 truncate text-[11px] text-white/35">{thread.snippet}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="p-5 overflow-auto">
        {selected ? (
          <>
            <div className="mb-4">
              <h2 className="text-base font-semibold">{selected.subject}</h2>
              <p className="mt-1 text-xs text-white/50">
                From: {selected.from} &middot; {selected.date}
              </p>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">
              {selected.body}
            </div>
          </>
        ) : (
          <p className="text-sm text-white/50">Select a thread to read.</p>
        )}
      </section>
    </div>
  );
}
