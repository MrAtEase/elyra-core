/**
 * /api/os/code/undo
 *
 * Undo / rollback API for the dev and playground stages.
 *
 * GET  ?repoUrl=<path>&stage=dev|playground&limit=N
 *   → List recent codex commits (undo candidates).
 *
 * POST { action: "undo-last",  repoUrl, stage }
 *   → Revert the most recent codex commit in the given stage.
 *
 * POST { action: "revert", repoUrl, stage, commit }
 *   → Hard-reset the worktree to a specific commit SHA (destructive — only for dev/playground).
 *
 * POST { action: "apply-reverse", repoUrl, stage, diff }
 *   → Apply a diff in reverse (git apply -R) to undo a specific set of file changes.
 *
 * All actions are limited to local file-system repositories (no remote GitHub URLs).
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

type UndoCommit = {
  commit: string;
  timestamp: number;
  message: string;
  files: string[];
};

type GetResponse = {
  ok: boolean;
  stage: string;
  repoRoot: string;
  head: string | null;
  commits: UndoCommit[];
  note?: string;
  error?: string;
};

type PostBody = {
  action: "undo-last" | "revert" | "apply-reverse";
  repoUrl?: string;
  stage?: string;
  commit?: string;
  diff?: string;
};

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: number }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() });
      },
    );
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function isGitHubUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("https://github.com/")) return true;
  if (trimmed.startsWith("git@github.com:")) return true;
  return false;
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve the worktree directory for the requested stage.
 * For "playground" the worktree is the live playground serving on port 3100.
 * For "dev" / "prod" it is the repository root itself.
 */
