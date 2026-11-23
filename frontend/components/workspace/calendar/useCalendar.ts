"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { ensureSupabaseToken, supabaseBrowserClient } from "@/lib/supabase/browser";
import type { TaskRecord } from "@/components/workspace/tasks/task-model";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

const DEBUG_CALENDAR = false;
// Polling deaktiviert: Supabase-Realtime hält die Tasks aktuell.
// Ein Interval würde alle 30 s unnötig Supabase belasten.

const timestampFrom = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareCalendarItems = (a: CalendarItem, b: CalendarItem) => {
  const aStamp = timestampFrom(a.start);
  const bStamp = timestampFrom(b.start);
  if (aStamp === bStamp) {
    return a.id.localeCompare(b.id);
  }
  return aStamp - bStamp;
};

const sortCalendarItems = (items: CalendarItem[]) => [...items].sort(compareCalendarItems);

type CalendarEventItem = {
  kind: "event";
  id: string;
  title: string;
  start: string;
  end: string;
  workspaceId: string | null;
  source: string;
  isEditable: boolean;
  isOptimistic: boolean;
};

type CalendarTaskItem = {
  kind: "task";
  id: string;
  title: string;
  start: string;
  end?: string;
  workspaceId: string;
};

export type CalendarItem = CalendarEventItem | CalendarTaskItem;

type CalendarRealtimePayload = {
  table: "calendar_events" | "tasks";
  event: "INSERT" | "UPDATE" | "DELETE";
  newRecord?: TaskRecord;
  oldRecord?: TaskRecord;
};

type CalendarRealtimeBridge = {
  publish: (payload: CalendarRealtimePayload) => void;
  subscribe: (listener: (payload: CalendarRealtimePayload) => void) => () => void;
};

declare global {
  interface Window {
    __fdCalendarRealtimeBridge?: CalendarRealtimeBridge;
  }
}

const getCalendarRealtimeBridge = (): CalendarRealtimeBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }
  if (!window.__fdCalendarRealtimeBridge) {
    const subscribers = new Set<(payload: CalendarRealtimePayload) => void>();
    window.__fdCalendarRealtimeBridge = {
      publish(payload) {
        subscribers.forEach((listener) => listener(payload));
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
    };
  }
  return window.__fdCalendarRealtimeBridge ?? null;
};

const normalizeTask = (record: TaskRecord): CalendarTaskItem | null => {
  if (!record.due_at) {
    return null;
  }
  return {
    kind: "task",
    id: record.id,
    title: record.title,
    start: record.due_at,
    workspaceId: record.workspace_id,
  };
};

function isTaskRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const dueAtValid = record.due_at === null || typeof record.due_at === "string";
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.status === "string" &&
    typeof record.workspace_id === "string" &&
    dueAtValid
  );
}

