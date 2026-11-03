"use client";

import { useState } from "react";
import AdminApp from "@/components/apps/AdminApp";
import ApprovalsApp from "@/components/apps/ApprovalsApp";
import FilesApp from "@/components/apps/FilesApp";
import RunsApp from "@/components/apps/RunsApp";
import SettingsApp from "@/components/apps/SettingsApp";
import { createCommandPalette } from "@/components/os/commandPalette";
import Dock from "@/components/os/Dock";
import Orb from "@/components/os/Orb";
import WindowFrame from "@/components/os/WindowFrame";
import WindowManager from "@/components/os/WindowManager";
import type { OSWindow } from "@/lib/os/layoutTypes";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { resolveWorkspaceRuntime } from "@/lib/workspace/runtime";

type DesktopCanvasProps = {
  workspaceSlug: string;
  workspaceId?: string;
};

function renderApp(window: OSWindow, runsFocusSignal: number) {
  if (window.type === "runs") return <RunsApp focusSignal={runsFocusSignal} />;
  if (window.type === "approvals") return <ApprovalsApp />;
  if (window.type === "files") return <FilesApp />;
  if (window.type === "admin") return <AdminApp />;
  if (window.type === "settings") return <SettingsApp />;
  return null;
}

export default function DesktopCanvas({ workspaceSlug }: DesktopCanvasProps) {
  const [runsFocusSignal, setRunsFocusSignal] = useState(0);
  const { data } = useWorkspaceData();
  const activeWorkspace = data?.activeWorkspace ?? null;
  const runtime = resolveWorkspaceRuntime({
    workspaceType: activeWorkspace?.type ?? null,
    membershipRole: data?.membership?.role ?? null,
    capabilities: data?.capabilities ?? [],
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#02050c] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_15%,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_80%_8%,rgba(59,130,246,0.2),transparent_30%),linear-gradient(180deg,#030712_0%,#071224_100%)]" />

      <WindowManager
        workspaceSlug={workspaceSlug}
        workspaceId={activeWorkspace?.id ?? null}
        allowedWindowTypes={runtime.dockApps}
      >
        {({ windows, open, close, minimize, restore, focus, move, resize }) => {
          const commands = createCommandPalette({
            openWindow: open,
            newRun: () => {
              open("runs");
              setRunsFocusSignal((prev) => prev + 1);
            },
          });

          return (
            <>
              <header className="fixed left-5 right-5 top-5 z-[80] flex items-center justify-between rounded-xl border border-white/20 bg-[#0a1323]/85 px-4 py-2 backdrop-blur-md">
                <p className="text-xs uppercase tracking-[0.18em] text-white/70">
                  Workspace OS
                </p>
                <p className="text-sm text-white/85">/{workspaceSlug}</p>
              </header>

              {windows
                .filter((item) => !item.minimized)
                .sort((a, b) => a.z - b.z)
                .map((item) => (
                  <WindowFrame
                    key={item.id}
                    item={item}
                    onFocus={focus}
                    onClose={close}
                    onMinimize={minimize}
                    onMove={move}
                    onResize={resize}
                  >
                    {renderApp(item, runsFocusSignal)}
                  </WindowFrame>
                ))}

              <Dock
                windows={windows}
                apps={runtime.dockApps}
                onOpen={open}
                onRestore={restore}
              />
              <Orb commands={commands} />
            </>
          );
        }}
      </WindowManager>
    </div>
  );
}
