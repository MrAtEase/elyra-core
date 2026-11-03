import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type RunStage = "playground" | "dev" | "prod";
type RunStatus = "planning" | "running" | "failed" | "completed";

type RunSummary = {
  id: string;
  workspaceId: string;
  app: "code" | "orchestrator";
  agent: string;
  task: string;
  repoUrl: string;
  branch: string;
  stage: RunStage;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
  folderPath?: string;
  selectedFiles?: string[];
  summary?: string;
  previewUrl?: string;
  filesChanged?: number;
  estimatedCostUsd?: number;
  replayId?: string;
  gateFailures?: number;
};

type StoredRunRecord = RunSummary & {
  artifact: Record<string, unknown>;
  createdAt: string;
};

const MAX_RECORDS = 400;

function resolveStoreRoot() {
  const repoRoot = path.resolve(process.cwd(), "..");
  return path.join(repoRoot, ".run", "code-runs");
}

function sanitizeRunId(input: string): string {
  return input.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120);
}

function summaryPath(root: string, runId: string): string {
  return path.join(root, "records", `${sanitizeRunId(runId)}.json`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function loadRecord(filePath: string): Promise<StoredRunRecord | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoredRunRecord;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const root = resolveStoreRoot();
  const recordsDir = path.join(root, "records");
  if (!(await pathExists(recordsDir))) {
    return NextResponse.json({ ok: true, runs: [] });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() ?? "";
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 40;

  const files = await readdir(recordsDir).catch(() => []);
  const loaded = await Promise.all(files.map((entry) => loadRecord(path.join(recordsDir, entry))));
  const records = loaded
    .filter((item): item is StoredRunRecord => Boolean(item))
    .filter((item) => (workspaceId ? item.workspaceId === workspaceId : true))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit)
    .map((item) => {
      const { artifact: _artifact, createdAt: _createdAt, ...summary } = item;
      return summary;
    });

  return NextResponse.json({ ok: true, runs: records });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    run?: RunSummary;
    artifact?: Record<string, unknown>;
  } | null;
  if (!body?.run || !body.artifact || typeof body.run.id !== "string" || !body.run.id.trim()) {
    return NextResponse.json({ ok: false, error: "run and artifact are required." }, { status: 400 });
  }

  const runId = sanitizeRunId(body.run.id.trim());
  if (!runId) {
    return NextResponse.json({ ok: false, error: "Invalid run id." }, { status: 400 });
  }

  const root = resolveStoreRoot();
  const recordsDir = path.join(root, "records");
  await mkdir(recordsDir, { recursive: true });

  const record: StoredRunRecord = {
    ...body.run,
    id: runId,
    createdAt: new Date().toISOString(),
    artifact: body.artifact,
  };

  await writeFile(summaryPath(root, runId), JSON.stringify(record, null, 2), "utf8");

  // Soft prune: keep only newest MAX_RECORDS records.
  const files = await readdir(recordsDir).catch(() => []);
  if (files.length > MAX_RECORDS) {
    const loaded = await Promise.all(
      files.map(async (entry) => {
        const filePath = path.join(recordsDir, entry);
        const record = await loadRecord(filePath);
        return record ? { filePath, updatedAt: record.updatedAt ?? 0 } : null;
      }),
    );
    const sorted = loaded
      .filter((item): item is { filePath: string; updatedAt: number } => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const toDelete = sorted.slice(MAX_RECORDS);
    await Promise.all(
      toDelete.map(async (item) => {
        try {
          await rm(item.filePath, { force: true });
        } catch {
          // ignore
        }
      }),
    );
  }

  return NextResponse.json({ ok: true, runId });
}
