import { EventEmitter } from "node:events";
import type { SSEEvent } from "../types/sse.js";

const emitters = new Map<string, EventEmitter>();

const HEARTBEAT_MS = 15_000;

export function getOrCreateEmitter(runId: string): EventEmitter {
  let emitter = emitters.get(runId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitters.set(runId, emitter);
  }
  return emitter;
}

export function emitSSE(runId: string, event: SSEEvent): void {
  const emitter = emitters.get(runId);
  if (emitter) {
    emitter.emit("sse", event);
  }
}

export function removeEmitter(runId: string): void {
  const emitter = emitters.get(runId);
  if (emitter) {
    emitter.removeAllListeners();
    emitters.delete(runId);
  }
}

/** Format SSE event for HTTP response */
export function formatSSE(event: SSEEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export { HEARTBEAT_MS };
