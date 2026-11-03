"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  FolderKanban,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchGoogleStatus, type GoogleStatusResponse } from "@/components/os/apps/liveGoogleClient";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { useTasks, type Task } from "@/components/workspace/tasks/useTasks";
import { createTask, updateTask } from "@/components/workspace/tasks/task-client";

type TaskPriority = "low" | "medium" | "high" | "urgent";

type TaskViewModel = {
  id: string;
  title: string;
  done: boolean;
  priority: TaskPriority;
  dueAt: string | null;
  updatedAt: string;
  section: "today" | "upcoming" | "backlog" | "done";
  project: string;
};

type TasksAppProps = {
  onDetailOpenChange?: (open: boolean) => void;
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "text-[color:var(--text-tertiary)]",
  medium: "text-blue-400",
  high: "text-orange-400",
  urgent: "text-red-400",
};

const LOCAL_SEED: TaskViewModel[] = [
  {
    id: "local-1",
    title: "Finalize onboarding flow copy for workspace welcome",
    done: false,
    priority: "high",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 5).toISOString(),
    updatedAt: new Date().toISOString(),
    section: "today",
    project: "Design",
  },
  {
    id: "local-2",
    title: "Review launch checklist with engineering handoff",
    done: false,
    priority: "urgent",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 20).toISOString(),
    updatedAt: new Date().toISOString(),
    section: "today",
    project: "Engineering",
  },
  {
    id: "local-3",
    title: "Prepare Q2 hiring roadmap presentation",
    done: false,
    priority: "medium",
    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    updatedAt: new Date().toISOString(),
    section: "upcoming",
    project: "Team",
  },
  {
    id: "local-4",
    title: "Archive completed marketing sprint tasks",
    done: true,
    priority: "low",
    dueAt: null,
    updatedAt: new Date().toISOString(),
    section: "done",
    project: "Work",
  },
];

function mapPriority(value: number | null | undefined): TaskPriority {
  if (value == null) return "medium";
  if (value <= 1) return "low";
  if (value === 2) return "medium";
  if (value === 3) return "high";
  return "urgent";
}

function mapTask(task: Task): TaskViewModel {
  const now = Date.now();
  const due = task.dueAt ? Date.parse(task.dueAt) : NaN;
  const isDone = task.status === "done";
  const section: TaskViewModel["section"] = isDone
    ? "done"
    : Number.isFinite(due) && due < now + 24 * 60 * 60 * 1000
    ? "today"
    : Number.isFinite(due)
    ? "upcoming"
    : "backlog";

  return {
    id: task.id,
    title: task.title,
    done: isDone,
    priority: mapPriority(task.priority),
    dueAt: task.dueAt,
    updatedAt: task.updatedAt ?? task.createdAt,
    section,
    project: task.assignedTo ? "Team" : "Work",
  };
}

function priorityToNumeric(priority: TaskPriority): number {
  if (priority === "low") return 1;
  if (priority === "medium") return 2;
  if (priority === "high") return 3;
  return 4;
}

