import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import { GET as mcpGet, POST as mcpPost } from "@/app/api/os/code/mcp/route";

test("code mcp route reports project guide and checkpointing state from repo settings", async () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "elyra-mcp-route-"));
  try {
    const request = new NextRequest(
      `http://localhost/api/os/code/mcp?repoUrl=${encodeURIComponent(repoDir)}`,
    );
    const response = await mcpGet(request);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      checkpointingEnabled?: boolean;
      projectGuideExists?: boolean;
      settingsPath?: string;
    };
    assert.equal(payload.checkpointingEnabled, false);
    assert.equal(payload.projectGuideExists, false);
    assert.match(String(payload.settingsPath), /\.gemini\/settings\.json$/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("code mcp route enables checkpointing in project settings", async () => {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "elyra-mcp-enable-"));
  try {
    const request = new NextRequest("http://localhost/api/os/code/mcp", {
      method: "POST",
      body: JSON.stringify({ action: "enableCheckpointing", repoUrl: repoDir }),
      headers: { "content-type": "application/json" },
    });
    const response = await mcpPost(request);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { ok?: boolean; checkpointingEnabled?: boolean; settingsPath?: string };
    assert.equal(payload.ok, true);
    assert.equal(payload.checkpointingEnabled, true);
    assert.match(String(payload.settingsPath), /\.gemini\/settings\.json$/);

    const statusRequest = new NextRequest(
      `http://localhost/api/os/code/mcp?repoUrl=${encodeURIComponent(repoDir)}`,
    );
    const statusResponse = await mcpGet(statusRequest);
    const statusPayload = (await statusResponse.json()) as { checkpointingEnabled?: boolean };
    assert.equal(statusPayload.checkpointingEnabled, true);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
