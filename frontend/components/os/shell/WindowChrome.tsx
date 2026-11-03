"use client";

import { useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { WindowRecord } from "@/components/os/kernel/types";
import { SHELL_LAYERS } from "@/components/os/shell/layers";

type WindowChromeProps = {
  window: WindowRecord;
  focused: boolean;
  accent: string;
  onFocus: (windowId: string) => void;
  onClose: (windowId: string) => void;
  onMinimize: (windowId: string) => void;
  onToggleMaximize: (windowId: string) => void;
  onMove: (windowId: string, x: number, y: number) => void;
  onResize: (windowId: string, width: number, height: number) => void;
  children: ReactNode;
};

function layeredWindowZIndex(win: WindowRecord): number {
  if (win.maximized) return SHELL_LAYERS.maximizedWindow;
  return Math.min(SHELL_LAYERS.floatingWindowMax, Math.max(SHELL_LAYERS.floatingWindowMin, win.zIndex));
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim().replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;

  if (expanded.length !== 6) return `rgba(255, 255, 255, ${alpha})`;

  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return `rgba(255, 255, 255, ${alpha})`;

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export default function WindowChrome({
  window: win,
  focused,
  accent,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onMove,
  onResize,
  children,
}: WindowChromeProps) {
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const resizeStateRef = useRef<{ width: number; height: number; startX: number; startY: number } | null>(null);
  const desktopBottomReserve = 168;
  const constrainedHeight =
    typeof window === "undefined"
      ? win.height
      : Math.min(win.height, Math.max(220, window.innerHeight - win.y - desktopBottomReserve));

  const onHeaderPointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (win.minimized || win.maximized) return;

    const target = event.target as HTMLElement;
    if (target.closest('[data-window-control="true"]')) {
      return;
    }

    onFocus(win.id);
    dragOffsetRef.current = {
      x: event.clientX - win.x,
      y: event.clientY - win.y,
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const offset = dragOffsetRef.current;
      if (!offset) return;
      onMove(win.id, moveEvent.clientX - offset.x, moveEvent.clientY - offset.y);
    };

    const handleUp = () => {
      dragOffsetRef.current = null;
      globalThis.window.removeEventListener("pointermove", handleMove);
      globalThis.window.removeEventListener("pointerup", handleUp);
    };

    globalThis.window.addEventListener("pointermove", handleMove);
    globalThis.window.addEventListener("pointerup", handleUp);
  };

  const onResizePointerDown: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    if (win.minimized || win.maximized) return;
    event.preventDefault();

    onFocus(win.id);
    resizeStateRef.current = {
      width: win.width,
      height: win.height,
      startX: event.clientX,
      startY: event.clientY,
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      onResize(
        win.id,
        state.width + (moveEvent.clientX - state.startX),
        state.height + (moveEvent.clientY - state.startY)
      );
    };

    const handleUp = () => {
      resizeStateRef.current = null;
      globalThis.window.removeEventListener("pointermove", handleMove);
      globalThis.window.removeEventListener("pointerup", handleUp);
    };

    globalThis.window.addEventListener("pointermove", handleMove);
    globalThis.window.addEventListener("pointerup", handleUp);
  };

  return (
    <motion.section
      layout={false}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: "easeOut" } }}
      whileHover={win.maximized ? { y: 0 } : { y: -1 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className={
        win.maximized
          ? "max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[124px] max-sm:top-[106px] sm:absolute sm:inset-0"
          : "max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[124px] max-sm:top-[106px] sm:absolute"
      }
      style={
        win.maximized
          ? { zIndex: layeredWindowZIndex(win) }
          : {
              left: win.x,
              top: win.y,
              width: win.width,
              height: constrainedHeight,
              zIndex: layeredWindowZIndex(win),
            }
      }
      onMouseDown={() => onFocus(win.id)}
      role="dialog"
      aria-label={win.title}
    >
      <div
        className={`flex h-full flex-col overflow-hidden border backdrop-blur-xl transition duration-300 ease-out ${
          win.maximized ? "rounded-xl" : "rounded-2xl"
        }`}
        style={{
          borderColor: focused
            ? "var(--os-border-strong)"
            : "var(--os-border-faint)",
          borderTop: focused ? `1px solid ${withAlpha(accent, 0.27)}` : undefined,
          background: focused
            ? "var(--os-surface-window)"
            : "var(--os-surface-window-muted)",
          boxShadow: focused
            ? `var(--os-window-shadow-focused), 0 -1px 12px ${withAlpha(accent, 0.09)}`
            : "var(--os-window-shadow-unfocused)",
          opacity: focused ? 1 : 0.9,
          transition: "border-color 500ms ease, border-top-color 500ms ease, box-shadow 500ms ease",
        }}
      >
        <header
          className={`relative flex h-11 items-center border-b border-white/10 px-4 ${
            win.maximized ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          }`}
          onPointerDown={onHeaderPointerDown}
          onDoubleClick={() => onToggleMaximize(win.id)}
        >
          <div className="z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onClose(win.id)}
              data-window-control="true"
              className="h-3.5 w-3.5 rounded-full border border-black/20 bg-[#ff5f57] transition hover:brightness-110"
              aria-label="Close"
            />
            <button
              type="button"
              onClick={() => onMinimize(win.id)}
              data-window-control="true"
              className="h-3.5 w-3.5 rounded-full border border-black/20 bg-[#febc2e] transition hover:brightness-110"
              aria-label="Minimize"
            />
            <button
              type="button"
              onClick={() => onToggleMaximize(win.id)}
              data-window-control="true"
              className="h-3.5 w-3.5 rounded-full border border-black/20 bg-[#28c840] transition hover:brightness-110"
              aria-label={win.maximized ? "Restore" : "Maximize"}
            />
          </div>

          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-medium text-white/76">
            {win.title}
          </p>
        </header>

        <div className="min-h-0 flex-1">{children}</div>

        {!win.maximized ? (
          <button
            type="button"
            data-window-control="true"
            onPointerDown={onResizePointerDown}
            aria-label="Resize window"
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-gradient-to-br from-transparent to-white/30"
          />
        ) : null}
      </div>
    </motion.section>
  );
}
