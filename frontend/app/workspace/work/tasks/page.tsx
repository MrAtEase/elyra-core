"use client";

import { useEffect, useMemo, useState } from "react";

import ModuleHeader from "@/components/workspace/ModuleHeader";
import WorkScopeBadge from "@/components/workspace/WorkScopeBadge";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { fetchAssistantJson } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { CARD_SURFACE, STAGE_GREY_READABLE, STAGE_INNER, STAGE_SHELL } from "@/lib/ui/surfaces";

type TaskStatus = "backlog" | "planned" | "done";

type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority?: "low" | "normal" | "high";
  estimatedDurationMin?: number;
  scheduled?: {
    start?: string | null;
    end?: string | null;
  };
};

type TaskScheduleOption = {
  start: string;
  end: string;
};

type TaskScheduleProposal = {
  type: string;
  status: string;
  payload: {
    taskId: string;
    workspaceId: string;
    durationMin: number;
    options: TaskScheduleOption[];
    reason?: string;
  };
};

const statusColumns: Array<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "planned", label: "Planned" },
  { status: "done", label: "Done" },
];

const buildTasksPath = (workspaceId: string) =>
  `/assistant/workspaces/${encodeURIComponent(workspaceId)}/tasks`;

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
};

const formatRange = (start?: string | null, end?: string | null) => {
  if (!start || !end) {
    return null;
  }
  const formattedStart = formatDate(start);
  const formattedEnd = formatDate(end);
  return formattedStart && formattedEnd ? `${formattedStart} – ${formattedEnd}` : null;
};

