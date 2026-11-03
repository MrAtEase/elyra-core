import { getApiOrigin } from "@/lib/env";

export type WorkerRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkerRunSummary = {
  id: string;
  status: WorkerRunStatus;
};

export type WorkerBackboneClient = {
  createRun(input: {
    intent_text: string;
    nodes: Array<{
      id: string;
      type: "tool" | "decision" | "checkpoint";
      tool_name?: string;
      input?: Record<string, unknown>;
      depends_on?: string[];
    }>;
  }): Promise<{ run: WorkerRunSummary }>;
  tickWorker(): Promise<{ processed: boolean; run_id?: string; status?: string }>;
  getRun(runId: string): Promise<{ run: WorkerRunSummary; artifacts: unknown[]; tool_calls: unknown[] }>;
};

function osBaseUrl() {
  return `${getApiOrigin().replace(/\/$/, "")}/v1/os`;
}

function makeHeaders(input?: { cookieHeader?: string | null; authorizationHeader?: string | null }) {
  const headers = new Headers({ "content-type": "application/json" });
  if (input?.cookieHeader) headers.set("cookie", input.cookieHeader);
  if (input?.authorizationHeader) headers.set("authorization", input.authorizationHeader);
  return headers;
}

function createSessionHeaderInput(options?: {
  cookieHeader?: string | null;
  authorizationHeader?: string | null;
}): { cookieHeader?: string | null; authorizationHeader?: string | null } {
  return {
    ...(options?.cookieHeader !== undefined ? { cookieHeader: options.cookieHeader } : {}),
    ...(options?.authorizationHeader !== undefined ? { authorizationHeader: options.authorizationHeader } : {}),
  };
}

export function createWorkerBackboneClient(options?: {
  fetchImpl?: typeof fetch;
  cookieHeader?: string | null;
  authorizationHeader?: string | null;
}): WorkerBackboneClient {
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    async createRun(input) {
      const response = await fetchImpl(`${osBaseUrl()}/runs`, {
        method: "POST",
        headers: makeHeaders(createSessionHeaderInput(options)),
        body: JSON.stringify(input),
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        run?: { id: string; status: WorkerRunStatus };
      } | null;

      if (!response.ok || !payload?.ok || !payload.run) {
        throw new Error(`Failed to create worker run (${response.status})`);
      }

      return { run: payload.run };
    },

    async tickWorker() {
      const response = await fetchImpl(`${osBaseUrl()}/worker/tick`, {
        method: "POST",
        headers: makeHeaders(createSessionHeaderInput(options)),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        processed?: boolean;
        run_id?: string;
        status?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(`Failed to tick worker (${response.status})`);
      }
      return {
        processed: Boolean(payload.processed),
        ...(typeof payload.run_id === "string" ? { run_id: payload.run_id } : {}),
        ...(typeof payload.status === "string" ? { status: payload.status } : {}),
      };
    },

    async getRun(runId: string) {
      const response = await fetchImpl(`${osBaseUrl()}/runs/${encodeURIComponent(runId)}`, {
        method: "GET",
        headers: makeHeaders(createSessionHeaderInput(options)),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        run?: { id: string; status: WorkerRunStatus };
        artifacts?: unknown[];
        tool_calls?: unknown[];
      } | null;
      if (!response.ok || !payload?.ok || !payload.run) {
        throw new Error(`Failed to load worker run (${response.status})`);
      }
      return {
        run: payload.run,
        artifacts: payload.artifacts ?? [],
        tool_calls: payload.tool_calls ?? [],
      };
    },
  };
}

export async function runToTerminalState(input: {
  client: WorkerBackboneClient;
  runId: string;
  maxTicks?: number;
  tickDelayMs?: number;
}): Promise<{ run: WorkerRunSummary; ticks: number }> {
  const maxTicks = Math.max(1, input.maxTicks ?? 25);
  const tickDelayMs = Math.max(0, input.tickDelayMs ?? 50);

  for (let tick = 0; tick < maxTicks; tick += 1) {
    const current = await input.client.getRun(input.runId);
    if (["succeeded", "failed", "cancelled", "waiting_for_approval"].includes(current.run.status)) {
      return { run: current.run, ticks: tick };
    }
    await input.client.tickWorker();
    if (tickDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, tickDelayMs));
    }
  }

  const finalState = await input.client.getRun(input.runId);
  return { run: finalState.run, ticks: maxTicks };
}
