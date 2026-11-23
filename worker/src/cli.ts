import path from "path";
import { promises as fs } from "fs";
import { runDevTask } from "./devTaskRunner";
import { DevTask } from "./devTaskTypes";

async function loadTask(taskPath: string): Promise<DevTask> {
  const resolvedPath = path.resolve(taskPath);
  const content = await fs.readFile(resolvedPath, "utf8");
  try {
    return JSON.parse(content) as DevTask;
  } catch (error) {
    throw new Error(`Failed to parse task JSON at ${resolvedPath}: ${error}`);
  }
}

function printUsage(): void {
  console.error("Usage: node dist/cli.js path/to/task.json");
}

async function main(): Promise<void> {
  const taskArg = process.argv[2];
  if (!taskArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const task = await loadTask(taskArg);
    const result = await runDevTask(task);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("[CLI] Error:", error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[CLI] Unexpected error:", error);
  process.exitCode = 1;
});
