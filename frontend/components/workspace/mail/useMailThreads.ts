"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { ensureSupabaseToken, supabaseBrowserClient } from "@/lib/supabase/browser";
import {
  MailThread,
  MailThreadRecord,
  normalizeMailThread,
  sortMailThreads,
  isMailThreadRecordArray,
} from "./mail-model";

type MailRealtimePayload = {
  table: "mail_threads";
  event: "INSERT" | "UPDATE" | "DELETE";
  newRecord?: MailThreadRecord;
  oldRecord?: MailThreadRecord;
};

type MailRealtimeBridge = {
  publish: (payload: MailRealtimePayload) => void;
  subscribe: (listener: (payload: MailRealtimePayload) => void) => () => void;
  insertThread: (record: MailThreadRecord) => void;
};

declare global {
  interface Window {
    __fdMailRealtimeBridge?: MailRealtimeBridge;
  }
}

const getMailRealtimeBridge = (): MailRealtimeBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }
  if (!window.__fdMailRealtimeBridge) {
    const subscribers = new Set<(payload: MailRealtimePayload) => void>();
    const bridge: MailRealtimeBridge = {
      publish(payload) {
        subscribers.forEach((listener) => listener(payload));
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
      insertThread(record) {
        bridge.publish({
          table: "mail_threads",
          event: "INSERT",
          newRecord: record,
        });
      },
    };
    window.__fdMailRealtimeBridge = bridge;
  }
  return window.__fdMailRealtimeBridge;
};

export function useMailThreads(workspaceId: string | null | undefined) {
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchId = useRef(0);

  const applyThreadRecord = useCallback(
    (record: MailThreadRecord | null, eventType: MailRealtimePayload["event"]) => {
      if (!record || record.workspace_id !== workspaceId) {
        return;
      }
      setThreads((prev) => {
        const filtered = prev.filter((item) => item.id !== record.id);
        if (eventType === "DELETE") {
          return filtered;
        }
        return sortMailThreads([...filtered, normalizeMailThread(record)]);
      });
    },
    [workspaceId]
  );

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
        .from("mail_threads")
        .select(
          [
            "id",
            "workspace_id",
            "integration_id",
            "external_id",
            "subject",
            "snippet",
            "from_email",
            "to_emails",
            "last_message_at",
            "raw",
            "created_at",
            "updated_at",
          ].join(",")
        )
        .eq("workspace_id", workspaceId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false, nullsFirst: false });

      if (queryError) {
        throw queryError;
      }

      if (fetchId.current !== currentFetchId) {
        return;
      }

      const records = data ?? [];
      if (!isMailThreadRecordArray(records)) {
        throw new Error("Unable to parse mail threads");
      }

      setThreads(sortMailThreads(records.map(normalizeMailThread)));
    } catch (err) {
      if (fetchId.current !== currentFetchId) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unable to load mail threads";
      console.error("[useMailThreads] refresh failed", err);
      setError(message);
    } finally {
      if (fetchId.current === currentFetchId) {
        setIsLoading(false);
      }
    }
  }, [workspaceId]);

  const handleRealtime = useCallback(
    (payload: MailRealtimePayload) => {
      if (!workspaceId) {
        return;
      }
      if (payload.table !== "mail_threads") {
        return;
      }
      if (payload.event === "DELETE") {
        applyThreadRecord(payload.oldRecord ?? null, "DELETE");
        return;
      }
      applyThreadRecord(payload.newRecord ?? null, payload.event);
    },
    [workspaceId, applyThreadRecord]
  );

  useEffect(() => {
    if (!workspaceId) {
      setThreads([]);
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
          .channel(`workspace-mail-threads-${workspaceId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "mail_threads",
              filter: `workspace_id=eq.${workspaceId}`,
            },
            (payload: RealtimePostgresChangesPayload<MailThreadRecord>) => {
              if (payload.eventType === "DELETE") {
                applyThreadRecord(payload.old as MailThreadRecord | null, "DELETE");
                return;
              }
              applyThreadRecord(payload.new as MailThreadRecord | null, payload.eventType);
            }
          )
          .subscribe();
      } catch (err) {
        console.error("[useMailThreads] realtime subscription failed", err);
      }
    };

    void subscribe();

    const bridge = getMailRealtimeBridge();
    const bridgeUnsubscribe = bridge?.subscribe(handleRealtime);

    return () => {
      isActive = false;
      channel?.unsubscribe();
      bridgeUnsubscribe?.();
    };
  }, [workspaceId, applyThreadRecord, handleRealtime]);

  return {
    threads,
    isLoading,
    error,
    refresh,
  };
}
