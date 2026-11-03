/**
 * Unit tests for the coder patch pipeline functions:
 *   fixDiffHunkCounts     – recalculates @@ hunk headers after AI mutations
 *   stripSpuriousRemovedLines – removes hallucinated "-" lines not in target file
 *
 * These tests run without a live server (pure logic, no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { __test__ } from "@/app/api/os/code/run/route";

const { fixDiffHunkCounts, stripSpuriousRemovedLines } = __test__;

// ── fixDiffHunkCounts ─────────────────────────────────────────────────────────

test("fixDiffHunkCounts: preserves correct single-hunk diff unchanged", () => {
  const diff = [
    "diff --git a/foo.ts b/foo.ts",
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "@@ -1,3 +1,3 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " const c = 4;",
    "",
  ].join("\n");

  const result = fixDiffHunkCounts(diff);
  assert.ok(result.includes("@@ -1,3 +1,3 @@"), "hunk header must be unchanged for a correct diff");
});

test("fixDiffHunkCounts: recalculates inflated hunk count from trailing newline", () => {
  // AI often produces hunk headers with off-by-one counts due to trailing "\n" in split.
  const diff = [
    "diff --git a/foo.ts b/foo.ts",
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "@@ -1,99 +1,99 @@",   // deliberately wrong
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " const c = 4;",
    "",
  ].join("\n");

  const result = fixDiffHunkCounts(diff);
  // 3 context/removed lines, 3 context/added lines → -1,3 +1,3
  assert.ok(result.includes("@@ -1,3 +1,3 @@"), `expected fixed header, got: ${result}`);
});

test("fixDiffHunkCounts: handles pure-addition hunk (no removed lines)", () => {
  const diff = [
    "diff --git a/new.ts b/new.ts",
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1,99 @@",   // wrong count
    "+export const x = 1;",
    "+export const y = 2;",
    "",
  ].join("\n");

  const result = fixDiffHunkCounts(diff);
  assert.ok(result.includes("@@ -0,0 +1,2 @@"), `expected -0,0 +1,2, got: ${result}`);
});

test("fixDiffHunkCounts: handles multi-hunk diff", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,99 +1,99 @@",  // wrong
    " line1",
    "-line2",
    "+line2fixed",
    "@@ -10,99 +10,99 @@",  // wrong
    " line10",
    "+line10b",
    "",
  ].join("\n");

  const result = fixDiffHunkCounts(diff);
  // First hunk: 1 context + 1 removed = 2 old; 1 context + 1 added = 2 new.
  assert.ok(result.includes("@@ -1,2 +1,2 @@"), `first hunk wrong: ${result}`);
  // Second hunk: 1 context + 0 removed = 1 old; 1 context + 1 added = 2 new.
  assert.ok(result.includes("@@ -10,1 +10,2 @@"), `second hunk wrong: ${result}`);
});

test("fixDiffHunkCounts: ends with newline", () => {
  const diff = "@@ -1,1 +1,1 @@\n context\n";
  const result = fixDiffHunkCounts(diff);
  assert.ok(result.endsWith("\n"), "output must end with newline for git apply");
});

// ── stripSpuriousRemovedLines ─────────────────────────────────────────────────

test("stripSpuriousRemovedLines: keeps valid removed lines that exist in file", () => {
  const fileContent = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
  const diff = [
    "@@ -1,3 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    " const c = 3;",
  ].join("\n");

  const result = stripSpuriousRemovedLines(diff, fileContent);
  assert.ok(result.includes("-const b = 2;"), "valid removed line must be preserved");
});

test("stripSpuriousRemovedLines: removes hallucinated removed lines absent from file", () => {
  const fileContent = "const a = 1;\nconst c = 3;\n";
  const diff = [
    "@@ -1,3 +1,2 @@",
    " const a = 1;",
    "-const b_HALLUCINATED = 2;",  // not in file
    " const c = 3;",
  ].join("\n");

  const result = stripSpuriousRemovedLines(diff, fileContent);
  assert.ok(!result.includes("-const b_HALLUCINATED"), "spurious removed line must be stripped");
  assert.ok(result.includes(" const a = 1;"), "context lines must be preserved");
});

test("stripSpuriousRemovedLines: never strips diff file headers (--- lines)", () => {
  const fileContent = "const a = 1;\n";
  const diff = [
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "@@ -1,1 +1,1 @@",
    "-const a = 1;",
    "+const a = 2;",
  ].join("\n");

  const result = stripSpuriousRemovedLines(diff, fileContent);
  assert.ok(result.includes("--- a/foo.ts"), "diff header must never be removed");
});

test("stripSpuriousRemovedLines: pure-whitespace removed line is NOT confused with blank line", () => {
  // File has blank lines ("") but not lines of trailing spaces ("   ").
  // The trimEnd bug: "   ".trimEnd() === "" matches "" in the file → spurious line survives.
  // The fix: only use trimEnd fallback when trimmed is non-empty.
  const fileContent = "const a = 1;\n\nconst b = 2;\n";
  const diff = [
    "@@ -1,3 +1,3 @@",
    " const a = 1;",
    "-   ",             // 3 trailing spaces — hallucinated, NOT in file
    " const b = 2;",
  ].join("\n");

  const result = stripSpuriousRemovedLines(diff, fileContent);
  assert.ok(!result.includes("-   "), "whitespace-only removed line must be stripped (not confused with blank line)");
});

test("stripSpuriousRemovedLines: blank line removal is preserved when blank lines exist in file", () => {
  const fileContent = "const a = 1;\n\nconst b = 2;\n";
  const diff = [
    "@@ -1,3 +1,2 @@",
    " const a = 1;",
    "-",               // blank line — exists in file
    " const b = 2;",
  ].join("\n");

  const result = stripSpuriousRemovedLines(diff, fileContent);
  assert.ok(result.includes("-\n"), "blank line removal must be kept when blank line exists in file");
});

test("stripSpuriousRemovedLines: trimEnd fallback matches line with trailing space when file has it", () => {
  // If the file actually has a line with trailing space AND it's being removed, keep it.
  const fileContent = "const a = 1;   \nconst b = 2;\n"; // trailing spaces in line 1
  const diff = [
    "@@ -1,2 +1,1 @@",
    "-const a = 1;   ",   // trailing spaces — exists in file (trimEnd match: non-empty)
    " const b = 2;",
  ].join("\n");

  const result = stripSpuriousRemovedLines(diff, fileContent);
  assert.ok(result.includes("-const a = 1;   "), "line with trailing space must be kept if it exists in file");
});
