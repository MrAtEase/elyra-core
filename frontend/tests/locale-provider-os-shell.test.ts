/**
 * Regression test: LocaleProvider must NOT depend on WorkspaceProvider.
 *
 * History: CodingAgentWindow called useLocale(), which needs LocaleProvider, which
 * called useWorkspaceData() — but the OS shell layout (/os/code) never mounted
 * WorkspaceProvider, causing a runtime crash:
 *   "useLocale must be used within a LocaleProvider"
 *
 * Fix:
 *   1. LocaleProvider now uses useWorkspaceDataOptional() (returns null when absent)
 *   2. WorkspaceOS mounts LocaleProvider so all /os/* routes have locale access.
 *
 * This test guards both invariants at the source-code level (no server needed).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");

async function readSrc(relPath: string): Promise<string> {
  return readFile(path.join(ROOT, relPath), "utf8");
}

test("LocaleProvider uses useWorkspaceDataOptional, not useWorkspaceData", async () => {
  const src = await readSrc("components/providers/LocaleProvider.tsx");
  assert.ok(
    src.includes("useWorkspaceDataOptional"),
    "LocaleProvider must import useWorkspaceDataOptional so it works outside WorkspaceProvider"
  );
  assert.ok(
    !src.includes("useWorkspaceData()"),
    "LocaleProvider must NOT call useWorkspaceData() (throws when WorkspaceProvider is absent)"
  );
});

test("WorkspaceContext exports useWorkspaceDataOptional", async () => {
  const src = await readSrc("components/workspace/WorkspaceContext.tsx");
  assert.ok(
    src.includes("export function useWorkspaceDataOptional"),
    "WorkspaceContext must export useWorkspaceDataOptional for components outside WorkspaceProvider"
  );
});

test("WorkspaceOS mounts LocaleProvider so all OS shell routes have locale access", async () => {
  const src = await readSrc("components/os/shell/WorkspaceOS.tsx");
  assert.ok(
    src.includes("LocaleProvider"),
    "WorkspaceOS must render <LocaleProvider> so /os/* routes don't crash on useLocale()"
  );
  assert.ok(
    src.includes("from \"@/components/providers/LocaleProvider\""),
    "WorkspaceOS must import LocaleProvider from the correct path"
  );
});

test("CodingAgentWindow lives under the OS shell path that now has LocaleProvider", async () => {
  // Guard that CodingAgentWindow is still a child of the /os/code page
  // (if it moves, the locale fix may need to be re-evaluated).
  const pageSrc = await readSrc("app/os/code/page.tsx");
  assert.ok(
    pageSrc.includes("CodingAgentWindow"),
    "app/os/code/page.tsx must still render CodingAgentWindow"
  );
  // Guard that the OS layout file still renders WorkspaceOS (which carries LocaleProvider)
  const layoutSrc = await readSrc("app/os/layout.tsx");
  assert.ok(
    layoutSrc.includes("WorkspaceOS"),
    "app/os/layout.tsx must still render WorkspaceOS (which mounts LocaleProvider)"
  );
});
