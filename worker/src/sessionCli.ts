#!/usr/bin/env node
import path from "node:path";
import { runSession } from "./sessionRunner";

const CLI_PREFIX = "[SessionCLI]";
const USAGE_MESSAGE = "Usage: node dist/sessionCli.js <session-config.json> [--allow-dirty]";
const DIRTY_TREE_MESSAGE =
  "Please commit or stash your changes before running a session (or pass --allow-dirty).";
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

type SessionCliArgs = {
  configArg?: string;
  allowDirty: boolean;
  extras: string[];
};

const log = (...messages: unknown[]) => console.log(CLI_PREFIX, ...messages);
const warn = (...messages: unknown[]) => console.warn(CLI_PREFIX, ...messages);
const error = (...messages: unknown[]) => console.error(CLI_PREFIX, ...messages);

function exitWithUsage(): never {
  error(USAGE_MESSAGE);
  process.exit(1);
}

function exitWithFailure(message: string, err: unknown): never {
  error(message, err);
  process.exit(1);
}

function parseArgs(argv: string[]): SessionCliArgs {
  const result: SessionCliArgs = { configArg: undefined, allowDirty: false, extras: [] };

  for (const arg of argv) {
    if (arg === "--allow-dirty") {
      result.allowDirty = true;
      continue;
    }

    if (!result.configArg) {
      result.configArg = arg;
      continue;
    }

    result.extras.push(arg);
  }

  return result;
}

function resolveConfigPath(configArg?: string): string {
  if (!configArg) {
    exitWithUsage();
  }
  return path.resolve(process.cwd(), configArg);
}

async function main() {
  const { allowDirty, extras, configArg } = parseArgs(process.argv.slice(2));
  const configPath = resolveConfigPath(configArg);

  if (extras.length > 0) {
    warn("Ignoring unexpected arguments:", extras.join(", "));
  }

  try {
    const result = await runSession(configPath, {
      allowDirty,
      repoRoot: PROJECT_ROOT,
      gitCheckMessage: DIRTY_TREE_MESSAGE,
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    exitWithFailure("Failed to run session:", err);
  }
}

main().catch((err) => exitWithFailure("Unhandled error:", err));
