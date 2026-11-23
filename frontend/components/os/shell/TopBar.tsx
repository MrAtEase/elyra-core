"use client";

import { useEffect, useState } from "react";

function formatTime(value: Date) {
  return value.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TopBar() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000 * 20);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-[88] flex h-12 items-center justify-between border-b border-white/8 bg-[var(--os-panel-strong)] px-4 backdrop-blur-2xl sm:left-[72px] sm:px-6">
      <div className="text-xs font-medium tracking-[0.14em] text-white/70">elyra core</div>
      <div className="flex items-center gap-3 text-xs text-white/55">
        <span className="tabular-nums">{formatTime(now)}</span>
      </div>
    </header>
  );
}
