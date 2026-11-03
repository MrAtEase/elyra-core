import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

type PlaygroundVersion = {
  commit: string;
  timestamp: number;
  message: string;
};

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 15_000, maxBuffer: 1024 * 1024 * 2 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({
          code,
          stdout: String(stdout ?? "").trim(),
          stderr: String(stderr ?? "").trim(),
        });
      },
    );
  });
}

function resolvePlaygroundDir(): string {
  // process.cwd() in Next.js returns the project root (frontend/).
  // The playground lives at <monorepo-root>/.run/playground/frontend.
  // Try both the direct parent and the grandparent to handle different CWD contexts.
  const cwdParent = path.resolve(process.cwd(), "..");
  const direct = path.join(cwdParent, ".run", "playground", "frontend");

  // Fallback: if frontend/ is already at monorepo root level
  const fromCwd = path.join(process.cwd(), ".run", "playground", "frontend");

  // Return the most likely path; pathExists checks are done by callers
  // Prefer the parent-based path (standard Next.js CWD = frontend/)
  return direct.includes(".run") ? direct : fromCwd;
}

export async function GET() {
  const playgroundDir = resolvePlaygroundDir();
  if (!(await pathExists(playgroundDir))) {
    return NextResponse.json({ ok: true, versions: [], head: null, note: "Playground directory not found." });
  }

  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], playgroundDir);
  if (inRepo.code !== 0) {
    return NextResponse.json({ ok: true, versions: [], head: null, note: "Playground git history not initialized yet." });
  }

  const log = await runGit(["log", "--pretty=format:%h|%ct|%s", "-n", "20"], playgroundDir);
  const head = await runGit(["rev-parse", "--short", "HEAD"], playgroundDir);
  const versions: PlaygroundVersion[] =
    log.code === 0 && log.stdout
      ? log.stdout
          .split("\n")
          .map((line) => {
            const [commit, tsRaw, ...messageParts] = line.split("|");
            const timestamp = Number(tsRaw);
            return {
              commit: commit?.trim() ?? "",
              timestamp: Number.isFinite(timestamp) ? timestamp * 1000 : Date.now(),
              message: messageParts.join("|").trim(),
            };
          })
          .filter((item) => item.commit)
      : [];

  return NextResponse.json({
    ok: true,
    versions,
    head: head.code === 0 && head.stdout ? head.stdout : null,
  });
}

export async function POST(req: NextRequest) {
  const playgroundDir = resolvePlaygroundDir();
  if (!(await pathExists(playgroundDir))) {
    return NextResponse.json({ ok: false, error: "Playground directory not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; commit?: string; message?: string };
  if (body.action !== "rollback" && body.action !== "snapshot") {
    return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
  }

  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], playgroundDir);
  if (inRepo.code !== 0) {
    const init = await runGit(["init"], playgroundDir);
    if (init.code !== 0) {
      return NextResponse.json({ ok: false, error: init.stderr || "Could not initialize playground git repository." }, { status: 500 });
    }
    await runGit(["config", "--local", "user.email", "playground@elyra.local"], playgroundDir);
    await runGit(["config", "--local", "user.name", "Elyra Playground"], playgroundDir);
  }

  if (body.action === "snapshot") {
    await runGit(["add", "-A"], playgroundDir);
    const status = await runGit(["status", "--porcelain"], playgroundDir);
    if (!status.stdout.trim()) {
      const head = await runGit(["rev-parse", "--short", "HEAD"], playgroundDir);
      return NextResponse.json({
        ok: true,
        head: head.code === 0 && head.stdout ? head.stdout : null,
        output: "No changes to snapshot.",
      });
    }
    const message = (body.message ?? "").trim() || `playground: manual snapshot ${new Date().toISOString()}`;
    const commit = await runGit(["commit", "-m", message], playgroundDir);
    if (commit.code !== 0) {
      return NextResponse.json({ ok: false, error: commit.stderr || "Snapshot commit failed." }, { status: 500 });
    }
    const head = await runGit(["rev-parse", "--short", "HEAD"], playgroundDir);
    return NextResponse.json({
      ok: true,
      head: head.code === 0 && head.stdout ? head.stdout : null,
      output: commit.stdout || commit.stderr || "Snapshot committed.",
    });
  }

  const commit = (body.commit ?? "").trim();
  if (!/^[a-f0-9]{4,40}$/i.test(commit)) {
    return NextResponse.json({ ok: false, error: "Invalid commit." }, { status: 400 });
  }
  const rollback = await runGit(["reset", "--hard", commit], playgroundDir);
  if (rollback.code !== 0) {
    return NextResponse.json({ ok: false, error: rollback.stderr || "Rollback failed." }, { status: 500 });
  }
  const head = await runGit(["rev-parse", "--short", "HEAD"], playgroundDir);
  return NextResponse.json({
    ok: true,
    head: head.code === 0 && head.stdout ? head.stdout : commit,
    output: rollback.stdout || rollback.stderr || "Rollback applied.",
  });
}
