import { NextRequest, NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(process.cwd(), "..");
const RUN_DIR = path.join(ROOT_DIR, ".run");
const LOG_DIR = path.join(ROOT_DIR, ".logs");
const CODE_OSS_PORT = 3390;
const CODE_OSS_PID_FILE = path.join(RUN_DIR, "code-oss.pid");
const CODE_OSS_META_FILE = path.join(RUN_DIR, "code-oss.json");
const CODE_OSS_CONFIG_FILE = path.join(RUN_DIR, "code-oss-config.yaml");
const CODE_OSS_DATA_DIR = path.join(RUN_DIR, "code-oss-data");
const CODE_OSS_EXT_DIR = path.join(RUN_DIR, "code-oss-extensions");
const CODE_OSS_LOG_FILE = path.join(LOG_DIR, "code-oss.log");
const CODE_OSS_USER_DIR = path.join(CODE_OSS_DATA_DIR, "User");
const CODE_OSS_SETTINGS_FILE = path.join(CODE_OSS_USER_DIR, "settings.json");
const CODE_OSS_URL = `http://127.0.0.1:${CODE_OSS_PORT}`;
const ENSURE_SCRIPT = path.join(ROOT_DIR, "scripts", "ensure-code-oss.sh");

type IdeMeta = {
  repoUrl: string;
  workspaceId?: string;
  startedAt: string;
  pid: number;
};

const CODE_OSS_DEFAULT_SETTINGS: Record<string, unknown> = {
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "window.commandCenter": false,
  "workbench.layoutControl.enabled": false,
  "workbench.editor.empty.hint": "hidden",
  "workbench.editor.enablePreview": false,
  "explorer.openEditors.visible": 0,
  "chat.commandCenter.enabled": false,
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.iconTheme": "vs-seti",
  "breadcrumbs.enabled": true,
  "editor.minimap.enabled": false,
  "editor.fontLigatures": true,
  "editor.fontSize": 13,
  "editor.lineHeight": 1.6,
  "security.workspace.trust.enabled": false,
};

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function authorizeWorkspace(request: NextRequest): Promise<NextResponse | null> {
  const workspaceId = request.headers.get("x-workspace-id")?.trim() ?? "";
  if (!workspaceId) {
    return null;
  }
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }
  return null;
}

