"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PaletteCommand } from "@/components/os/commandPalette";
import { useKeyboardShortcuts } from "@/lib/os/useKeyboardShortcuts";

type OrbProps = {
  commands: PaletteCommand[];
};

export default function Orb({ commands }: OrbProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useKeyboardShortcuts({
    onTogglePalette: () => setOpen((prev) => !prev),
    onClosePalette: () => setOpen(false),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => {
      if (command.label.toLowerCase().includes(q)) return true;
      return command.keywords.some((keyword) => keyword.toLowerCase().includes(q));
    });
  }, [commands, query]);

  const executeFirst = () => {
    const first = filtered[0];
    if (!first) return;
    first.run();
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open Orb command palette"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-6 left-6 z-[90] grid h-12 w-12 place-items-center rounded-full border border-cyan-200/40 bg-[#071020]/88 shadow-[0_0_28px_rgba(56,189,248,0.35)]"
      >
        <span className="h-6 w-6 rounded-full bg-gradient-to-br from-cyan-300 via-sky-400 to-indigo-500" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[95] bg-black/35" onClick={() => setOpen(false)}>
          <div
            className="mx-auto mt-24 w-[min(640px,92vw)] rounded-2xl border border-white/20 bg-[#0a1424]/96 p-4 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3">
              <Search size={16} className="text-white/70" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    executeFirst();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder="Type a command"
                className="h-11 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
              />
            </div>
            <div className="max-h-80 space-y-2 overflow-auto">
              {filtered.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => {
                    command.run();
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-left text-sm hover:bg-white/[0.09]"
                >
                  {command.label}
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70">No matching commands.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