export default function TasksPage() {
  const { data } = useWorkspaceData();
  const workspaceId = data?.activeWorkspace?.id ?? null;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isConfirmingSlot, setIsConfirmingSlot] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scheduleProposal, setScheduleProposal] = useState<TaskScheduleProposal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  const filteredTasks = useMemo(() => {
    if (filter === "all") {
      return tasks;
    }
    if (filter === "open") {
      return tasks.filter((task) => task.status !== "done");
    }
    return tasks.filter((task) => task.status === "done");
  }, [tasks, filter]);

  const groupedTasks = useMemo(
    () => ({
      backlog: filteredTasks.filter((task) => task.status === "backlog"),
      planned: filteredTasks.filter((task) => task.status === "planned"),
      done: filteredTasks.filter((task) => task.status === "done"),
    }),
    [filteredTasks]
  );

  useEffect(() => {
    if (!workspaceId) {
      setTasks([]);
      setSelectedTaskId(null);
      setScheduleProposal(null);
      setActionError(null);
      setIsLoadingTasks(false);
      return;
    }
    let isActive = true;
    setIsLoadingTasks(true);
    setActionError(null);
    setScheduleProposal(null);

    (async () => {
      try {
        const payload = await fetchAssistantJson<{ items?: Task[] }>(buildTasksPath(workspaceId));
        if (!isActive) {
          return;
        }
        const items = Array.isArray(payload?.items) ? (payload.items as Task[]) : [];
        setTasks(items);
      } catch (error) {
        if (!isActive) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Unable to load tasks";
        setActionError(message);
      } finally {
        if (isActive) {
          setIsLoadingTasks(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId) {
      setSelectedTaskId(tasks[0]?.id ?? null);
      return;
    }
    const exists = tasks.some((task) => task.id === selectedTaskId);
    if (!exists) {
      setSelectedTaskId(tasks[0]?.id ?? null);
    }
  }, [tasks, selectedTaskId]);

  const handleSelectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setScheduleProposal(null);
    setActionError(null);
  };

  const handleCreateTask = async () => {
    if (!workspaceId) {
      return;
    }
    const trimmedTitle = newTitle.trim();
    if (trimmedTitle.length < 3) {
      setActionError("Title must be at least 3 characters.");
      return;
    }
    setIsCreating(true);
    setActionError(null);
    try {
      const payload = await fetchAssistantJson<{ task?: Task }>(buildTasksPath(workspaceId), {
        method: "POST",
        body: JSON.stringify({ title: trimmedTitle }),
      });
      const created: Task | undefined = payload?.task;
      if (created) {
        setTasks((current) => [created, ...current.filter((task) => task.id !== created.id)]);
        setSelectedTaskId(created.id);
        setNewTitle("");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create task";
      setActionError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleChangeStatus = async (status: TaskStatus) => {
    if (!workspaceId || !selectedTask || selectedTask.status === status) {
      return;
    }
    setIsUpdatingStatus(true);
    setActionError(null);
    try {
      const payload = await fetchAssistantJson<{ task?: Task }>(
        `${buildTasksPath(workspaceId)}/${encodeURIComponent(selectedTask.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }
      );
      const updated: Task | undefined = payload?.task;
      if (updated) {
        setTasks((current) =>
          current.map((task) => (task.id === updated.id ? updated : task))
        );
        setSelectedTaskId(updated.id);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update task";
      setActionError(message);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handlePlanTask = async () => {
    if (!workspaceId || !selectedTask) {
      return;
    }
    setIsScheduling(true);
    setActionError(null);
    setScheduleProposal(null);
    try {
      const payload = await fetchAssistantJson<{ proposal?: TaskScheduleProposal; task?: Task }>(
        `${buildTasksPath(workspaceId)}/${encodeURIComponent(selectedTask.id)}/schedule`,
        {
          method: "POST",
        }
      );
      const proposal: TaskScheduleProposal | null = payload?.proposal ?? null;
      const updated: Task | undefined = payload?.task;
      if (updated) {
        setTasks((current) =>
          current.map((task) => (task.id === updated.id ? updated : task))
        );
        setSelectedTaskId(updated.id);
      }
      setScheduleProposal(proposal);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load slots";
      setActionError(message);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleConfirmSlot = async (option: TaskScheduleOption) => {
    if (!workspaceId || !selectedTask) {
      return;
    }
    setIsConfirmingSlot(true);
    setActionError(null);
    try {
      const payload = await fetchAssistantJson<{ task?: Task }>(
        `${buildTasksPath(workspaceId)}/${encodeURIComponent(selectedTask.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "planned",
            scheduled: {
              start: option.start,
              end: option.end,
            },
          }),
        }
      );
      const updated: Task | undefined = payload?.task;
      if (updated) {
        setTasks((current) =>
          current.map((task) => (task.id === updated.id ? updated : task))
        );
        setSelectedTaskId(updated.id);
      }
      setScheduleProposal(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to confirm slot";
      setActionError(message);
    } finally {
      setIsConfirmingSlot(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!workspaceId || !selectedTask || selectedTask.status !== "done") {
      return;
    }
    if (!confirm("Task wirklich löschen?")) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    const taskId = selectedTask.id;
    try {
      await fetchAssistantJson(
        `${buildTasksPath(workspaceId)}/${encodeURIComponent(taskId)}`,
        {
          method: "DELETE",
        }
      );
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setSelectedTaskId(null);
      setScheduleProposal(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to delete task";
      setActionError(message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!workspaceId) {
    return (
      <section className="workspace-main-panel">
        <ModuleHeader
          moduleLabel="Tasks"
          subtitle="Select an active workspace to manage your tasks."
          rightSlot={<WorkScopeBadge />}
        />
        <div
          className="workspace-main-panel__status-card"
          style={{ marginTop: "24px" }}
        >
          <p>No workspace selected. Pick one from the workspace menu to continue.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-main-panel">
      <ModuleHeader
        moduleLabel="Tasks"
        subtitle="Tasks are scoped to the current workspace and stored inside the assistant worker for local development."
        rightSlot={<WorkScopeBadge />}
      />

      <div className="relative mt-4">
        <div className={cn(STAGE_SHELL, "h-full min-h-[640px]")}>
          <div className={cn(STAGE_INNER, "h-full overflow-hidden")}>
            <div className={cn(STAGE_GREY_READABLE, "h-full overflow-hidden flex flex-col gap-5 p-5")}>
              {actionError && (
                <div className={cn(CARD_SURFACE, "p-4 text-sm text-destructive")}>
                  <p>{actionError}</p>
                </div>
              )}
              <div className={cn(CARD_SURFACE, "p-5 flex flex-col gap-3")}>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                    Neue Task
                  </label>
                  <div className="flex flex-col gap-3 md:flex-row">
                    <input
                      id="new-task-title"
                      type="text"
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !isCreating) {
                          handleCreateTask();
                        }
                      }}
                      placeholder="Neue Task…"
                      disabled={isCreating}
                      className="flex-1 rounded-xl border border-border bg-white/80 px-4 py-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    />
                    <button
                      type="button"
                      onClick={handleCreateTask}
                      disabled={isCreating || newTitle.trim().length < 3}
                    className={cn(
                      "rounded-xl px-4 py-3 text-sm font-semibold uppercase tracking-[0.35em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      isCreating || newTitle.trim().length < 3
                        ? "border border-border bg-white/80 text-slate-400 cursor-not-allowed"
                        : "border border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                    >
                      {isCreating ? "Hinzufügen…" : "Task hinzufügen"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {(["all", "open", "done"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.4em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      filter === f
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-white/80 text-slate-500 hover:border-primary/60 hover:bg-white/60"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-4 md:grid-cols-3">
                  {statusColumns.map((column) => {
                    const items = groupedTasks[column.status];
                    return (
                      <div
                        key={column.status}
                        className={cn(CARD_SURFACE, "flex h-full flex-col gap-3 p-4")}
                      >
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span>{column.label}</span>
                          <span className="text-xs text-slate-500">{items.length}</span>
                        </div>
                        <div className="flex flex-col gap-2 overflow-y-auto">
                          {items.map((task) => {
                            const isSelected = task.id === selectedTaskId;
                            return (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => handleSelectTask(task.id)}
                                className={cn(
                                  "w-full text-left rounded-2xl border px-3 py-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                  isSelected
                                    ? "border-primary/80 bg-primary/10"
                                    : "border-transparent hover:border-slate-200/70 hover:bg-slate-50/70"
                                )}
                              >
                                <div className="font-semibold text-slate-900">{task.title}</div>
                                {task.scheduled?.start &&
                                  task.scheduled?.end && (
                                    <p className="mt-1 text-xs text-slate-500">
                                      {formatRange(task.scheduled.start, task.scheduled.end)}
                                    </p>
                                  )}
                              </button>
                            );
                          })}
                          {items.length === 0 && (
                            <p className="text-xs text-slate-500">Keine Aufgaben</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className={cn(CARD_SURFACE, "flex flex-col gap-4 p-5")}>
                  {selectedTask ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Details</p>
                          <h2 className="mt-1 text-lg font-semibold text-slate-900">{selectedTask.title}</h2>
                        </div>
                        <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-[0.35em] text-slate-500">
                          {selectedTask.status}
                        </span>
                      </div>
                      {selectedTask.description && (
                        <p className="text-sm text-slate-700">{selectedTask.description}</p>
                      )}
                      {selectedTask.scheduled?.start &&
                        selectedTask.scheduled?.end && (
                          <p className="text-xs text-slate-500">
                            Geplant: {formatRange(selectedTask.scheduled.start, selectedTask.scheduled.end)}
                          </p>
                        )}
                      <div className="flex flex-wrap gap-3">
                        {statusColumns.map((column) => (
                          <button
                            key={column.status}
                            type="button"
                            onClick={() => handleChangeStatus(column.status)}
                            disabled={isUpdatingStatus || selectedTask.status === column.status}
                            className={cn(
                              "rounded-full border px-4 py-2 text-[0.6rem] font-semibold uppercase tracking-[0.4em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                              selectedTask.status === column.status
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-white/80 text-slate-500 hover:border-primary/60 hover:bg-white/70"
                            )}
                          >
                            {column.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-col gap-3">
                        <button
                          type="button"
                          onClick={handlePlanTask}
                          disabled={isScheduling}
                        className={cn(
                          "w-full rounded-xl px-4 py-3 text-sm font-semibold uppercase tracking-[0.35em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                          isScheduling
                            ? "border border-border bg-white/80 text-slate-400 cursor-not-allowed"
                            : "border border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                        )}
                        >
                          {isScheduling ? "Lade Vorschläge…" : "Planen"}
                        </button>
                        {selectedTask.status === "done" && (
                          <button
                            type="button"
                            onClick={handleDeleteTask}
                            disabled={isDeleting}
                            className={cn(
                              "w-full rounded-xl border px-4 py-3 text-sm font-semibold uppercase tracking-[0.35em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                              isDeleting
                                ? "border border-border bg-white/80 text-slate-400 cursor-not-allowed"
                                : "border border-destructive text-destructive hover:bg-destructive/10"
                            )}
                          >
                            {isDeleting ? "Lösche…" : "Löschen"}
                          </button>
                        )}
                      </div>
                      {scheduleProposal?.payload?.reason && (
                        <p className="text-xs text-slate-500">
                          {scheduleProposal.payload.reason}
                        </p>
                      )}
                      {scheduleProposal && scheduleProposal.payload.options.length > 0 && (
                        <div className="flex flex-col gap-3">
                          {scheduleProposal.payload.options.map((option, index) => (
                            <div
                              key={`${option.start}-${option.end}-${index}`}
                            className="rounded-xl border border-border bg-white/80 p-3"
                            >
                              <p className="mb-2 text-sm font-semibold text-slate-900">
                                {formatRange(option.start, option.end) ?? "Slot auswählen"}
                              </p>
                              <button
                                type="button"
                                onClick={() => handleConfirmSlot(option)}
                                disabled={isConfirmingSlot}
                              className={cn(
                                "w-full rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.35em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                                isConfirmingSlot
                                  ? "border border-border bg-white/80 text-slate-400 cursor-not-allowed"
                                  : "border border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                              )}
                              >
                                {isConfirmingSlot
                                  ? "Bestätige Slot…"
                                  : `Slot ${index + 1} bestätigen`}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p>Wähle eine Task aus, um Details zu sehen.</p>
                  )}
                </div>
              </div>
              {isLoadingTasks && (
                <div className={cn(CARD_SURFACE, "p-4")}>
                  <p>Lade Tasks…</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
