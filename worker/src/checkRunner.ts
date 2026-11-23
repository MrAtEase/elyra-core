import { exec } from "node:child_process";
import { promisify } from "node:util";
import { CheckDefinition, CheckResult } from "./devTaskTypes";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const SNIPPET_LIMIT = 800;

function makeSnippet(output: string | undefined): string | undefined {
  if (!output) return undefined;
  if (output.length <= SNIPPET_LIMIT) return output;
  return `${output.slice(0, SNIPPET_LIMIT)}…`;
}

export async function runChecksForTask(
  definitions: CheckDefinition[] = []
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const def of definitions) {
    if (def.enabled === false) {
      results.push({
        kind: def.kind,
        name: def.name,
        command: def.command,
        cwd: def.cwd,
        status: "skipped",
        exitCode: null,
        durationMs: null,
      });
      continue;
    }

    const started = Date.now();
    let status: CheckResult["status"] = "running";
    let exitCode: number | null = null;
    let stdoutSnippet: string | undefined;
    let stderrSnippet: string | undefined;
    let errorMessage: string | undefined;

    try {
      const { stdout, stderr } = await execAsync(def.command, {
        cwd: def.cwd,
        timeout: def.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      });
      stdoutSnippet = makeSnippet(stdout);
      stderrSnippet = makeSnippet(stderr);
      exitCode = 0;
      status = "passed";
    } catch (err: any) {
      stdoutSnippet = makeSnippet(err?.stdout);
      stderrSnippet = makeSnippet(err?.stderr);
      exitCode = typeof err?.code === "number" ? err.code : null;
      errorMessage = err?.message || "Check failed";
      if (err?.killed && err?.signal === "SIGTERM") {
        errorMessage = "Check timed out";
      }
      status = exitCode === 0 ? "passed" : "failed";
      if (err?.code === undefined && err?.signal) {
        status = "error";
      }
    }

    const durationMs = Date.now() - started;

    results.push({
      kind: def.kind,
      name: def.name,
      command: def.command,
      cwd: def.cwd,
      status,
      exitCode,
      durationMs,
      stdoutSnippet,
      stderrSnippet,
      errorMessage,
    });
  }

  return results;
}