export function useCalendar(workspaceId: string | null | undefined) {
  const { calendarEvents, calendarLoading, calendarError, calendarStatus } = useWorkspaceData();
  const [taskItems, setTaskItems] = useState<CalendarTaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const fetchId = useRef(0);

  const applyTaskRecord = useCallback(
    (record: TaskRecord | null, eventType: string) => {
      if (!record || record.workspace_id !== workspaceId) {
        return;
      }
      setTaskItems((prev) => {
        const filtered = prev.filter((item) => !(item.kind === "task" && item.id === record.id));
        if (eventType === "DELETE") {
          return filtered;
        }
        if (!record.due_at) {
          return filtered;
        }
        const normalized = normalizeTask(record);
        if (!normalized) {
          return filtered;
        }
        return sortCalendarItems([...filtered, normalized]) as CalendarTaskItem[];
      });
    },
    [workspaceId]
  );

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setTaskItems([]);
      setTasksError(null);
      setTasksLoading(false);
      return;
    }
    const currentFetchId = ++fetchId.current;
    setTasksLoading(true);
    setTasksError(null);
    try {
      await ensureSupabaseToken();
      const response = await supabaseBrowserClient
        .from("tasks")
        .select([
          "id",
          "title",
          "due_at",
          "workspace_id",
          "created_at",
          "updated_at",
        ].join(","))
        .eq("workspace_id", workspaceId)
        .not("due_at", "is", null)
        .order("due_at", { ascending: true });
      if (response.error) {
        throw response.error;
      }
      if (fetchId.current !== currentFetchId) {
        return;
      }
      const rawTasks: unknown[] = Array.isArray(response.data)
        ? (response.data as unknown[])
        : [];

      const taskRecords = rawTasks.filter(isTaskRecord);

      const normalizedTasks = taskRecords
        .map(normalizeTask)
        .filter((item): item is CalendarTaskItem => Boolean(item));
      setTaskItems(normalizedTasks);
    } catch (err) {
      if (fetchId.current !== currentFetchId) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unable to load calendar tasks";
      console.error("[useCalendar] task refresh failed", err);
      setTasksError(message);
    } finally {
      if (fetchId.current === currentFetchId) {
        setTasksLoading(false);
      }
    }
  }, [workspaceId]);

  const handleCalendarRealtime = useCallback(
    (payload: CalendarRealtimePayload) => {
      if (!workspaceId) {
        return;
      }
      if (payload.table === "calendar_events") {
        return;
      }
      if (payload.table === "tasks") {
        if (payload.event === "DELETE") {
          applyTaskRecord(payload.oldRecord as TaskRecord | null, payload.event);
          return;
        }
        applyTaskRecord(payload.newRecord as TaskRecord | null, payload.event);
      }
    },
    [workspaceId, applyTaskRecord]
  );

  useEffect(() => {
    if (!workspaceId) {
      setTaskItems([]);
      setTasksError(null);
      setTasksLoading(false);
      return;
    }
    void refresh();
  }, [workspaceId, refresh]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    let isActive = true;
    let taskChannel: RealtimeChannel | null = null;

    const subscribe = async () => {
      try {
        await ensureSupabaseToken();
        if (!isActive) {
          return;
        }
        taskChannel = supabaseBrowserClient
          .channel(`workspace-calendar-tasks-${workspaceId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "tasks",
              filter: `workspace_id=eq.${workspaceId}`,
            },
            (payload: RealtimePostgresChangesPayload<TaskRecord>) => {
              if (payload.eventType === "DELETE") {
                applyTaskRecord(payload.old as TaskRecord | null, "DELETE");
                return;
              }
              applyTaskRecord(payload.new as TaskRecord | null, payload.eventType);
            }
          )
          .subscribe();
      } catch (err) {
        console.error("[useCalendar] realtime subscription failed", err);
      }
    };

    void subscribe();

    const bridge = getCalendarRealtimeBridge();
    const bridgeUnsubscribe = bridge?.subscribe(handleCalendarRealtime);

    return () => {
      isActive = false;
      taskChannel?.unsubscribe();
      bridgeUnsubscribe?.();
    };
  }, [workspaceId, applyTaskRecord, handleCalendarRealtime]);

  // Polling entfernt – Realtime-Subscription (oben) übernimmt alle Updates.
  // Manuelles Refresh weiterhin über den zurückgegebenen `refresh`-Callback möglich.

  const normalizedEvents = useMemo(() => {
    return calendarEvents
      .map((event) => ({
        kind: "event" as const,
        id: event.id,
        title: event.title,
        start: event.start ?? "",
        end: event.end ?? "",
        workspaceId: event.workspaceId ?? null,
        source: event.source,
        isEditable: event.isEditable,
        isOptimistic: Boolean(event.isOptimistic),
      }))
      .filter((item) => item.start);
  }, [calendarEvents]);

  const combinedItems = useMemo(
    () => sortCalendarItems([...normalizedEvents, ...taskItems]),
    [normalizedEvents, taskItems]
  );

  return {
    items: combinedItems,
    isLoading: calendarLoading || tasksLoading,
    error: calendarError ?? tasksError,
    refresh,
    calendarStatus,
  };
}
