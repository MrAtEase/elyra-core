import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

type PromotionAuditRecord = {
  id: string;
  workspaceId: string;
  runId?: string;
  fromStage: "playground" | "dev" | "prod";
  toStage: "playground" | "dev" | "prod" | "main";
  status: "started" | "completed" | "failed";
  summary?: string;
  filesChanged?: number;
  replayId?: string;
  branch?: string;
  repoUrl?: string;
  prUrl?: string;
  createdAt: string;
};

const MAX_RECORDS = 300;

function resolveAuditPath(): string {
  const repoRoot = path.resolve(process.cwd(), "..");
  return path.join(repoRoot, ".run", "promotion-audit.json");
}

async function readAuditRecords(filePath: string): Promise<PromotionAuditRecord[]> {
  try {
    await stat(filePath);
  } catch {
    return [];
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as PromotionAuditRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAuditRecords(filePath: string, records: PromotionAuditRecord[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(records.slice(0, MAX_RECORDS), null, 2), "utf8");
}

export async function GET(req: NextRequest) {
  const filePath = resolveAuditPath();
  const workspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim() ?? "";
  const records = await readAuditRecords(filePath);
  const filtered = workspaceId
    ? records.filter((record) => record.workspaceId === workspaceId)
    : records;
  return NextResponse.json({ ok: true, records: filtered.slice(0, 40) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<PromotionAuditRecord> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const workspaceId = (body.workspaceId ?? "").trim();
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
  }

  const fromStage = body.fromStage;
  const toStage = body.toStage;
  const status = body.status;
  if (!fromStage || !toStage || !status) {
    return NextResponse.json({ ok: false, error: "fromStage, toStage, and status are required." }, { status: 400 });
  }

  const record: PromotionAuditRecord = {
    id: body.id?.trim() || randomUUID(),
    workspaceId,
    fromStage,
    toStage,
    status,
    createdAt: new Date().toISOString(),
    ...(typeof body.runId === "string" ? { runId: body.runId } : {}),
    ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
    ...(typeof body.filesChanged === "number" ? { filesChanged: body.filesChanged } : {}),
    ...(typeof body.replayId === "string" ? { replayId: body.replayId } : {}),
    ...(typeof body.branch === "string" ? { branch: body.branch } : {}),
    ...(typeof body.repoUrl === "string" ? { repoUrl: body.repoUrl } : {}),
    ...(typeof body.prUrl === "string" ? { prUrl: body.prUrl } : {}),
  };

  const filePath = resolveAuditPath();
  const records = await readAuditRecords(filePath);
  await writeAuditRecords(filePath, [record, ...records]);
  return NextResponse.json({ ok: true, record });
}

