import test from "node:test";
import assert from "node:assert/strict";

import {
  getProviderStatuses,
  resolveProvider,
  resolveProviderForWorkspace,
} from "@/lib/orb-os/providers/providerRouter";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_CODER_MODEL",
  "OPENAI_MODEL",
  "ANTHROPIC_API_KEY",
  "VERTEX_PROJECT_ID",
  "GOOGLE_CLOUD_PROJECT",
  "VERTEX_LOCATION",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

function withEnv(
  patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void
): void {
  const snapshot = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    snapshot.set(key, process.env[key]);
  }
  try {
    for (const key of ENV_KEYS) {
      const next = patch[key];
      if (typeof next === "string") process.env[key] = next;
      else delete process.env[key];
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const prev = snapshot.get(key);
      if (typeof prev === "string") process.env[key] = prev;
      else delete process.env[key];
    }
  }
}

test("resolveProvider maps codex/openai/claude aliases deterministically", () => {
  assert.equal(resolveProvider("codex"), "openai");
  assert.equal(resolveProvider("openai"), "openai");
  assert.equal(resolveProvider("claude"), "claude_direct");
  assert.equal(resolveProvider("claude_vertex"), "claude_vertex");
  assert.equal(resolveProvider("gemini"), "gemini");
});

test("vertex claude is considered configured with project+location even without credentials file env", () => {
  withEnv(
    {
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      VERTEX_PROJECT_ID: "elyra-core-dev-app",
      VERTEX_LOCATION: "global",
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
    },
    () => {
      const statuses = getProviderStatuses();
      assert.equal(statuses.claude_vertex.configured, true);
    }
  );
});

test("resolveProviderForWorkspace falls back to claude_vertex before gemini when claude_direct is unavailable", () => {
  withEnv(
    {
      GEMINI_API_KEY: "gemini-key",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      VERTEX_PROJECT_ID: "elyra-core-dev-app",
      VERTEX_LOCATION: "global",
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
    },
    () => {
      const resolved = resolveProviderForWorkspace({
        preferred: "claude_direct",
        requiresReasoning: true,
        requiresToolCalls: true,
      });
      assert.equal(resolved.provider, "claude_vertex");
      assert.equal(resolved.fallbackUsed, true);
    }
  );
});

