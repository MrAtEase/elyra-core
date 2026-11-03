import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { DELETE as ideDelete, GET as ideGet, POST as idePost } from "@/app/api/os/code/ide/route";
import { GET as mcpGet } from "@/app/api/os/code/mcp/route";

const REPO_URL = "/Users/paulodak/Projects/elyra-core/frontend";

test("code ide route starts, reports, and stops the local Code-OSS surface", async () => {
  const postReq = new NextRequest("http://localhost/api/os/code/ide", {
    method: "POST",
    body: JSON.stringify({ repoUrl: REPO_URL }),
    headers: { "content-type": "application/json" },
  });
  const postRes = await idePost(postReq);
  assert.equal(postRes.status, 200);
  const postPayload = (await postRes.json()) as {
    ok: boolean;
    running: boolean;
    healthy: boolean;
    url: string;
    repoUrl: string;
  };
  assert.equal(postPayload.ok, true);
  assert.equal(postPayload.running, true);
  assert.equal(postPayload.healthy, true);
  assert.equal(postPayload.repoUrl, REPO_URL);
  assert.match(postPayload.url, /^http:\/\/127\.0\.0\.1:3390\/\?folder=/);

  const ideResponse = await fetch(postPayload.url, { redirect: "manual" });
  assert.ok(ideResponse.status === 200 || ideResponse.status === 302);

  const getReq = new NextRequest(`http://localhost/api/os/code/ide?repoUrl=${encodeURIComponent(REPO_URL)}`);
  const getRes = await ideGet(getReq);
  assert.equal(getRes.status, 200);
  const getPayload = (await getRes.json()) as {
    ok: boolean;
    running: boolean;
    healthy: boolean;
    url: string | null;
    repoUrl: string;
    pid: number | null;
  };
  assert.equal(getPayload.ok, true);
  assert.equal(getPayload.running, true);
  assert.equal(getPayload.healthy, true);
  assert.equal(getPayload.repoUrl, REPO_URL);
  assert.equal(typeof getPayload.pid, "number");

  const deleteReq = new NextRequest("http://localhost/api/os/code/ide", { method: "DELETE" });
  const deleteRes = await ideDelete(deleteReq);
  assert.equal(deleteRes.status, 200);
  const deletePayload = (await deleteRes.json()) as { ok: boolean; stopped: boolean };
  assert.equal(deletePayload.ok, true);
  assert.equal(deletePayload.stopped, true);
});

test("code mcp route returns a structured Gemini CLI MCP status payload", async () => {
  const request = new NextRequest("http://localhost/api/os/code/mcp");
  const response = await mcpGet(request);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok: boolean;
    configured: boolean;
    servers: string[];
    error?: string;
  };
  assert.equal(typeof payload.configured, "boolean");
  assert.ok(Array.isArray(payload.servers));
  if (payload.ok === false) {
    assert.equal(typeof payload.error, "string");
  }
});
