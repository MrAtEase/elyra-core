"use client";

import { useEffect } from "react";

type KeyboardShortcutsOptions = {
  onTogglePalette: () => void;
  onClosePalette: () => void;
};

export function useKeyboardShortcuts({ onTogglePalette, onClosePalette }: KeyboardShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMetaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isMetaK) {
        event.preventDefault();
        onTogglePalette();
        return;
      }

      if (event.key === "Escape") {
        onClosePalette();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClosePalette, onTogglePalette]);
}
