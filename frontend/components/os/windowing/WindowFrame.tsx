"use client";

import { Minus, Square, X } from "lucide-react";
import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { WindowInstance } from "@/components/os/windowing/windowTypes";
import { useWindows } from "@/components/os/windowing/useWindows";

type WindowFrameProps = {
  window: WindowInstance;
  children: ReactNode;
};

export default function WindowFrame({ window, children }: WindowFrameProps) {
  const win = window;
  const { closeWindow, minimizeWindow, toggleMaximizeWindow, focusWindow, moveWindow, resizeWindow, appearance } = useWindows();
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ baseW: number; baseH: number; startX: number; startY: number } | null>(null);

  const compact = appearance.density === "compact";

  const startDragging = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (win.maximized) return;
    dragRef.current = {
      offsetX: event.clientX - win.rect.x,
      offsetY: event.clientY - win.rect.y,
    };

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return;
      moveWindow(win.id, {
        x: moveEvent.clientX - dragRef.current.offsetX,
        y: moveEvent.clientY - dragRef.current.offsetY,
      });
    };

    const onUp = () => {
      dragRef.current = null;
      globalThis.window.removeEventListener("mousemove", onMove);
      globalThis.window.removeEventListener("mouseup", onUp);
    };

    globalThis.window.addEventListener("mousemove", onMove);
    globalThis.window.addEventListener("mouseup", onUp);
  };

  const startResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (win.maximized) return;
    event.stopPropagation();
    resizeRef.current = {
      baseW: win.rect.width,
      baseH: win.rect.height,
      startX: event.clientX,
      startY: event.clientY,
    };

    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      resizeWindow(win.id, {
        width: resizeRef.current.baseW + (moveEvent.clientX - resizeRef.current.startX),
        height: resizeRef.current.baseH + (moveEvent.clientY - resizeRef.current.startY),
      });
    };

    const onUp = () => {
      resizeRef.current = null;
      globalThis.window.removeEventListener("mousemove", onMove);
      globalThis.window.removeEventListener("mouseup", onUp);
    };

    globalThis.window.addEventListener("mousemove", onMove);
    globalThis.window.addEventListener("mouseup", onUp);
  };

  return (
    <article
      role="dialog"
      aria-label={win.title}
      onMouseDown={() => focusWindow(win.id)}
      className="fixed overflow-hidden rounded-2xl border border-white/15 bg-[#0d1018]/95 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      style={{
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.width,
        height: win.rect.height,
        zIndex: 100 + win.z,
      }}
    >
      <div
        className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3"
        style={{ height: compact ? 34 : 40, cursor: win.maximized ? "default" : "grab" }}
        onMouseDown={startDragging}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeWindow(win.id);
            }}
            aria-label="Close window"
            className="grid h-5 w-5 place-items-center rounded-full bg-[#ff6159]/90 text-black/70"
          >
            <X size={10} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              minimizeWindow(win.id);
            }}
            aria-label="Minimize window"
            className="grid h-5 w-5 place-items-center rounded-full bg-[#ffc23f]/90 text-black/70"
          >
            <Minus size={10} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleMaximizeWindow(win.id);
            }}
            aria-label="Maximize window"
            className="grid h-5 w-5 place-items-center rounded-full bg-[#35d072]/90 text-black/70"
          >
            <Square size={10} />
          </button>
        </div>
        <p className="text-xs font-medium tracking-wide text-white/75">{win.title}</p>
        <div style={{ width: 64 }} aria-hidden="true" />
      </div>
      <div className="h-[calc(100%-40px)] overflow-auto bg-[#0b0e15]/90">{children}</div>
      <button
        type="button"
        aria-label="Resize window"
        onMouseDown={startResize}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-gradient-to-br from-transparent to-white/30"
      />
    </article>
  );
}