function formatDate(value: string | null): string {
  if (!value) return "No due date";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export default function TasksApp({ onDetailOpenChange }: TasksAppProps) {
  const { activeWorkspace } = useKernel();
  const [status, setStatus] = useState<GoogleStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState("");
  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState<"all" | "today" | "upcoming" | "done">("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<TaskViewModel[]>(LOCAL_SEED);
  const [saving, setSaving] = useState(false);
  const detailOpenRef = useRef<boolean | null>(null);

  const workspaceId = status?.workspace.id ?? null;
  const userId = status?.user.id ?? null;
  const usingRemote = Boolean(workspaceId);

  const {
    tasks: remoteTasks,
    isLoading: remoteLoading,
    error: remoteError,
    refresh: refreshRemote,
  } = useTasks(workspaceId);

  const mappedRemoteTasks = useMemo(
    () => remoteTasks.map(mapTask),
    [remoteTasks]
  );

  const tasks = usingRemote ? mappedRemoteTasks : localTasks;

  useEffect(() => {
    let cancelled = false;
    void fetchGoogleStatus(activeWorkspace.id)
      .then((payload) => {
        if (cancelled) return;
        setStatus(payload);
        setStatusError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatusError(normalizeError(error, "Unable to resolve workspace."));
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.id]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  useEffect(() => {
    const isOpen = Boolean(selectedTask);
    if (detailOpenRef.current === isOpen) return;
    detailOpenRef.current = isOpen;
    onDetailOpenChange?.(isOpen);
  }, [onDetailOpenChange, selectedTask]);

  const filteredTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (activeView !== "all" && task.section !== activeView) return false;
      if (!normalizedSearch) return true;
      return `${task.title} ${task.project} ${task.priority}`
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [activeView, search, tasks]);

  const counts = useMemo(() => {
    return {
      all: tasks.length,
      today: tasks.filter((task) => task.section === "today").length,
      upcoming: tasks.filter((task) => task.section === "upcoming").length,
      done: tasks.filter((task) => task.section === "done").length,
    };
  }, [tasks]);

  const addTask = useCallback(async () => {
    const title = quickAdd.trim();
    if (!title) return;
    setSaving(true);
    setActionError(null);
    try {
      if (usingRemote && workspaceId) {
        await createTask(workspaceId, userId, {
          title,
          status: "open",
          priority: 2,
        });
        await refreshRemote();
      } else {
        setLocalTasks((current) => [
          {
            id: `local-${Date.now()}`,
            title,
            done: false,
            priority: "medium",
            dueAt: null,
            updatedAt: new Date().toISOString(),
            section: "backlog",
            project: "Work",
          },
          ...current,
        ]);
      }
      setQuickAdd("");
    } catch (error) {
      setActionError(normalizeError(error, "Unable to add task."));
    } finally {
      setSaving(false);
    }
  }, [quickAdd, refreshRemote, userId, usingRemote, workspaceId]);

  const toggleTask = useCallback(
    async (task: TaskViewModel) => {
      setActionError(null);
      if (usingRemote && workspaceId) {
        try {
          await updateTask(workspaceId, task.id, {
            status: task.done ? "open" : "done",
          });
          await refreshRemote();
        } catch (error) {
          setActionError(normalizeError(error, "Unable to update task."));
        }
        return;
      }

      setLocalTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id
            ? {
                ...candidate,
                done: !candidate.done,
                section: candidate.done ? "backlog" : "done",
                updatedAt: new Date().toISOString(),
              }
            : candidate
        )
      );
    },
    [refreshRemote, usingRemote, workspaceId]
  );

  const setPriority = useCallback(
    async (task: TaskViewModel, priority: TaskPriority) => {
      if (usingRemote && workspaceId) {
        try {
          await updateTask(workspaceId, task.id, {
            priority: priorityToNumeric(priority),
          });
          await refreshRemote();
        } catch (error) {
          setActionError(normalizeError(error, "Unable to update task priority."));
        }
        return;
      }
      setLocalTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id
            ? { ...candidate, priority, updatedAt: new Date().toISOString() }
            : candidate
        )
      );
    },
    [refreshRemote, usingRemote, workspaceId]
  );

  const isLoading = usingRemote && remoteLoading;
  const loadError = usingRemote ? remoteError : statusError;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="grid h-full grid-cols-[256px_minmax(0,1fr)]">
        <aside className="flex h-full flex-col border-r border-white/10 bg-[rgba(255,255,255,0.02)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">Views</p>
          <div className="mt-3 space-y-1.5">
            {[
              { id: "all", label: "All Tasks", count: counts.all },
              { id: "today", label: "Today", count: counts.today },
              { id: "upcoming", label: "Upcoming", count: counts.upcoming },
              { id: "done", label: "Completed", count: counts.done },
            ].map((view) => {
              const isActive = activeView === view.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setActiveView(view.id as typeof activeView)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-sm transition",
                    isActive
                      ? "border-white/20 bg-white/[0.08] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]"
                  )}
                >
                  <span>{view.label}</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/65">
                    {view.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-white/35">Projects</p>
            <div className="mt-2 space-y-1.5 text-sm text-white/70">
              <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <FolderKanban size={14} />
                Work
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <Sparkles size={14} />
                Design
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <CalendarClock size={14} />
                Engineering
              </div>
            </div>
          </div>
        </aside>

        <section className="relative flex h-full min-h-0">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search tasks..."
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-white/85 outline-none placeholder:text-white/40 focus:border-violet-400/35"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void refreshRemote()}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/75 transition hover:bg-white/[0.06]"
                >
                  Refresh
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  value={quickAdd}
                  onChange={(event) => setQuickAdd(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addTask();
                    }
                  }}
                  placeholder="Quick add a task..."
                  className="h-10 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white/85 outline-none placeholder:text-white/40 focus:border-violet-400/35"
                />
                <button
                  type="button"
                  onClick={() => void addTask()}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-300/35 bg-violet-500/25 px-3 py-2 text-sm font-medium text-violet-50 transition hover:bg-violet-500/35 disabled:opacity-60"
                >
                  <Plus size={15} />
                  Add
                </button>
              </div>
            </header>

            <ul className="min-h-0 flex-1 overflow-y-auto">
              {isLoading ? (
                <li className="px-5 py-6 text-sm text-white/55">Loading tasks...</li>
              ) : null}
              {!isLoading && filteredTasks.length === 0 ? (
                <li className="px-5 py-6 text-sm text-white/55">
                  No tasks found for this view.
                </li>
              ) : null}
              {filteredTasks.map((task) => {
                const selected = selectedTaskId === task.id;
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                      className={cn(
                        "flex w-full items-start justify-between border-b border-white/10 px-5 py-3 text-left transition",
                        selected ? "bg-white/[0.06]" : "hover:bg-white/[0.05]"
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className="mt-0.5 text-white/70"
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleTask(task);
                          }}
                        >
                          {task.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </span>
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "truncate text-sm",
                              task.done
                                ? "text-white/45 line-through"
                                : "text-white/88"
                            )}
                          >
                            {task.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-white/45">
                            <span>{task.project}</span>
                            <span>•</span>
                            <span>{formatDate(task.dueAt)}</span>
                          </div>
                        </div>
                      </div>
                      <span className={cn("text-xs font-semibold uppercase", PRIORITY_CLASS[task.priority])}>
                        {task.priority}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <AnimatePresence>
            {selectedTask ? (
              <motion.aside
                initial={{ x: 26, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 26, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute bottom-0 right-0 top-0 z-20 w-[384px] border-l border-white/10 bg-[#111624]/95 p-5 backdrop-blur-xl"
              >
                <div className="flex items-start justify-between">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/45">Task Detail</p>
                  <button
                    type="button"
                    onClick={() => setSelectedTaskId(null)}
                    className="rounded-md border border-white/10 p-1.5 text-white/70 transition hover:bg-white/[0.06]"
                  >
                    <X size={15} />
                  </button>
                </div>

                <h3 className="mt-3 text-xl text-white/95">{selectedTask.title}</h3>
                <p className="mt-2 text-sm text-white/60">Due: {formatDate(selectedTask.dueAt)}</p>

                <div className="mt-5 space-y-3">
                  <button
                    type="button"
                    onClick={() => void toggleTask(selectedTask)}
                    className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/[0.08]"
                  >
                    {selectedTask.done ? "Mark as open" : "Mark as complete"}
                  </button>

                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-white/40">Priority</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(["low", "medium", "high", "urgent"] as const).map((priority) => (
                        <button
                          key={priority}
                          type="button"
                          onClick={() => void setPriority(selectedTask, priority)}
                          className={cn(
                            "rounded-lg border px-2.5 py-2 text-xs font-semibold uppercase transition",
                            selectedTask.priority === priority
                              ? "border-white/25 bg-white/[0.08] text-white"
                              : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]",
                            PRIORITY_CLASS[priority]
                          )}
                        >
                          {priority}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.aside>
            ) : null}
          </AnimatePresence>
        </section>
      </div>

      {loadError ? (
        <div className="absolute bottom-4 left-4 rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-100">
          {loadError}
        </div>
      ) : null}
      {actionError ? (
        <div className="absolute bottom-4 right-4 rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-100">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
