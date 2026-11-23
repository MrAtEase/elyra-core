"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MonitorCog,
  Palette,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { Workspace } from "@/components/os/kernel/types";
import { SHELL_LAYERS } from "@/components/os/shell/layers";

type SystemOverlayProps = {
  open: boolean;
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  accent: string;
  onClose: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenSettings: () => void;
  onOpenSettingsSection: (section: string) => void;
};

type SettingsItem = {
  id: string;
  label: string;
  detail: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  section: string;
};

const SETTINGS_ITEMS: SettingsItem[] = [
  { id: "profile", label: "Profile & Account", detail: "Identity and account", icon: Settings, section: "profile" },
  { id: "themes", label: "Themes & Appearance", detail: "Color and appearance", icon: Palette, section: "themes-ui" },
  { id: "ai", label: "AI Settings", detail: "Model and memory behavior", icon: Sparkles, section: "model-provider" },
  { id: "os", label: "OS Settings", detail: "Shell and keyboard shortcuts", icon: MonitorCog, section: "keyboard-shortcuts" },
  { id: "workspace-brain", label: "Workspace Brain", detail: "Purpose, goals and Ely instructions", icon: SlidersHorizontal, section: "workspace-brain" },
  { id: "admin", label: "Admin", detail: "Members, permissions, billing", icon: Shield, section: "members-roles" },
];

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim().replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized.split("").map((c) => `${c}${c}`).join("")
      : normalized;
  if (expanded.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function workspaceKindLabel(kind: Workspace["kind"]): string {
  switch (kind) {
    case "individual":
      return "Privat";
    case "organization":
      return "Unternehmen";
    case "platform":
      return "System";
    default:
      return kind;
  }
}

export default function SystemOverlay({
  open,
  workspaces,
  activeWorkspace,
  accent,
  onClose,
  onSelectWorkspace,
  onOpenSettings,
  onOpenSettingsSection,
}: SystemOverlayProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const timeout = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [open]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredWorkspaces = useMemo(
    () =>
      normalizedSearch
        ? workspaces.filter((ws) =>
            `${ws.label} ${workspaceKindLabel(ws.kind)}`.toLowerCase().includes(normalizedSearch),
          )
        : workspaces,
    [workspaces, normalizedSearch],
  );

  const filteredSettings = useMemo(
    () =>
      normalizedSearch
        ? SETTINGS_ITEMS.filter((item) =>
            `${item.label} ${item.detail}`.toLowerCase().includes(normalizedSearch),
          )
        : SETTINGS_ITEMS,
    [normalizedSearch],
  );

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0" style={{ zIndex: SHELL_LAYERS.overlay }}>
          {/* Backdrop */}
          <motion.button
            type="button"
            className="absolute inset-0 border-0 bg-black/48 p-0 backdrop-blur-sm"
            onClick={onClose}
            aria-label="Close orb menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Panel — centered in canvas area, accounts for ElyPanel */}
          <div className="absolute inset-0 lg:right-[360px]">
            <motion.section
              initial={{ opacity: 0, y: 20, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.985 }}
              transition={{ type: "spring", damping: 28, stiffness: 360 }}
              className="absolute left-1/2 top-[86px] w-[min(480px,calc(100%-32px))] -translate-x-1/2 rounded-3xl border border-white/10 bg-[#0d1420]/78 p-4 shadow-[0_34px_92px_rgba(0,0,0,0.46)]"
              style={{ backdropFilter: "blur(24px) saturate(1.15)", WebkitBackdropFilter: "blur(24px) saturate(1.15)" }}
              role="dialog"
              aria-modal="true"
              aria-label="Orb menu"
            >
              {/* Search */}
              <header className="rounded-2xl border border-white/12 bg-white/[0.04] px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <Search size={14} />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search workspaces, settings..."
                    className="h-9 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                  />
                </label>
              </header>

              <div className="mt-4 space-y-4">
                {/* Workspaces */}
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-[0.13em] text-white/50">Workspace</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {filteredWorkspaces.length > 0 ? (
                      filteredWorkspaces.map((ws) => {
                        const selected = ws.id === activeWorkspace.id;
                        return (
                          <button
                            key={ws.id}
                            type="button"
                            onClick={() => {
                              onSelectWorkspace(ws.id);
                              onClose();
                            }}
                            className="rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] transition"
                            style={{
                              borderColor: selected ? withAlpha(accent, 0.4) : "rgba(255,255,255,0.18)",
                              background: selected ? withAlpha(accent, 0.18) : "rgba(255,255,255,0.03)",
                              color: selected ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.74)",
                            }}
                          >
                            {ws.label} · {workspaceKindLabel(ws.kind)}
                          </button>
                        );
                      })
                    ) : (
                      <p className="text-xs text-white/50">No matching workspaces.</p>
                    )}
                  </div>
                </section>

                {/* Settings */}
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.13em] text-white/50">Settings</p>
                    <button
                      type="button"
                      onClick={() => { onOpenSettings(); onClose(); }}
                      className="text-[10px] uppercase tracking-[0.1em] text-white/40 transition hover:text-white/70"
                    >
                      Open all →
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {filteredSettings.length > 0 ? (
                      filteredSettings.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { onOpenSettingsSection(item.section); onClose(); }}
                            className="group rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                          >
                            <span className="inline-flex items-center gap-2 text-sm text-white/85">
                              <Icon size={13} className="text-white/60" />
                              {item.label}
                            </span>
                            <p className="mt-0.5 text-xs text-white/50">{item.detail}</p>
                          </button>
                        );
                      })
                    ) : (
                      <p className="col-span-2 text-xs text-white/50">No matching settings.</p>
                    )}
                  </div>
                </section>
              </div>

              <footer className="mt-3 text-center text-[11px] text-white/38">
                ⌘Space to toggle · Esc to close
              </footer>
            </motion.section>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
