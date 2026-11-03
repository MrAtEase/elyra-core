import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";

const execFileAsync = promisify(execFile);

type WorkspaceSettings = Record<string, unknown>;

const DEFAULT_VERTEX_PROJECT = "elyra-core-dev-app";
const DEFAULT_VERTEX_LOCATION = "global";

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function authorizeWorkspace(request: NextRequest): Promise<NextResponse | null> {
  const workspaceId = request.headers.get("x-workspace-id")?.trim() ?? "";
  if (!workspaceId) return null;
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }
  return null;
}

function resolveGeminiCliBinary(): string | null {
  const explicit = trimString(process.env.GEMINI_CLI_PATH);
  if (explicit && existsSync(explicit)) return explicit;
  const home = trimString(process.env.HOME);
  const candidates = [
    home ? path.join(home, ".nvm", "versions", "node", "v20.19.5", "bin", "gemini") : "",
    home ? path.join(home, ".nvm", "versions", "node", "current", "bin", "gemini") : "",
    "/opt/homebrew/bin/gemini",
    "/usr/local/bin/gemini",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function geminiCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const geminiApiKey = trimString(process.env.GEMINI_API_KEY);
  if (geminiApiKey) {
    env.GEMINI_API_KEY = geminiApiKey;
    env.GEMINI_DEFAULT_AUTH_TYPE = "gemini-api-key";
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_LOCATION;
    return env;
  }
  env.GOOGLE_GENAI_USE_VERTEXAI = trimString(process.env.GOOGLE_GENAI_USE_VERTEXAI) || "true";
  env.GOOGLE_CLOUD_PROJECT = trimString(process.env.GOOGLE_CLOUD_PROJECT) || DEFAULT_VERTEX_PROJECT;
  env.GOOGLE_CLOUD_LOCATION = trimString(process.env.GOOGLE_CLOUD_LOCATION) || DEFAULT_VERTEX_LOCATION;
  return env;
}

function resolveRepoUrl(value: unknown): string {
  return typeof value === "string" ? path.resolve(value.trim()) : "";
}

function workspaceDir(repoUrl: string): string {
  return path.join(repoUrl, ".gemini");
}

function workspaceSettingsPath(repoUrl: string): string {
  return path.join(workspaceDir(repoUrl), "settings.json");
}

function projectGuidePath(repoUrl: string): string {
  return path.join(repoUrl, "GEMINI.md");
}

function readWorkspaceSettings(repoUrl: string): WorkspaceSettings {
  const filePath = workspaceSettingsPath(repoUrl);
  if (!repoUrl || !existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as WorkspaceSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function checkpointingEnabled(settings: WorkspaceSettings): boolean {
  const general = settings.general;
  if (!general || typeof general !== "object") return false;
  const checkpointing = (general as WorkspaceSettings).checkpointing;
  if (!checkpointing || typeof checkpointing !== "object") return false;
  return (checkpointing as WorkspaceSettings).enabled === true;
}

function readMcpServerNames(settings: WorkspaceSettings): string[] {
  const mcpServers = settings.mcpServers;
  if (!mcpServers || typeof mcpServers !== "object") return [];
  return Object.keys(mcpServers as WorkspaceSettings).sort();
}

function ensureWorkspaceDir(repoUrl: string): void {
  mkdirSync(workspaceDir(repoUrl), { recursive: true });
}

function writeWorkspaceSettings(
  repoUrl: string,
  updater: (current: WorkspaceSettings) => WorkspaceSettings,
): WorkspaceSettings {
  ensureWorkspaceDir(repoUrl);
  const next = updater(readWorkspaceSettings(repoUrl));
  writeFileSync(workspaceSettingsPath(repoUrl), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function projectGuideExists(repoUrl: string): boolean {
  return existsSync(projectGuidePath(repoUrl));
}

async function loadCliMcpServers(binary: string, repoUrl: string): Promise<string[]> {
  const { stdout } = await execFileAsync(binary, ["mcp", "list"], {
    cwd: repoUrl,
    env: geminiCliEnv(),
    timeout: 3_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;

  const repoUrl = resolveRepoUrl(request.nextUrl.searchParams.get("repoUrl")) || process.cwd();
  const binary = resolveGeminiCliBinary();
  const settings = readWorkspaceSettings(repoUrl);
  const configuredServers = readMcpServerNames(settings);
  const payloadBase = {
    configured: Boolean(binary),
    checkpointingEnabled: checkpointingEnabled(settings),
    settingsPath: workspaceSettingsPath(repoUrl),
    projectGuideExists: projectGuideExists(repoUrl),
  };

  if (!binary) {
    return NextResponse.json({
      ok: false,
      ...payloadBase,
      servers: configuredServers,
      error: "Gemini CLI is not available.",
    });
  }

  let cliServers: string[] = [];
  let errorMessage: string | undefined;
  try {
    cliServers = await loadCliMcpServers(binary, repoUrl);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unable to load MCP servers.";
  }
  const servers = [...new Set([...configuredServers, ...cliServers])];
  return NextResponse.json({
    ok: errorMessage ? false : true,
    ...payloadBase,
    servers,
    ...(errorMessage ? { error: errorMessage } : {}),
  });
}

export async function POST(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;

  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        repoUrl?: unknown;
        name?: unknown;
        command?: unknown;
        args?: unknown;
      }
    | null;

  const action = trimString(body?.action);
  const repoUrl = resolveRepoUrl(body?.repoUrl) || process.cwd();
  if (!repoUrl || !existsSync(repoUrl)) {
    return NextResponse.json({ ok: false, error: "A valid repoUrl is required." }, { status: 400 });
  }

  try {
    if (action === "enableCheckpointing") {
      const next = writeWorkspaceSettings(repoUrl, (current) => {
        const general =
          typeof current.general === "object" && current.general
            ? (current.general as WorkspaceSettings)
            : {};
        const checkpointing =
          typeof general.checkpointing === "object" && general.checkpointing
            ? (general.checkpointing as WorkspaceSettings)
            : {};
        return {
          ...current,
          general: {
            ...general,
            checkpointing: {
              ...checkpointing,
              enabled: true,
            },
          },
        };
      });
      return NextResponse.json({
        ok: true,
        checkpointingEnabled: checkpointingEnabled(next),
        settingsPath: workspaceSettingsPath(repoUrl),
      });
    }

    if (action === "addServer") {
      const binary = resolveGeminiCliBinary();
      if (!binary) {
        return NextResponse.json({ ok: false, error: "Gemini CLI is not available." }, { status: 400 });
      }
      const name = trimString(body?.name);
      const command = trimString(body?.command);
      const args = Array.isArray(body?.args) ? body.args.map((value) => String(value)) : [];
      if (!name || !command) {
        return NextResponse.json({ ok: false, error: "name and command are required." }, { status: 400 });
      }
      await execFileAsync(binary, ["mcp", "add", "--scope", "project", name, command, ...args], {
        cwd: repoUrl,
        env: geminiCliEnv(),
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const settings = readWorkspaceSettings(repoUrl);
      return NextResponse.json({
        ok: true,
        servers: readMcpServerNames(settings),
        checkpointingEnabled: checkpointingEnabled(settings),
      });
    }

    return NextResponse.json({ ok: false, error: "Unsupported MCP action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to update MCP configuration." },
      { status: 500 },
    );
  }
}
