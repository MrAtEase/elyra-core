import type { NotificationItem } from "@/components/os/kernel/types";

type EventMap = {
  "notification:new": NotificationItem;
  "overlay:close-all": {};
  "orb:state": {
    state:
      | "idle"
      | "thinking"
      | "listening"
      | "planning"
      | "executing"
      | "attention"
      | "waiting_for_auth"
      | "waiting_for_approval"
      | "success"
      | "degraded"
      | "error";
  };
  "artifact:open": { artifactId: string; type: string };
};

type EventKey = keyof EventMap;
type Handler<K extends EventKey> = (payload: EventMap[K]) => void;

class LocalEventBus {
  private listeners = new Map<EventKey, Set<Handler<any>>>();

  on<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(handler as Handler<any>);
    this.listeners.set(event, bucket);
    return () => {
      bucket.delete(handler as Handler<any>);
    };
  }

  emit<K extends EventKey>(event: K, payload: EventMap[K]) {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.forEach((handler) => handler(payload));
  }

  off<K extends EventKey>(event: K, handler: Handler<K>) {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.delete(handler as Handler<any>);
  }
}

export const eventBus = new LocalEventBus();
