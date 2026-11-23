import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerBackboneClient, runToTerminalState } from "@/lib/orb-os/runtime/backbone";

test("worker backbone runs reach terminal state without browser session", async () => {
  const runId = "run-123";
  let ticks = 0;

  const fetchMock: typeof fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/v1/os/runs") && init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true, run: { id: runId, status: "queued" } }), { status: 201 });
    }

    if (target.endsWith("/v1/os/worker/tick") && init?.method === "POST") {
      ticks += 1;
      return new Response(JSON.stringify({ ok: true, processed: true, run_id: runId, status: ticks >= 2 ? "succeeded" : "running" }), {
        status: 200,
      });
    }

    if (target.endsWith(`/v1/os/runs/${runId}`) && init?.method === "GET") {
      return new Response(JSON.stringify({ ok: true, run: { id: runId, status: ticks >= 2 ? "succeeded" : "running" }, artifacts: [], tool_calls: [] }), {
        status: 200,
      });
    }

    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as typeof fetch;

  const client = createWorkerBackboneClient({ fetchImpl: fetchMock });
  const created = await client.createRun({
    intent_text: "Generate a weather report",
    nodes: [{ id: "n1", type: "tool", tool_name: "weather.getForecast", input: { location: "Berlin" } }],
  });

  const result = await runToTerminalState({ client, runId: created.run.id, maxTicks: 5, tickDelayMs: 0 });
  assert.equal(result.run.status, "succeeded");
  assert.ok(result.ticks >= 1);
});
