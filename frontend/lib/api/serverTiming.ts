type TimingEntry = {
  name: string;
  durMs: number;
  description?: string;
};

type ServerTimingOptions = {
  logThresholdMs?: number;
  logInProduction?: boolean;
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function formatDuration(value: number): string {
  return Math.max(0, value).toFixed(1);
}

function escapeDescription(value: string): string {
  return value.replace(/"/g, "'");
}

export function createServerTimingTrace(
  route: string,
  options?: ServerTimingOptions
) {
  const startedAt = nowMs();
  const entries: TimingEntry[] = [];
  const logThresholdMs = options?.logThresholdMs ?? 350;
  const logInProduction = options?.logInProduction ?? false;

  function push(name: string, durMs: number, description?: string): void {
    entries.push({
      name: name.replace(/[^a-zA-Z0-9_-]/g, "_"),
      durMs,
      ...(description ? { description } : {}),
    });
  }

  return {
    async measure<T>(
      name: string,
      task: Promise<T> | (() => Promise<T>),
      description?: string
    ): Promise<T> {
      const start = nowMs();
      try {
        const promise = typeof task === "function" ? task() : task;
        return await promise;
      } finally {
        push(name, nowMs() - start, description);
      }
    },
    mark(name: string, description?: string): void {
      push(name, 0, description);
    },
    totalMs(): number {
      return nowMs() - startedAt;
    },
    slowest(): TimingEntry | null {
      return entries.reduce<TimingEntry | null>((slowest, entry) => {
        if (!slowest || entry.durMs > slowest.durMs) {
          return entry;
        }
        return slowest;
      }, null);
    },
    headerValue(): string {
      const total = this.totalMs();
      const values = entries.map((entry) => {
        const parts = [`${entry.name};dur=${formatDuration(entry.durMs)}`];
        if (entry.description) {
          parts.push(`desc="${escapeDescription(entry.description)}"`);
        }
        return parts.join(";");
      });
      values.push(`total;dur=${formatDuration(total)};desc="${escapeDescription(route)}"`);
      return values.join(", ");
    },
    apply(response: Response): Response {
      response.headers.set("Server-Timing", this.headerValue());
      const slowest = this.slowest();
      if (slowest) {
        response.headers.set("X-Elyra-Slowest-Step", slowest.name);
      }
      response.headers.set("X-Elyra-Route-Time", formatDuration(this.totalMs()));
      return response;
    },
    log(meta?: Record<string, unknown>): void {
      if (process.env.NODE_ENV === "production" && !logInProduction) {
        return;
      }
      const total = this.totalMs();
      if (total < logThresholdMs) {
        return;
      }
      const slowest = this.slowest();
      console.info("[perf]", {
        route,
        totalMs: Number(formatDuration(total)),
        slowestStep: slowest?.name ?? null,
        slowestMs: slowest ? Number(formatDuration(slowest.durMs)) : null,
        steps: entries.map((entry) => ({
          name: entry.name,
          ms: Number(formatDuration(entry.durMs)),
          ...(entry.description ? { description: entry.description } : {}),
        })),
        ...(meta ?? {}),
      });
    },
  };
}
