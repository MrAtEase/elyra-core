"use client";

import { type ReactNode } from "react";
import { type WindowInstance } from "@/components/os/wm/windowTypes";

type WindowFrameProps = {
  window: WindowInstance;
  focused: boolean;
  children: ReactNode;
  onFocus: (windowId: string) => void;
  onClose: (windowId: string) => void;
  onMinimize: (windowId: string) => void;
  onToggleMaximize: (windowId: string) => void;
};

export default function WindowFrame({
  window,
  focused,
  children,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
}: WindowFrameProps) {
  const desktopStyle = window.isMaximized
    ? { top: 0, left: 0, width: "100%", height: "100%" }
    : {
        top: window.position.y,
        left: window.position.x,
        width: window.size.width,
        height: window.size.height,
      };

  return (
    <section
      className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[168px] max-sm:top-14 sm:absolute"
      style={{ zIndex: window.zIndex, ...desktopStyle }}
      onMouseDown={() => onFocus(window.id)}
    >
      <div
        className={`flex h-full flex-col overflow-hidden border backdrop-blur-xl transition-shadow duration-300 ${
          focused
            ? "border-white/20 bg-[var(--os-panel)] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            : "border-white/10 bg-[var(--os-panel)] shadow-[0_12px_35px_rgba(0,0,0,0.3)]"
        } rounded-none max-sm:rounded-t-2xl sm:rounded-2xl`}
      >
        {/* Title bar */}
        <header className="flex h-10 items-center justify-between border-b border-white/8 px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onClose(window.id)}
              className="h-2.5 w-2.5 rounded-full bg-white/20 transition hover:bg-red-400/80"
              aria-label="Close window"
            />
            <button
              type="button"
              onClick={() => onMinimize(window.id)}
              className="h-2.5 w-2.5 rounded-full bg-white/20 transition hover:bg-amber-300/80"
              aria-label="Minimize window"
            />
            <button
              type="button"
              onClick={() => onToggleMaximize(window.id)}
              className="hidden h-2.5 w-2.5 rounded-full bg-white/20 transition hover:bg-emerald-300/80 sm:block"
              aria-label="Maximize window"
            />
          </div>
          <p className="text-[11px] font-medium tracking-wide text-white/60">{window.title}</p>
          <div className="w-10" />
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </section>
  );
}
