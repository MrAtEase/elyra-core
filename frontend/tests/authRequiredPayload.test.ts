import assert from "node:assert/strict";

import { buildAuthRequiredPayload } from "../lib/auth/useWhoamiLoader";

const FALLBACK_AUTH_REQUIRED_LOGIN_URL = "/signin";

function runTests() {
  const emptyPayload = buildAuthRequiredPayload({} as Record<string, unknown>);
  assert.equal(emptyPayload.ok, false);
  assert.equal(emptyPayload.code, "AUTH_REQUIRED");
  assert.equal(emptyPayload.loginUrl, FALLBACK_AUTH_REQUIRED_LOGIN_URL);
  assert.equal(emptyPayload.authUrl, FALLBACK_AUTH_REQUIRED_LOGIN_URL);
  assert.equal(emptyPayload.message, null);

  const nullPayload = buildAuthRequiredPayload(null);
  assert.equal(nullPayload.ok, false);
  assert.equal(nullPayload.code, "AUTH_REQUIRED");
  assert.equal(nullPayload.loginUrl, FALLBACK_AUTH_REQUIRED_LOGIN_URL);
  assert.equal(nullPayload.authUrl, FALLBACK_AUTH_REQUIRED_LOGIN_URL);
  assert.equal(nullPayload.message, null);

  const customPayload = buildAuthRequiredPayload({
    ok: true,
    code: "CUSTOM_CODE",
    loginUrl: "  https://custom.example/login  ",
    authUrl: "https://custom.example/auth ",
    message: "  Please sign in to continue. ",
  } as Record<string, unknown>);

  assert.equal(customPayload.ok, true);
  assert.equal(customPayload.code, "CUSTOM_CODE");
  assert.equal(customPayload.loginUrl, "https://custom.example/login");
  assert.equal(customPayload.authUrl, "https://custom.example/auth");
  assert.equal(customPayload.message, "Please sign in to continue.");

  console.log("✅ buildAuthRequiredPayload tests passed.");
}

runTests();
