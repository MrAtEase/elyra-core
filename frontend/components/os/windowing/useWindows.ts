"use client";

import { useContext } from "react";
import { WindowManagerContext } from "@/components/os/windowing/WindowManagerProvider";

export function useWindows() {
  const context = useContext(WindowManagerContext);
  if (!context) {
    throw new Error("useWindows must be used inside WindowManagerProvider");
  }
  return context;
}
