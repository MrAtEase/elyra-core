"use client";

import { useState } from "react";

type Task = {
  id: string;
  title: string;
  done: boolean;
  section: "today" | "upcoming";
};

const INITIAL_TASKS: Task[] = [
  { id: "t1", title: "Review Q3 strategy deck", done: false, section: "today" },
  { id: "t2", title: "Reply to Meridian partnership thread", done: false, section: "today" },
  { id: "t3", title: "Update design tokens in component library", done: false, section: "today" },
  { id: "t4", title: "Prepare sprint demo slides", done: true, section: "today" },
  { id: "t5", title: "Schedule customer discovery calls", done: false, section: "upcoming" },
  { id: "t6", title: "Draft Q4 hiring plan", done: false, section: "upcoming" },
  { id: "t7", title: "Review infrastructure cost report", done: false, section: "upcoming" },
  { id: "t8", title: "Plan team offsite agenda", done: false, section: "upcoming" },
];

export default function TasksApp() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [newTask, setNewTask] = useState("");

  const toggle = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const addTask = () => {
    const trimmed = newTask.trim();
    if (!trimmed) return;
    setTasks((prev) => [
      ...prev,
      { id: `t-${Date.now()}`, title: trimmed, done: false, section: "today" },
    ]);
    setNewTask("");
  };

  const todayTasks = tasks.filter((t) => t.section === "today");
  const upcomingTasks = tasks.filter((t) => t.section === "upcoming");
  const todayDone = todayTasks.filter((t) => t.done).length;

  return (
    <div className="h-full overflow-auto p-5 text-white">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">Tasks</p>
          <h2 className="text-base font-semibold">
            Today <span className="text-sm font-normal text-white/40">{todayDone}/{todayTasks.length}</span>
          </h2>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="Add a task..."
          className="flex-1 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
        />
        <button
          type="button"
          onClick={addTask}
          disabled={!newTask.trim()}
          className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-medium disabled:opacity-30"
        >
          Add
        </button>
      </div>

      <Section label="Today" tasks={todayTasks} onToggle={toggle} />
      <Section label="Upcoming" tasks={upcomingTasks} onToggle={toggle} />
    </div>
  );
}

function Section({
  label,
  tasks,
  onToggle,
}: {
  label: string;
  tasks: Task[];
  onToggle: (id: string) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <div className="mb-5">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">
        {label}
      </p>
      <div className="grid gap-1">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onToggle(task.id)}
            className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:bg-white/[0.04]"
          >
            <div
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                task.done
                  ? "border-emerald-400/50 bg-emerald-400/20 text-emerald-300"
                  : "border-white/20 bg-white/[0.03]"
              }`}
            >
              {task.done ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : null}
            </div>
            <span className={`text-sm ${task.done ? "text-white/35 line-through" : "text-white/85"}`}>
              {task.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
