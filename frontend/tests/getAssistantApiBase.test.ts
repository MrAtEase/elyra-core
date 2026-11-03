import assert from "node:assert/strict";
import { getAssistantApiBase } from "../lib/env";

type EnvOverrides = Record<string, string | undefined>;

function withEnv(overrides: EnvOverrides, callback: () => void) {
  const snapshot: EnvOverrides = {};

  for (const key of Object.keys(overrides)) {
    snapshot[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = snapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function expectBaseWithEnv(overrides: EnvOverrides, expected: string) {
  withEnv(overrides, () => {
    assert.equal(getAssistantApiBase(), expected);
  });
}

function runTests() {
  expectBaseWithEnv(
    {
      NEXT_PUBLIC_ASSISTANT_API_BASE: "  http://localhost:8787/  ",
      NEXT_PUBLIC_API_ORIGIN: undefined,
      NEXT_PUBLIC_API_URL: undefined,
      NODE_ENV: "development",
    },
    "http://localhost:8787"
  );

  expectBaseWithEnv(
    {
      NEXT_PUBLIC_ASSISTANT_API_BASE: undefined,
      NEXT_PUBLIC_API_ORIGIN: "https://legacy-origin.com/path",
      NEXT_PUBLIC_API_URL: undefined,
      NODE_ENV: "development",
    },
    "https://legacy-origin.com"
  );

  expectBaseWithEnv(
    {
      NEXT_PUBLIC_ASSISTANT_API_BASE: undefined,
      NEXT_PUBLIC_API_ORIGIN: undefined,
      NEXT_PUBLIC_API_URL: "https://api-url.com/base",
      NODE_ENV: "development",
    },
    "https://api-url.com"
  );

  // Production with no env vars configured: must throw (no hardcoded default in prod).
  withEnv(
    {
      NEXT_PUBLIC_ASSISTANT_API_BASE: undefined,
      NEXT_PUBLIC_API_ORIGIN: undefined,
      NEXT_PUBLIC_API_URL: undefined,
      NODE_ENV: "production",
    },
    () => {
      assert.throws(
        () => getAssistantApiBase(),
        /NEXT_PUBLIC_ASSISTANT_API_BASE required in production/,
        "Should throw in production when no API base is configured",
      );
    },
  );

  expectBaseWithEnv(
    {
      NEXT_PUBLIC_ASSISTANT_API_BASE: undefined,
      NEXT_PUBLIC_API_ORIGIN: undefined,
      NEXT_PUBLIC_API_URL: undefined,
      NODE_ENV: "development",
    },
    "http://localhost:8788"
  );

  expectBaseWithEnv({
    NEXT_PUBLIC_ASSISTANT_API_BASE: undefined,
    NEXT_PUBLIC_API_ORIGIN: undefined,
    NEXT_PUBLIC_API_URL: undefined,
    NODE_ENV: "development",
    VERCEL_ENV: "preview",
    VERCEL: "1",
  }, "http://localhost:8788");

  console.log("✅ getAssistantApiBase tests passed.");
}

runTests();
