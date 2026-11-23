#!/usr/bin/env node
const DEFAULT_ORIGIN = "https://api.elyra-core.app";

function normalizeOrigin(value) {
  if (!value) return DEFAULT_ORIGIN;
  try {
    const parsed = new URL(value.trim());
    return `${parsed.origin}`;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

const API_ORIGIN = normalizeOrigin(process.env.WORKER_API_ORIGIN || process.env.API_ORIGIN);
const WHOAMI_URL = new URL("/assistant/auth/whoami", API_ORIGIN).toString();
const SESSION_COOKIE = process.env.SESSION_COOKIE?.trim() || null;
let exitCode = 0;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // ignore non-json bodies
  }
  return { response, payload, text };
}

function logResult(label, success, details) {
  const symbol = success ? "✅" : "❌";
  console.log(`${symbol} ${label}${details ? ` – ${details}` : ""}`);
  if (!success) {
    exitCode = 1;
  }
}

async function runUnauthenticatedCheck() {
  try {
    const { response, payload } = await fetchJson(WHOAMI_URL, {
      headers: { "Cache-Control": "no-cache" },
    });
    const expected = response.status === 401 && payload?.code === "AUTH_REQUIRED";
    logResult(
      "whoami (no session) -> expect 401 AUTH_REQUIRED",
      expected,
      `status ${response.status}${payload?.code ? `, code=${payload.code}` : ""}`
    );
  } catch (error) {
    logResult("whoami (no session)", false, error.message);
  }
}

async function runAuthenticatedCheck() {
  if (!SESSION_COOKIE) {
    console.log("🔸 SESSION_COOKIE not provided, skipping authenticated check.");
    return;
  }
  try {
    const { response, payload } = await fetchJson(WHOAMI_URL, {
      headers: {
        Cookie: SESSION_COOKIE,
        "Cache-Control": "no-cache",
      },
    });
    const validShape = response.status === 200 && payload?.ok === true && Array.isArray(payload?.workspaces);
    logResult(
      "whoami (with session cookie)",
      validShape,
      `status ${response.status}${payload?.ok === undefined ? "" : ", ok=" + payload.ok}`
    );
  } catch (error) {
    logResult("whoami (with session cookie)", false, error.message);
  }
}

(async () => {
  console.log("Worker smoke test →", WHOAMI_URL);
  await runUnauthenticatedCheck();
  await runAuthenticatedCheck();
  process.exit(exitCode);
})();