function readMeta(): IdeMeta | null {
  try {
    const raw = readFileSync(CODE_OSS_META_FILE, "utf8");
    const parsed = JSON.parse(raw) as IdeMeta;
    if (!parsed || typeof parsed.pid !== "number" || !parsed.repoUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMeta(meta: IdeMeta): void {
  writeFileSync(CODE_OSS_META_FILE, JSON.stringify(meta, null, 2), "utf8");
  writeFileSync(CODE_OSS_PID_FILE, String(meta.pid), "utf8");
}

function clearMeta(): void {
  if (existsSync(CODE_OSS_META_FILE)) unlinkSync(CODE_OSS_META_FILE);
  if (existsSync(CODE_OSS_PID_FILE)) unlinkSync(CODE_OSS_PID_FILE);
}

async function writeCodeOssUserSettings(): Promise<void> {
  await mkdir(CODE_OSS_USER_DIR, { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(CODE_OSS_SETTINGS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(CODE_OSS_SETTINGS_FILE, "utf8")) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") existing = parsed;
    } catch {}
  }
  writeFileSync(CODE_OSS_SETTINGS_FILE, JSON.stringify({ ...existing, ...CODE_OSS_DEFAULT_SETTINGS }, null, 2), "utf8");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isCodeOssHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${CODE_OSS_URL}/`, { redirect: "manual" });
    return response.status === 200 || response.status === 302;
  } catch {
    return false;
  }
}

async function ensureCodeOssBinary(): Promise<string> {
  const { stdout } = await execFileAsync("bash", [ENSURE_SCRIPT], {
    cwd: ROOT_DIR,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const binary = stdout.trim();
  if (!binary || !existsSync(binary)) {
    throw new Error("Code-OSS binary is not available.");
  }
  return binary;
}

async function stopCodeOss(): Promise<void> {
  const meta = readMeta();
  if (meta?.pid && isProcessAlive(meta.pid)) {
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {}
  }
  clearMeta();
}

async function waitForHealthy(timeoutMs = 45_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isCodeOssHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Code-OSS did not become healthy in time.");
}

async function startCodeOss(repoUrl: string, workspaceId?: string): Promise<IdeMeta> {
  const binary = await ensureCodeOssBinary();
  await mkdir(RUN_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(CODE_OSS_DATA_DIR, { recursive: true });
  await mkdir(CODE_OSS_EXT_DIR, { recursive: true });
  await writeCodeOssUserSettings();
  writeFileSync(
    CODE_OSS_CONFIG_FILE,
    `bind-addr: 127.0.0.1:${CODE_OSS_PORT}\nauth: none\nuser-data-dir: ${CODE_OSS_DATA_DIR}\nextensions-dir: ${CODE_OSS_EXT_DIR}\n`,
    "utf8",
  );
  const logFd = openSync(CODE_OSS_LOG_FILE, "a");
  const env = {
    ...process.env,
    HOME: process.env.HOME || ROOT_DIR,
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: process.env.SHELL || "/bin/zsh",
    PORT: String(CODE_OSS_PORT),
  };
  delete (env as any).npm_config_port;

  const child = spawn(
    binary,
    [
      "--config",
      CODE_OSS_CONFIG_FILE,
      "--auth",
      "none",
      "--disable-telemetry",
      "--disable-update-check",
      "--bind-addr",
      `127.0.0.1:${CODE_OSS_PORT}`,
      "--user-data-dir",
      CODE_OSS_DATA_DIR,
      "--extensions-dir",
      CODE_OSS_EXT_DIR,
      repoUrl,
    ],
    {
      cwd: repoUrl,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env,
    },
  );
  child.unref();

  const meta: IdeMeta = {
    repoUrl,
    ...(workspaceId ? { workspaceId } : {}),
    startedAt: new Date().toISOString(),
    pid: child.pid!,
  };
  writeMeta(meta);
  await waitForHealthy();
  return meta;
}

function buildIdeUrl(repoUrl: string): string {
  return `${CODE_OSS_URL}/?folder=${encodeURIComponent(repoUrl)}&payload=${encodeURIComponent(
    JSON.stringify({ workbench: { panel: false } }),
  )}`;
}

export async function GET(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;

  const repoUrl = trimString(request.nextUrl.searchParams.get("repoUrl"));
  const meta = readMeta();
  const running = Boolean(meta?.pid && isProcessAlive(meta.pid));
  const healthy = running ? await isCodeOssHealthy() : false;

  if (!running && meta) {
    clearMeta();
  }

  return NextResponse.json({
    ok: true,
    running: healthy,
    healthy,
    repoUrl: meta?.repoUrl ?? repoUrl,
    url: healthy ? buildIdeUrl(meta?.repoUrl ?? repoUrl) : null,
    pid: meta?.pid ?? null,
  });
}

export async function POST(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;

  const body = (await request.json().catch(() => null)) as { repoUrl?: unknown; workspaceId?: unknown } | null;
  const repoUrl = trimString(body?.repoUrl);
  const workspaceId = trimString(body?.workspaceId) || undefined;
  if (!repoUrl || !existsSync(repoUrl)) {
    return NextResponse.json({ ok: false, error: "A valid local repository path is required." }, { status: 400 });
  }

  const existing = readMeta();
  const running = Boolean(existing?.pid && isProcessAlive(existing.pid));
  const healthy = running ? await isCodeOssHealthy() : false;
  if (existing && healthy && existing.repoUrl === repoUrl) {
    return NextResponse.json({
      ok: true,
      running: true,
      healthy: true,
      repoUrl,
      url: buildIdeUrl(repoUrl),
      reused: true,
    });
  }

  await stopCodeOss();
  const started = await startCodeOss(repoUrl, workspaceId);
  return NextResponse.json({
    ok: true,
    running: true,
    healthy: true,
    repoUrl: started.repoUrl,
    url: buildIdeUrl(started.repoUrl),
    reused: false,
  });
}

export async function DELETE(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;
  await stopCodeOss();
  return NextResponse.json({ ok: true, stopped: true });
}
