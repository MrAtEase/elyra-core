import { logger } from "../lib/logger.js";

type ToolExecutor = (
  input: Record<string, unknown>,
  workspaceId: string,
) => Promise<Record<string, unknown>>;

const tools = new Map<string, ToolExecutor>();

export function registerTool(name: string, executor: ToolExecutor): void {
  tools.set(name, executor);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const executor = tools.get(name);
  if (!executor) {
    logger.warn({ tool: name }, "Unknown tool, using passthrough");
    return { text: `Tool "${name}" not implemented yet`, input };
  }
  return executor(input, workspaceId);
}

export function listTools(): string[] {
  return [...tools.keys()];
}
