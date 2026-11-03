"use client";

import ShellDock from "@/components/os/shell/Dock";
import type { AppId, AppManifest } from "@/components/os/kernel/types";
import type { OSWindow, WindowType } from "@/lib/os/layoutTypes";

type DockProps = {
  windows: OSWindow[];
  apps?: WindowType[];
  onOpen: (type: WindowType) => void;
  onRestore: (id: string) => void;
};

const DOCK_APP_BY_WINDOW: Record<WindowType, AppManifest> = {
  runs: { id: "runs", name: "Runs", icon: "◈", category: "build", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  approvals: { id: "approvals", name: "Approvals", icon: "✓", category: "build", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  files: { id: "files", name: "Files", icon: "▣", category: "work", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  admin: { id: "settings_admin", name: "Admin", icon: "◫", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
  settings: { id: "settings_os", name: "Settings", icon: "⚙", category: "settings", availableIn: ["individual", "organization", "platform"], openAs: "window" },
};

export default function Dock({ windows, apps, onOpen, onRestore }: DockProps) {
  const minimized = windows.filter((item) => item.minimized);
  const dockApps = (apps && apps.length > 0 ? apps : (Object.keys(DOCK_APP_BY_WINDOW) as WindowType[]))
    .map((type) => DOCK_APP_BY_WINDOW[type]);
  const activeAppIds = windows
    .filter((item) => !item.minimized)
    .map((item) => DOCK_APP_BY_WINDOW[item.type]?.id)
    .filter((value): value is AppId => Boolean(value));

  return (
    <>
      <ShellDock
        apps={dockApps}
        activeAppIds={activeAppIds}
        accent="var(--os-accent, #6c9cfc)"
        onOpenApp={(appId) => {
          const entry = (Object.entries(DOCK_APP_BY_WINDOW) as Array<[WindowType, AppManifest]>)
            .find(([, value]) => value.id === appId);
          if (entry) onOpen(entry[0]);
        }}
      />
      {minimized.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[164px] z-[111] px-4 sm:px-6">
          <div className="pointer-events-auto mx-auto flex w-fit max-w-full items-center gap-2 overflow-x-auto rounded-[9999px] border border-[color:var(--border-subtle,#ffffff22)] bg-[color:var(--glass-bg,rgba(10,19,35,0.85))] px-3 py-2 shadow-[0_16px_40px_rgba(5,8,18,0.34)] backdrop-blur-xl">
            {minimized.map((window) => (
              <button
                key={window.id}
                type="button"
                onClick={() => onRestore(window.id)}
                className="truncate rounded-[9999px] border border-[color:var(--border-subtle,#ffffff22)] bg-[color:var(--bg-surface-soft,rgba(255,255,255,0.05))] px-3 py-1.5 text-xs text-[color:var(--text-secondary,#fff)] transition hover:text-[color:var(--text-primary,#fff)]"
                title={window.title}
              >
                {window.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
