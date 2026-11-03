import { exec } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(exec);

function normalizeOutput(out: string | undefined): string {
  return (out || "").trim();
}

export async function runBuildCheck(projectRoot: string): Promise<string> {
  const { stdout, stderr } = await run("npm run build", { cwd: projectRoot, maxBuffer: 4 * 1024 * 1024 });
  return [stdout, stderr].map(normalizeOutput).filter(Boolean).join("\n");
}

export async function runTypeCheck(projectRoot: string): Promise<string> {
  const { stdout, stderr } = await run("npx tsc --noEmit", { cwd: projectRoot, maxBuffer: 4 * 1024 * 1024 });
  return [stdout, stderr].map(normalizeOutput).filter(Boolean).join("\n");
}

export async function runTestCheck(projectRoot: string): Promise<string> {
  const { stdout, stderr } = await run("npm test --silent", { cwd: projectRoot, maxBuffer: 4 * 1024 * 1024 });
  return [stdout, stderr].map(normalizeOutput).filter(Boolean).join("\n");
}
