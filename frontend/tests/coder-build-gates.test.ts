import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __test__ } from "@/app/api/os/code/run/route";

test("detectPackageManager prefers npm when package-lock.json exists", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "elyra-pkg-"));
  try {
    await writeFile(path.join(tmp, "package-lock.json"), "{}\n", "utf8");
    await writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    const pkg = await __test__.detectPackageManager(tmp);
    assert.equal(pkg, "npm");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("commandForGate runs next build as-is without --webpack (Turbopack compatible)", () => {
  const resolved = __test__.commandForGate("build", "npm", { build: "next build" });
  assert.equal(resolved.scriptFound, true);
  // Must NOT append --webpack: it blocks Turbopack and is not a valid next build flag.
  assert.deepEqual(resolved.args, ["run", "build"]);
  assert.equal(resolved.command, "npm run build");
});

test("commandForGate preserves --turbopack when build script uses it", () => {
  const resolved = __test__.commandForGate("build", "npm", { build: "next build --turbopack" });
  assert.equal(resolved.scriptFound, true);
  assert.deepEqual(resolved.args, ["run", "build"]);
  // The --turbopack flag lives inside the npm script, not appended by the gate.
  assert.equal(resolved.command, "npm run build");
});

test("commandForGate returns scriptFound:false when build script is absent", () => {
  const resolved = __test__.commandForGate("build", "npm", {});
  assert.equal(resolved.scriptFound, false);
});

test("commandForGate uses pnpm run format for pnpm", () => {
  const resolved = __test__.commandForGate("build", "pnpm", { build: "next build" });
  assert.equal(resolved.scriptFound, true);
  assert.deepEqual(resolved.args, ["build"]);
  assert.equal(resolved.command, "pnpm build");
});

test("commandForGate resolves typecheck alias", () => {
  const resolved = __test__.commandForGate("typecheck", "npm", { tsc: "tsc --noEmit" });
  assert.equal(resolved.scriptFound, true);
  assert.deepEqual(resolved.args, ["run", "tsc"]);
});

test("commandForGate resolves tests gate to test script", () => {
  const resolved = __test__.commandForGate("tests", "npm", { test: "vitest run" });
  assert.equal(resolved.scriptFound, true);
  assert.deepEqual(resolved.args, ["run", "test"]);
});
