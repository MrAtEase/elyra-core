"use client";

import { Maximize2, Minimize2, Minus, X } from "lucide-react";

/**
 * Einheitliche Fenster-Steuerung für ALLE App-Fenster (schwebende Fenster und Vollbild-Apps):
 * Titel links, Steuerung rechts in fester Reihenfolge – Minimieren, (Maximieren), Schließen.
 */

type WindowControlsProps = {
  label: string;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  maximized?: boolean;
  onClose?: () => void;
};

const BUTTON =
  "flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--bg-surface-hover)] hover:text-[color:var(--text-primary)]";

export function WindowControls({ label, onMinimize, onToggleMaximize, maximized = false, onClose }: WindowControlsProps) {
  return (
    <div className="flex items-center gap-1" data-window-control="true">
      {onMinimize ? (
        <button type="button" onClick={onMinimize} data-window-control="true" aria-label={`${label} minimieren`} title="Minimieren" className={BUTTON}>
          <Minus size={14} />
        </button>
      ) : null}
      {onToggleMaximize ? (
        <button type="button" onClick={onToggleMaximize} data-window-control="true" aria-label={maximized ? `${label} verkleinern` : `${label} maximieren`} title={maximized ? "Verkleinern" : "Maximieren"} className={BUTTON}>
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      ) : null}
      {onClose ? (
        <button type="button" onClick={onClose} data-window-control="true" aria-label={`${label} schließen`} title="Schließen" className={`${BUTTON} hover:!text-red-500`}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** Einheitlicher Fenstertitel (links in der Kopfzeile). */
export function WindowTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="truncate text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--text-secondary)]">
      {children}
    </span>
  );
}
