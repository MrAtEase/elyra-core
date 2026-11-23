"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTasks } from "./task-client";
import { sortTasks, type Task } from "./task-model";
export type { Task, TaskStatus } from "./task-model";

const POLL_MS = 30_000;

/** Lädt die Aufgaben eines Workspaces über /api/os/tasks und aktualisiert alle 30 s sowie beim Zurückkehren in den Tab. */
export function useTasks(workspaceId: string | null | undefined) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchId = useRef(0);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const current = ++fetchId.current;
    setIsLoading(true);
    setError(null);
    try {
      const next = await fetchTasks(workspaceId);
      if (fetchId.current === current) setTasks(sortTasks(next));
    } catch (err) {
      if (fetchId.current === current) setError(err instanceof Error ? err.message : "Aufgaben konnten nicht geladen werden");
    } finally {
      if (fetchId.current === current) setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setTasks([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, refresh]);

  const pushTask = useCallback((task: Task) => {
    setTasks((prev) => sortTasks([...prev.filter((item) => item.id !== task.id), task]));
  }, []);

  return { tasks, isLoading, error, refresh, pushTask };
}
