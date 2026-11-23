import { spawn } from "node:child_process";
import { once } from "node:events";
import { createLogger } from "./logger";

export type CommandResult = {
  name?: string;
  cmd: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

const log = createLogger("CommandRunner");

export async function runCommand(
  cwd: string,
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<CommandResult> {
  const startedAt = new Date();
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    env: process.env,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let timeout: NodeJS.Timeout | undefined;
  const timeoutMs = opts.timeoutMs;
  const timeoutPromise =
    timeoutMs !== undefined
      ? new Promise<void>((_, reject) => {
          timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      : null;

  try {
    if (timeoutPromise) {
      await Promise.race([once(child, "exit"), timeoutPromise]);
    } else {
      await once(child, "exit");
    }
  } catch (err) {
    // ensure process is killed if timeout
    child.kill("SIGKILL");
    const finishedAt = new Date();
    return {
      name: undefined,
      cmd: `${cmd} ${args.join(" ")}`.trim(),
      cwd,
      exitCode: null,
      stdout,
      stderr: stderr || (err instanceof Error ? err.message : String(err)),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const finishedAt = new Date();
  const exitCode = child.exitCode;

  return {
    name: undefined,
    cmd: `${cmd} ${args.join(" ")}`.trim(),
    cwd,
    exitCode,
    stdout,
    stderr,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

const CHECK_MAP: Record<string, { cmd: string; args: string[] }> = {
  tsc: { cmd: "npx", args: ["tsc", "-p", "tsconfig.json"] },
  "npm-test": { cmd: "npm", args: ["test"] },
  lint: { cmd: "npm", args: ["run", "lint"] },
};

export async function runChecks(projectRoot: string, checks: string[]): Promise<CommandResult[]> {
  const results: CommandResult[] = [];

  for (const check of checks) {
    const mapping = CHECK_MAP[check];
    if (!mapping) {
      log.warn(`Unknown check '${check}', skipping`);
      results.push({
        name: check,
        cmd: check,
        cwd: projectRoot,
        exitCode: null,
        stdout: "",
        stderr: `Unknown check: ${check}`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      });
      continue;
    }

    try {
      const result = await runCommand(projectRoot, mapping.cmd, mapping.args);
      result.name = check;
      results.push(result);
    } catch (error) {
      const now = new Date();
      results.push({
        name: check,
        cmd: `${mapping.cmd} ${mapping.args.join(" ")}`.trim(),
        cwd: projectRoot,
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationMs: 0,
      });
    }
  }

  return results;
}
