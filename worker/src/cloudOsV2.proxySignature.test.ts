import assert from "node:assert/strict";
import { handleV1OsRequest } from "./cloudOsV2";

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

function statement(): D1PreparedStatement {
  return {
    bind: () => statement(),
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
}

const env = {
  ASSISTANT_DB: {
    prepare: () => statement(),
  },
  ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE: "1",
  ASSISTANT_OS_PROXY_SECRET: "test-secret",
};

const resolved = {
  session: { active_workspace_id: "ws-1" },
  user: { id: "user-1", email: "user@example.com" },
};

async function run(): Promise<void> {
  const request = new Request("https://api.elyra-core.app/v1/os/runs", { method: "GET" });
  const response = await handleV1OsRequest(request, env, resolved);
  assert.ok(response);
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "invalid_proxy_signature");
  console.log("ok cloudOsV2 proxy signature gate");
}

void run();

