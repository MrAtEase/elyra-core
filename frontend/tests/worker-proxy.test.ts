import test from "node:test";
import assert from "node:assert/strict";
import { forwardToWorkerOs, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";

test("worker proxy returns payload on success", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  const payload = await forwardToWorkerOs({ path: "/v1/os/runs", method: "GET" });
  assert.deepEqual(payload, { ok: true });
  global.fetch = originalFetch;
});

test("worker proxy emits degraded payload on network failure", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  await assert.rejects(
    () => forwardToWorkerOs({ path: "/v1/os/runs", method: "GET" }),
    (error: unknown) => {
      assert.equal(error instanceof WorkerProxyError, true);
      assert.equal((error as WorkerProxyError).status, 503);
      return true;
    },
  );
  global.fetch = originalFetch;
});

test("worker proxy attaches signature headers when proxy secret is configured", async () => {
  const previousSecret = process.env.ASSISTANT_OS_PROXY_SECRET;
  process.env.ASSISTANT_OS_PROXY_SECRET = "test-proxy-secret";
  const originalFetch = global.fetch;

  let capturedHeaders: Headers | null = null;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedHeaders = (init?.headers as Headers) ?? null;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    await forwardToWorkerOs({ path: "/v1/os/runs?status=queued", method: "POST", body: { foo: "bar" } });
    assert.ok(capturedHeaders, "expected headers to be set");
    assert.equal(Boolean(capturedHeaders?.get("x-elyra-proxy-ts")), true);
    assert.equal(Boolean(capturedHeaders?.get("x-elyra-proxy-nonce")), true);
    assert.equal(Boolean(capturedHeaders?.get("x-elyra-proxy-signature")), true);
  } finally {
    global.fetch = originalFetch;
    if (typeof previousSecret === "string") process.env.ASSISTANT_OS_PROXY_SECRET = previousSecret;
    else delete process.env.ASSISTANT_OS_PROXY_SECRET;
  }
});

test("worker proxy fails fast when signing is required without secret", async () => {
  const previousRequired = process.env.ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE;
  const previousSecret = process.env.ASSISTANT_OS_PROXY_SECRET;
  process.env.ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE = "1";
  delete process.env.ASSISTANT_OS_PROXY_SECRET;

  await assert.rejects(
    () => forwardToWorkerOs({ path: "/v1/os/runs", method: "GET" }),
    (error: unknown) => {
      assert.equal(error instanceof WorkerProxyError, true);
      assert.equal((error as WorkerProxyError).status, 500);
      return true;
    },
  );

  if (typeof previousRequired === "string") process.env.ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE = previousRequired;
  else delete process.env.ASSISTANT_OS_REQUIRE_PROXY_SIGNATURE;
  if (typeof previousSecret === "string") process.env.ASSISTANT_OS_PROXY_SECRET = previousSecret;
});
