import { Suspense } from "react";
import TasksWindow from "@/components/os/apps/tasks/TasksWindow";

export default function OsTasksPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Loading Tasks…</div>}>
      <TasksWindow windowId="tasks-route" />
    </Suspense>
  );
}
