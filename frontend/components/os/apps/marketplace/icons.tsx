"use client";

import type { ComponentType } from "react";
import {
  AppWindow, BarChart3, FileText, GitMerge, Languages, Newspaper, Radar, ScanSearch, ShoppingBag,
  Sparkles, Store, Target, Users, Wand2, Workflow
} from "lucide-react";
import { PERSONAL_ICONS_BY_NAME } from "@/components/os/personal/personalWindows";

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
  ...PERSONAL_ICONS_BY_NAME,
  "file-text": FileText,
  sparkles: Sparkles,
  store: Store,
  wand: Wand2,
};

export function LauncherIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Icon = MARKETPLACE_ICONS[name] ?? AppWindow;
  return <Icon size={size} {...(className ? { className } : {})} />;
}
