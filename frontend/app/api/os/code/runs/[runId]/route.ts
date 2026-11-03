import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

function resolveStoreRoot() {
  const repoRoot = path.resolve(process.cwd(), "..");
  return path.join(repoRoot, ".run", "code-runs");
}

function sanitizeRunId(input: string): string {
  return input.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const params = await context.params;
  const runId = sanitizeRunId(params.runId || "");
  if (!runId) {
    return NextResponse.json({ ok: false, error: "Invalid run id." }, { status: 400 });
  }

  const root = resolveStoreRoot();
  const filePath = path.join(root, "records", `${runId}.json`);
  if (!(await pathExists(filePath))) {
    return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
  }

  const raw = await readFile(filePath, "utf8").catch(() => "");
  if (!raw) {
    return NextResponse.json({ ok: false, error: "Run record is unreadable." }, { status: 500 });
  }

  const parsed = JSON.parse(raw) as {
    id: string;
    workspaceId: string;
    artifact?: Record<string, unknown>;
    [key: string]: unknown;
  };
  const workspaceIdQuery = request.nextUrl.searchParams.get("workspaceId")?.trim() ?? "";
  const recordWorkspaceId =
    typeof parsed.workspaceId === "string" ? parsed.workspaceId.trim() : "";
  if (workspaceIdQuery && recordWorkspaceId && recordWorkspaceId !== workspaceIdQuery) {
    return NextResponse.json({ ok: false, error: "Run does not belong to this workspace." }, { status: 403 });
  }
  if (!parsed?.artifact || typeof parsed.artifact !== "object") {
    return NextResponse.json({ ok: false, error: "Run artifact not available." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    run: parsed,
    artifact: parsed.artifact,
  });
}
