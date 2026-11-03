import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";

const execFileAsync = promisify(execFile);

type PromotionStage = "playground" | "dev" | "prod";

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveRepoRoot(repoUrl: string): Promise<string> {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    throw new Error("Repository path is required.");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: trimmed });
  const root = stdout.trim();
  if (!root) {
    throw new Error("Unable to resolve git repository root.");
  }
  return root;
}

async function resolveStageRoot(repoUrl: string, stage: PromotionStage): Promise<string> {
  const trimmed = repoUrl.trim();
  const repoRoot = await resolveRepoRoot(trimmed);
  if (stage !== "playground") {
    return trimmed;
  }
  const relativeWorkdir = path.relative(repoRoot, trimmed);
  const playgroundRoot = path.join(repoRoot, ".run", "playground");
  return relativeWorkdir && relativeWorkdir !== "."
    ? path.join(playgroundRoot, relativeWorkdir)
    : playgroundRoot;
}

function sanitizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Invalid file path.");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) {
    throw new Error("Parent traversal is not allowed.");
  }
  return parts.join("/");
}

async function resolveFilePath(repoUrl: string, stage: PromotionStage, filePath: string): Promise<{ stageRoot: string; absolutePath: string; relativePath: string }> {
  const stageRoot = await resolveStageRoot(repoUrl, stage);
  const relativePath = sanitizeRelativePath(filePath);
  const absolutePath = path.resolve(stageRoot, relativePath);
  const relativeFromRoot = path.relative(stageRoot, absolutePath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error("Resolved file path is outside the allowed repository root.");
  }
  return { stageRoot, absolutePath, relativePath };
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

export async function GET(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;

  const repoUrl = request.nextUrl.searchParams.get("repoUrl")?.trim() ?? "";
  const stageParam = request.nextUrl.searchParams.get("stage")?.trim() ?? "playground";
  const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  const stage: PromotionStage =
    stageParam === "dev" || stageParam === "prod" ? stageParam : "playground";

  if (!repoUrl || !filePath) {
    return NextResponse.json({ ok: false, error: "repoUrl and path are required." }, { status: 400 });
  }

  try {
    const resolved = await resolveFilePath(repoUrl, stage, filePath);
    if (!(await pathExists(resolved.absolutePath))) {
      return NextResponse.json({ ok: false, error: "File not found." }, { status: 404 });
    }
    const content = await readFile(resolved.absolutePath, "utf8");
    return NextResponse.json({
      ok: true,
      filePath: resolved.relativePath,
      stage,
      repoUrl,
      content,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to read file." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const authFailure = await authorizeWorkspace(request);
  if (authFailure) return authFailure;

  const body = (await request.json().catch(() => null)) as
    | { repoUrl?: unknown; stage?: unknown; filePath?: unknown; content?: unknown }
    | null;
  const repoUrl = typeof body?.repoUrl === "string" ? body.repoUrl.trim() : "";
  const filePath = typeof body?.filePath === "string" ? body.filePath.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  const stageParam = typeof body?.stage === "string" ? body.stage.trim() : "playground";
  const stage: PromotionStage =
    stageParam === "dev" || stageParam === "prod" ? stageParam : "playground";

  if (!repoUrl || !filePath) {
    return NextResponse.json({ ok: false, error: "repoUrl and filePath are required." }, { status: 400 });
  }
  if (stage !== "playground") {
    return NextResponse.json({ ok: false, error: "Manual editor saves are only allowed in playground." }, { status: 400 });
  }

  try {
    const resolved = await resolveFilePath(repoUrl, stage, filePath);
    await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await writeFile(resolved.absolutePath, content, "utf8");
    return NextResponse.json({
      ok: true,
      filePath: resolved.relativePath,
      stage,
      repoUrl,
      saved: true,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to write file." },
      { status: 500 },
    );
  }
}
