import test from "node:test";
import assert from "node:assert/strict";
import { assertControlPlaneWrite, assertDataPlaneWrite, tablePlane } from "@/lib/orb-os/cqrs/ownership";

test("classifies known CQRS planes", () => {
  assert.equal(tablePlane("workspace_capabilities"), "control_plane");
  assert.equal(tablePlane("tool_calls"), "data_plane");
  assert.equal(tablePlane("unknown_table"), "unknown");
});

test("blocks control-plane writes to data-plane tables", () => {
  assert.throws(() => assertControlPlaneWrite("tool_calls"), /Invalid control-plane write/);
});

test("blocks local data-plane writes in SSOT mode", () => {
  const previous = process.env.ELYRA_USE_WORKER_BACKBONE;
  process.env.ELYRA_USE_WORKER_BACKBONE = "1";
  try {
    assert.throws(() => assertDataPlaneWrite("tool_calls"), /disabled in SSOT mode/);
  } finally {
    if (typeof previous === "string") process.env.ELYRA_USE_WORKER_BACKBONE = previous;
    else delete process.env.ELYRA_USE_WORKER_BACKBONE;
  }
});