async function resolveWorktree(repoUrl: string, stage: string): Promise<string | null> {
  const resolvedPath = path.resolve(repoUrl.replace(/^file:\/\//, ""));
  if (!(await pathExists(resolvedPath))) return null;

  if (stage === "playground") {
    const repoRoot = await findGitRoot(resolvedPath);
    if (!repoRoot) return null;
    const playgroundDir = path.join(repoRoot, ".run", "playground", "frontend");
    return (await pathExists(playgroundDir)) ? playgroundDir : null;
  }

  // dev / prod: the resolved local path itself
  return resolvedPath;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const repoUrl = (url.searchParams.get("repoUrl") ?? "").trim();
  const stage = (url.searchParams.get("stage") ?? "dev").trim();
  const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit") ?? "20")));

  if (!repoUrl) {
    return NextResponse.json({ ok: false, error: "repoUrl is required." }, { status: 400 });
  }
  if (isGitHubUrl(repoUrl)) {
    return NextResponse.json({ ok: false, error: "Remote GitHub repositories are not supported by the undo API." }, { status: 400 });
  }

  const worktree = await resolveWorktree(repoUrl, stage);
  if (!worktree) {
    return NextResponse.json({ ok: false, error: `Could not resolve worktree for stage '${stage}'.` }, { status: 404 });
  }

  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], worktree);
  if (inRepo.code !== 0) {
    return NextResponse.json<GetResponse>({
      ok: true,
      stage,
      repoRoot: worktree,
      head: null,
      commits: [],
      note: "Not a git repository.",
    });
  }

  const headResult = await runGit(["rev-parse", "--short", "HEAD"], worktree);
  const head = headResult.code === 0 ? headResult.stdout : null;

  // List recent codex commits (elly/codex prefix) plus any non-codex commits as context.
  const logResult = await runGit(
    ["log", `--pretty=format:%h|%ct|%s`, `-n`, String(limit)],
    worktree,
  );

  const commits: UndoCommit[] = [];
  if (logResult.code === 0 && logResult.stdout) {
    for (const line of logResult.stdout.split("\n")) {
      const [sha, tsRaw, ...msgParts] = line.split("|");
      const commit = sha?.trim() ?? "";
      if (!commit) continue;
      const timestamp = Number(tsRaw) * 1000;
      const message = msgParts.join("|").trim();

      // Fetch file list for this commit
      const filesResult = await runGit(["diff-tree", "--no-commit-id", "-r", "--name-only", commit], worktree);
      const files = filesResult.code === 0
        ? filesResult.stdout.split("\n").map((f) => f.trim()).filter(Boolean)
        : [];

      commits.push({ commit, timestamp, message, files });
    }
  }

  return NextResponse.json<GetResponse>({
    ok: true,
    stage,
    repoRoot: worktree,
    head,
    commits,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { action } = body;
  const repoUrl = (body.repoUrl ?? "").trim();
  const stage = (body.stage ?? "dev").trim();

  if (!action) {
    return NextResponse.json({ ok: false, error: "action is required: undo-last | revert | apply-reverse" }, { status: 400 });
  }
  if (!repoUrl) {
    return NextResponse.json({ ok: false, error: "repoUrl is required." }, { status: 400 });
  }
  if (isGitHubUrl(repoUrl)) {
    return NextResponse.json({ ok: false, error: "Remote GitHub repositories are not supported by the undo API." }, { status: 400 });
  }
  if (stage === "prod") {
    return NextResponse.json({ ok: false, error: "Undo is not permitted on the prod stage. Use git revert manually or open a revert PR." }, { status: 403 });
  }

  const worktree = await resolveWorktree(repoUrl, stage);
  if (!worktree) {
    return NextResponse.json({ ok: false, error: `Could not resolve worktree for stage '${stage}'.` }, { status: 404 });
  }

  // ── apply-reverse ─────────────────────────────────────────────────────────
  if (action === "apply-reverse") {
    const diff = (body.diff ?? "").trim();
    if (!diff) {
      return NextResponse.json({ ok: false, error: "diff is required for apply-reverse." }, { status: 400 });
    }
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        "git",
        ["apply", "-R", "--whitespace=fix", "-"],
        { cwd: worktree, timeout: 30_000, maxBuffer: 1024 * 1024 * 4 },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: number }).code === "number"
              ? (error as { code: number }).code
              : error ? 1 : 0;
          resolve({ code, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() });
        },
      );
      child.stdin?.end(diff);
    });
    if (result.code !== 0) {
      return NextResponse.json({
        ok: false,
        error: result.stderr || result.stdout || "git apply -R failed.",
      }, { status: 500 });
    }
    const head = await runGit(["rev-parse", "--short", "HEAD"], worktree);
    return NextResponse.json({
      ok: true,
      action,
      stage,
      head: head.stdout || null,
      output: result.stdout || result.stderr || "Reverse patch applied.",
    });
  }

  // ── undo-last ─────────────────────────────────────────────────────────────
  if (action === "undo-last") {
    // Find the last codex/elly commit, then revert it.
    const logResult = await runGit(
      ["log", "--pretty=format:%h|%s", "-n", "20"],
      worktree,
    );
    const lastCodexCommit = logResult.stdout
      .split("\n")
      .find((line) => /\|elly\(|codex:|elly:|playground:/.test(line));

    if (!lastCodexCommit) {
      return NextResponse.json({
        ok: false,
        error: "No recent codex/elly commit found to undo.",
      }, { status: 404 });
    }

    const commitSha = lastCodexCommit.split("|")[0]?.trim() ?? "";
    if (!commitSha) {
      return NextResponse.json({ ok: false, error: "Could not parse commit SHA." }, { status: 500 });
    }

    // Use git revert (creates a new commit, safe for shared histories)
    await runGit(["config", "--local", "user.email", "undo@elyra.local"], worktree);
    await runGit(["config", "--local", "user.name", "Elyra Undo"], worktree);
    const revert = await runGit(["revert", "--no-edit", commitSha], worktree);
    if (revert.code !== 0) {
      // If revert fails (merge conflict), abort and clean up the working tree
      await runGit(["revert", "--abort"], worktree).catch(() => null);
      // Additional cleanup: reset any half-applied changes to leave repo in clean state
      await runGit(["checkout", "--", "."], worktree).catch(() => null);
      return NextResponse.json({
        ok: false,
        error: (revert.stderr || revert.stdout || "git revert failed.") + "\n\nTip: use action:apply-reverse with the original diff for a targeted undo.",
      }, { status: 500 });
    }
    const head = await runGit(["rev-parse", "--short", "HEAD"], worktree);
    return NextResponse.json({
      ok: true,
      action,
      stage,
      revertedCommit: commitSha,
      head: head.stdout || null,
      output: revert.stdout || revert.stderr || `Reverted ${commitSha}.`,
    });
  }

  // ── revert (hard reset to a specific commit) ───────────────────────────────
  if (action === "revert") {
    const commit = (body.commit ?? "").trim();
    if (!/^[a-f0-9]{4,40}$/i.test(commit)) {
      return NextResponse.json({ ok: false, error: "Invalid commit SHA." }, { status: 400 });
    }
    // Verify commit exists
    const verify = await runGit(["cat-file", "-t", commit], worktree);
    if (verify.code !== 0 || verify.stdout !== "commit") {
      return NextResponse.json({ ok: false, error: `Commit ${commit} not found in this repository.` }, { status: 404 });
    }
    const reset = await runGit(["reset", "--hard", commit], worktree);
    if (reset.code !== 0) {
      return NextResponse.json({
        ok: false,
        error: reset.stderr || reset.stdout || "git reset --hard failed.",
      }, { status: 500 });
    }
    const head = await runGit(["rev-parse", "--short", "HEAD"], worktree);
    return NextResponse.json({
      ok: true,
      action,
      stage,
      resetTo: commit,
      head: head.stdout || null,
      output: reset.stdout || reset.stderr || `Reset to ${commit}.`,
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
