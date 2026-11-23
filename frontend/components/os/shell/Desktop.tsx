"use client";

import { useWindows } from "@/components/os/windowing/useWindows";
import WindowFrame from "@/components/os/windowing/WindowFrame";
import dynamic from "next/dynamic";
import type { AppId } from "@/components/os/windowing/windowTypes";

const MailApp = dynamic(() => import("@/components/os/apps/standalone/MailApp"), { ssr: false });
const CalendarApp = dynamic(() => import("@/components/os/apps/standalone/CalendarApp"), { ssr: false });
const TasksApp = dynamic(() => import("@/components/os/apps/standalone/TasksApp"), { ssr: false });
const FilesApp = dynamic(() => import("@/components/os/apps/standalone/FilesApp"), { ssr: false });
const SlidesApp = dynamic(() => import("@/components/os/apps/standalone/SlidesApp"), { ssr: false });

function renderStandaloneApp(appId: AppId) {
  switch (appId) {
    case "mail":
      return <MailApp />;
    case "calendar":
      return <CalendarApp />;
    case "tasks":
      return <TasksApp />;
    case "files":
      return <FilesApp />;
    case "slides":
      return <SlidesApp />;
    default:
      return (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-sm text-white/40">App coming soon.</p>
        </div>
      );
  }
}

export default function Desktop() {
  const { windows } = useWindows();

  const visible = windows
    .filter((w) => !w.minimized)
    .sort((a, b) => a.z - b.z);

  return (
    <div className="fixed inset-0 top-9 z-[100]">
      {visible.map((win) => (
        <WindowFrame key={win.id} window={win}>
          {renderStandaloneApp(win.appId)}
        </WindowFrame>
      ))}
    </div>
  );
}
