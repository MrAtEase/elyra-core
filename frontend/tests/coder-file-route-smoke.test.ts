import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://127.0.0.1:3000";
const REPO_URL = "/Users/paulodak/Projects/elyra-core/frontend";
const FILE_PATH = "components/os/shell/IdentityMenu.tsx";

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/os/code/run/`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

test("coder file route reads playground files for the selected repo", async (t) => {
  if (!(await isServerUp())) {
    t.skip("localhost:3000 is not running");
    return;
  }

  const url = new URL(`${BASE_URL}/api/os/code/file/`);
  url.searchParams.set("repoUrl", REPO_URL);
  url.searchParams.set("stage", "playground");
  url.searchParams.set("path", FILE_PATH);

  const res = await fetch(url, { cache: "no-store" });
  assert.equal(res.ok, true);
  const payload = (await res.json()) as { ok: boolean; content: string; filePath: string };
  assert.equal(payload.ok, true);
  assert.equal(payload.filePath, FILE_PATH);
  assert.match(payload.content, /IdentityMenu/);
});
