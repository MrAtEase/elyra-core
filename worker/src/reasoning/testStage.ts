import { runCommand, CommandResult } from "../commandRunner";

export interface TestStageResult {
  passed: boolean;
  errors: CommandResult[];
}

export async function testStage(projectRoot: string, commands: string[]): Promise<TestStageResult> {
  const results: CommandResult[] = [];
  for (const cmd of commands) {
    const parts = cmd.split(" ").filter(Boolean);
    const [c, ...args] = parts;
    try {
      const result = await runCommand(projectRoot, c, args);
      results.push(result);
      if ((result.exitCode ?? 1) !== 0) {
        return { passed: false, errors: results };
      }
    } catch (err) {
      results.push({
        name: cmd,
        cmd,
        cwd: projectRoot,
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      });
      return { passed: false, errors: results };
    }
  }
  return { passed: true, errors: results };
}
