"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { ensureSupabaseToken, supabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeTask, sortTasks, type Task, type TaskRecord } from "./task-model";
export type { Task, TaskStatus } from "./task-model";

const isTaskRecordShape = (value: unknown): value is TaskRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as TaskRecord).id === "string" &&
  typeof (value as TaskRecord).title === "string" &&
  typeof (value as TaskRecord).status === "string";

const isTaskRecordArray = (value: unknown): value is TaskRecord[] =>
  Array.isArray(value) && value.every(isTaskRecordShape);

type SupabaseErrorLike = {
  message?: string;
  code?: string;
};

function normalizeTaskError(error: unknown): { message: string; code: string | null } {
  if (error instanceof Error) {
    return { message: error.message, code: null };
  }
  if (error && typeof error === "object") {
    const maybe = error as SupabaseErrorLike;
    return {
      message: typeof maybe.message === "string" && maybe.message ? maybe.message : "Unable to load workspace tasks",
      code: typeof maybe.code === "string" ? maybe.code : null,
    };
  }
  return { message: "Unable to load workspace tasks", code: null };
}

export function useTasks(workspaceId: string | null | undefined) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchId = useRef(0);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    const currentFetchId = ++fetchId.current;
    setIsLoading(true);
    setError(null);
    try {
      await ensureSupabaseToken();

      const { data, error: queryError } = await supabaseBrowserClient
        .from("tasks")
        .select(
          [
            "id",
            "title",
            "status",
            "priority",
            "due_at",
            "assigned_to",
            "workspace_id",
            "created_by",
            "created_at",
            "updated_at",
          ].join(",")
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false, nullsFirst: false });

      if (queryError) {
        if (
          queryError.code === "42P01" ||
          queryError.message.toLowerCase().includes("relation") && queryError.message.toLowerCase().includes("tasks")
        ) {
          setTasks([]);
          setError(null);
          return;
        }
        throw queryError;
      }

      if (fetchId.current !== currentFetchId) {
        return;
      }

      const records = data ?? [];
      if (!isTaskRecordArray(records)) {
        throw new Error("Unable to load workspace tasks");
      }

      setTasks(sortTasks(records.map(normalizeTask)));
    } catch (err) {
      if (fetchId.current !== currentFetchId) {
        return;
      }
      const normalized = normalizeTaskError(err);
      const recoverableAuth =
        normalized.code === "401" ||
        normalized.code === "403" ||
        normalized.message.toLowerCase().includes("jwt") ||
        normalized.message.toLowerCase().includes("auth");
      if (!recoverableAuth) {
        console.warn("[useTasks] refresh fallback", normalized);
      }
      const message = normalized.message;
      setError(message);
    } finally {
      if (fetchId.current === currentFetchId) {
        setIsLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setTasks([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    refresh();
  }, [workspaceId, refresh]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    let isActive = true;
    let channel: RealtimeChannel | null = null;

    const subscribe = async () => {
      try {
        await ensureSupabaseToken();
        if (!isActive) {
          return;
        }
        channel = supabaseBrowserClient
          .channel(`workspace-tasks-${workspaceId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "tasks",
              filter: `workspace_id=eq.${workspaceId}`,
            },
            (payload: RealtimePostgresChangesPayload<TaskRecord>) => {
              const applyRecord = (record: TaskRecord | null, type: string) => {
                if (!record || record.workspace_id !== workspaceId) {
                  return;
                }
                if (type === "DELETE") {
                  setTasks((prev) => prev.filter((task) => task.id !== record.id));
                  return;
                }
                setTasks((prev) =>
                  sortTasks([...prev.filter((task) => task.id !== record.id), normalizeTask(record)])
                );
              };

              if (payload.eventType === "DELETE") {
                applyRecord(payload.old as TaskRecord, "DELETE");
                return;
              }
              applyRecord(payload.new as TaskRecord, payload.eventType);
            }
          )
          .subscribe();
      } catch (err) {
        console.error("[useTasks] realtime subscription failed", err);
      }
    };

    void subscribe();

    return () => {
      isActive = false;
      channel?.unsubscribe();
    };
  }, [workspaceId]);

  const pushTask = useCallback((task: Task) => {
    setTasks((prev) => sortTasks([...prev.filter((item) => item.id !== task.id), task]));
  }, []);

  return {
    tasks,
    isLoading,
    error,
    refresh,
    pushTask,
  };
}
