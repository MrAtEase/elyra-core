import test from "node:test";
import assert from "node:assert/strict";

type ProviderStatus = {
  configured: boolean;
  label?: string;
};

type QuickPayload = {
  ok: boolean;
  providerStatus: Record<string, ProviderStatus>;
};

const BASE_URL = "http://localhost:3000";

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/os/code/run?quick=1`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

test("coder route quick status exposes providers and codex labeling", async (t) => {
  if (!(await isServerUp())) {
    t.skip("localhost:3000 is not running");
    return;
  }

  const res = await fetch(`${BASE_URL}/api/os/code/run?quick=1`, { cache: "no-store" });
  assert.equal(res.ok, true);
  const payload = (await res.json()) as QuickPayload;
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.providerStatus, "object");
  assert.ok(payload.providerStatus.gemini, "missing gemini in providerStatus");
  assert.ok(payload.providerStatus.openai, "missing openai in providerStatus");
  assert.ok(payload.providerStatus.claude_direct, "missing claude_direct in providerStatus");
  assert.ok(payload.providerStatus.claude_vertex, "missing claude_vertex in providerStatus");
  assert.match(payload.providerStatus.openai.label ?? "", /codex|openai/i);
});

test("explicit provider selection never silently switches provider", async (t) => {
  if (!(await isServerUp())) {
    t.skip("localhost:3000 is not running");
    return;
  }

  const quick = (await (await fetch(`${BASE_URL}/api/os/code/run?quick=1`, { cache: "no-store" })).json()) as QuickPayload;
  const providers = ["gemini", "openai", "claude_direct", "claude_vertex"] as const;

  for (const provider of providers) {
    const configured = Boolean(quick.providerStatus?.[provider]?.configured);
    const res = await fetch(`${BASE_URL}/api/os/code/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "provider smoke check",
        phase: "execute",
        stage: "dev",
        provider,
        repoUrl: "/Users/paulodak/Projects/elyra-core",
      }),
    });
    const payload = (await res.json()) as { code?: string };

    if (configured) {
      assert.equal(payload.code, "PROMOTION_REQUIRED");
    } else {
      assert.equal(payload.code, "PROVIDER_UNAVAILABLE");
    }
  }
});

