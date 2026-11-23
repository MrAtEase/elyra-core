import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall, ToolExecutionError } from "@/lib/orb-os/tools/execution";

test("SSOT mode blocks local execution path", async () => {
  const previous = process.env.ELYRA_USE_WORKER_BACKBONE;
  process.env.ELYRA_USE_WORKER_BACKBONE = "1";
  await assert.rejects(
    () =>
      executeToolCall({
        workspace_id: "ws-1",
        run_id: "run-1",
        tool_name: "weather.getForecast",
        args: { location: "Berlin", days: 2, units: "metric" },
        idempotency_key: "idem-123456",
      }),
    (error: unknown) => {
      assert.equal(error instanceof ToolExecutionError, true);
      assert.equal((error as ToolExecutionError).status, 410);
      return true;
    },
  );
  if (typeof previous === "string") process.env.ELYRA_USE_WORKER_BACKBONE = previous;
  else delete process.env.ELYRA_USE_WORKER_BACKBONE;
});
