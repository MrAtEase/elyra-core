import { NextRequest } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { listRunEvents } from "@/lib/orb-os/events/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

export const runtime = "nodejs";

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

function activeWorkspaceId(payload: WhoamiResponse): string | null {
  return payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId || null;
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toPublicEvent(event: Record<string, unknown>) {
  const payload = event.payload_json && typeof event.payload_json === "object"
    ? (event.payload_json as Record<string, unknown>)
    : {};
  return {
    id: typeof event.id === "string" ? event.id : crypto.randomUUID(),
    type: String(event.event_type ?? "UNKNOWN"),
    at: String(event.created_at ?? new Date().toISOString()),
    summary: typeof payload.summary === "string" ? payload.summary : String(event.event_type ?? "unknown"),
    detail: typeof payload.detail === "string" ? payload.detail : undefined,
  };
}

function isTerminalEvent(type: string): boolean {
  return type === "RUN_SUCCEEDED" || type === "RUN_FAILED" || type === "RUN_CANCELLED";
}

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return new Response("Unauthorized", { status: response.status });
  }

  const workspaceId = activeWorkspaceId(payload);
  if (!workspaceId) {
    return new Response("Workspace required", { status: 400 });
  }

  const params = await context.params;
  const runId = (params.runId || "").replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120);
  if (!runId) {
    return new Response("Invalid run id", { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let lastSeenEventId = "";
      let closed = false;
      let interval: ReturnType<typeof setInterval> | null = null;

      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      const flushEvents = async () => {
        try {
          const events = await listRunEvents({ workspaceId, runId, limit: 500 });
          const nextEvents = events.filter((event) => {
            const eventId = typeof event.id === "string" ? event.id : "";
            return eventId && eventId !== lastSeenEventId;
          });

          if (nextEvents.length === 0) return;

          for (const event of nextEvents) {
            const publicEvent = toPublicEvent(event as Record<string, unknown>);
            write(encodeSse("run.event", publicEvent));
            lastSeenEventId = publicEvent.id;
            if (isTerminalEvent(publicEvent.type)) {
              write(encodeSse("run.terminal", publicEvent));
              close();
              return;
            }
          }
        } catch (error) {
          write(encodeSse("run.error", {
            message: error instanceof Error ? error.message : "Failed to read run events.",
          }));
          close();
        }
      };

      write(": connected\n\n");
      void flushEvents();
      interval = setInterval(() => {
        void flushEvents();
      }, 1000);

      request.signal.addEventListener("abort", () => {
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
