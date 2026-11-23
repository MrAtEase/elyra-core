"use client";

import type { ComponentType } from "react";
import {
  AppWindow, BarChart3, FileText, GitMerge, Guitar, Languages, Newspaper, Radar, ScanSearch, ShoppingBag, Spade,
  Sparkles, Store, Target, Users, Wand2, Workflow,
} from "lucide-react";

/** Icons for marketplace items (catalog `icon` keys). */
export const MARKETPLACE_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  radar: Radar,
  "git-merge": GitMerge,
  "shopping-bag": ShoppingBag,
  newspaper: Newspaper,
  workflow: Workflow,
  "scan-search": ScanSearch,
  chart: BarChart3,
  users: Users,
  target: Target,
  languages: Languages,
  guitar: Guitar,
  spade: Spade,
  "file-text": FileText,
  sparkles: Sparkles,
  store: Store,
  wand: Wand2,
};

export function LauncherIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Icon = MARKETPLACE_ICONS[name] ?? AppWindow;
  return <Icon size={size} {...(className ? { className } : {})} />;
}
