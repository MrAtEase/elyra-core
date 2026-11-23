"use client";

import { Minus, X } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import type { OSWindow } from "@/lib/os/layoutTypes";

type WindowFrameProps = {
  item: OSWindow;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  children: ReactNode;
};

export default function WindowFrame({
  item,
  onFocus,
  onClose,
  onMinimize,
  onMove,
  onResize,
  children,
}: WindowFrameProps) {
  const dragStateRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resizeStateRef = useRef<{ pointerId: number; startX: number; startY: number; startW: number; startH: number } | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus(item.id);

    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - item.x,
      offsetY: event.clientY - item.y,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || moveEvent.pointerId !== state.pointerId) return;
      onMove(item.id, moveEvent.clientX - state.offsetX, moveEvent.clientY - state.offsetY);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || upEvent.pointerId !== state.pointerId) return;
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus(item.id);

    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startW: item.w,
      startH: item.h,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state || moveEvent.pointerId !== state.pointerId) return;
      onResize(
        item.id,
        state.startW + (moveEvent.clientX - state.startX),
        state.startH + (moveEvent.clientY - state.startY)
      );
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state || upEvent.pointerId !== state.pointerId) return;
      resizeStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <section
      role="dialog"
      aria-label={item.title}
      className="fixed overflow-hidden rounded-xl border border-white/20 bg-[#0a0f18]/92 text-white shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-md"
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: 20 + item.z }}
      onMouseDown={() => onFocus(item.id)}
    >
      <div
        className="flex h-10 cursor-grab items-center justify-between border-b border-white/10 bg-white/5 px-3"
        onPointerDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose(item.id);
            }}
            className="grid h-5 w-5 place-items-center rounded-full bg-[#ff5f57] text-black/70"
            aria-label="Close"
          >
            <X size={10} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onMinimize(item.id);
            }}
            className="grid h-5 w-5 place-items-center rounded-full bg-[#febc2e] text-black/70"
            aria-label="Minimize"
          >
            <Minus size={10} />
          </button>
        </div>
        <p className="text-xs font-medium tracking-wide text-white/85">{item.title}</p>
        <div className="w-10" aria-hidden="true" />
      </div>
      <div className="h-[calc(100%-2.5rem)] overflow-auto">{children}</div>
      <button
        type="button"
        onPointerDown={startResize}
        aria-label="Resize window"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize bg-gradient-to-br from-transparent to-white/30"
      />
    </section>
  );
}
