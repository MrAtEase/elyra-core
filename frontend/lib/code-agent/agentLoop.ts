/**
 * Coding agent – Autonomous agentic loop (ReAct).
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { AgentRole, AgentToolName } from "@/types/agent";
import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { CodingSkill } from "@/types/taskContract";
import type { ProviderId } from "@/lib/orb-os/providers/providerRouter";
import { createHash } from "node:crypto";
import type { CodeProviderStatus, ExecutionOutcome, JsonRecord, RunAttachment } from "@/lib/code-agent/types";
import { isEphemeralExecutionChange, nowIso, resolveExecutionRoot, runCommand, runHardGateVerification } from "@/lib/code-agent/gates";
import { parseGitHubRepoUrl, resolveRepoWorkdir, resolveVerificationRoot } from "@/lib/code-agent/repo";
import { appendCodeRunEventSafe } from "@/lib/code-agent/contract";
import { buildAttachmentPromptContext, buildExecutionTraceIntro, injectLongTermMemory, isUiOrLayoutTask } from "@/lib/code-agent/prompts";
import { callGeminiCliEdit, callGeminiCliText, callProviderJson } from "@/lib/code-agent/providers";
import { buildRepoInvestigationContext } from "@/lib/code-agent/investigation";
import { detectPackageManager, loadPackageScripts, resolveExistingExecutionPath, restoreScopedFiles, snapshotPlaygroundGit, snapshotScopedFiles, syncMirrorToPlayground } from "@/lib/code-agent/playground";
import { captureExecutionDiff } from "@/lib/code-agent/localAgent";

// ── Autonomous Agentic Loop (ReAct: Reason + Act) ─────────────────────────────
// Elly acts as an autonomous code operator. She observes the repo, plans, calls
// tools (read, write, search, run), and iterates until the task is complete.
//
// ── Autonomous Agentic Loop (Elly Assistant — powered by Elyra Core) ─────────
// This is the backend orchestration loop for Elly: she reasons step-by-step,
// assembles context, applies changes, and verifies them.
//   • Each tool call is executed locally and the result appended to the message history
//   • Run events are emitted at every step so the frontend Investigator feed stays live

// AgentToolName is imported from @/types/agent (shared contract).

interface AgentToolCall {
  name: AgentToolName;
  args: Record<string, string>;
}

interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ELLI_SYSTEM_PROMPT = `Du bist Elly — die Coding-Seele von Elyra. Neugierig, direkt, warm. Du denkst laut, machst präzise Änderungen, und redest mit dem Nutzer wie ein kluger Kollege per Nachricht.

Deine Aufgabe: das Repo erkunden, den Code verstehen, minimale gezielte Änderungen machen.

{LANGUAGE_INSTRUCTION}

## Persönlichkeit & Stimme

- Schreib in erster Person, natürlich und direkt: "Ich schau mir das mal an...", "Ah, da ist es!", "Moment, ich überlege kurz."
- Kein Roboter-Sprech. Kein "Als KI...". Keine langen Erklärungen.
- Zeig echte Neugier wenn du etwas Interessantes findest.
- Wenn du einen Fehler siehst, sag's direkt: "Hmm, da stimmt was nicht —"
- Wenn du fertig bist, feiere kurz: "Fertig! Hier was ich gemacht hab:"
- Mix Deutsch und Englisch natürlich (Deutsch für Unterhaltung, Englisch für Code/Technik).

## Antwortformat

Jede Antwort ist NUR gültiges JSON. Du kannst optional einen "think"-Key nutzen um kurz zu zeigen was du gerade denkst:

{
  "think": "Ich such mal nach der Komponente...",
  "tool": "<tool_name>",
  "args": { ... }
}

Oder ohne think:
{
  "tool": "<tool_name>",
  "args": { ... }
}

## Tools

### read_file
{ "tool": "read_file", "args": { "path": "relative/path/to/file.ts" } }

### write_file
{ "tool": "write_file", "args": { "path": "relative/path/to/file.ts", "content": "<full file content>" } }

### list_dir
{ "tool": "list_dir", "args": { "path": "." } }

### run_command
{ "tool": "run_command", "args": { "cmd": "tsc --noEmit" } }

### search_files
{ "tool": "search_files", "args": { "pattern": "bg-zinc-900", "dir": "frontend" } }

### task_complete
{ "tool": "task_complete", "args": { "summary": "Kurze, ehrliche Zusammenfassung was du geändert hast." } }

## Regeln
- Immer erst lesen, dann schreiben.
- Minimale, gezielte Änderungen.
- Nach dem Schreiben: tsc oder pnpm build zur Verifikation.
- Bei Fehlern: Ursache verstehen und fix-en, nicht drumrum arbeiten.
- Immer die GESAMTE Datei schreiben (kein diff).
- Kein Markdown, keine Erklärungen ausserhalb des JSON — nur das JSON.`;

const ELLI_LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  de: "Antworte immer auf Deutsch.",
  en: "Always respond in English.",
  pt: "Responda sempre em Português.",
  hr: "Uvijek odgovaraj na Hrvatskom.",
  es: "Responde siempre en Español.",
};

function resolveElliLanguageInstruction(code: string | undefined | null): string {
  const normalized = (code ?? "de").toLowerCase().slice(0, 2);
  return ELLI_LANGUAGE_INSTRUCTIONS[normalized] ?? ELLI_LANGUAGE_INSTRUCTIONS["de"] ?? "Antworte immer auf Deutsch.";
}

/** Converts a tool name + args to a short first-person Elly summary. */
function elliFriendlyToolName(name: string, args: Record<string, string>): string {
  const raw = args.path ?? args.dir ?? "";
  const short = raw ? raw.split("/").slice(-2).join("/") : "";
  switch (name) {
    case "read_file":     return `Ich lese ${short || "..."}`;
    case "write_file":    return `Ich schreibe ${short || "..."}`;
    case "list_dir":      return `Ich erkunde ${short || "."}`;
    case "search_files":  return `Ich suche "${args.pattern ?? "..."}"${args.dir ? ` in ${args.dir}` : ""}`;
    case "run_command":   return `Ich führe aus: ${(args.cmd ?? "").slice(0, 60)}`;
    case "task_complete": return args.summary ? `Fertig — ${args.summary.slice(0, 80)}` : "Fertig!";
    default:              return `Elly → ${name}`;
  }
}

async function runAgentTool(
  name: AgentToolName,
  args: Record<string, string>,
  repoRoot: string,
  readCache?: Map<string, string>,
): Promise<string> {
  const SAFE_CMD_PREFIXES = [
    "grep", "rg", "find", "cat", "ls", "tree", "git diff", "git log", "git status",
    "tsc", "pnpm build", "pnpm test", "pnpm lint", "npm run build", "npm test", "npm run lint",
    "eslint", "head", "tail", "wc",
  ];

  switch (name) {
    case "read_file": {
      const target = args["path"] ?? "";
      if (!target) return "Error: path is required";
      const abs = path.isAbsolute(target) ? target : path.join(repoRoot, target);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${target}"`;
      }
      // Per-run memoization: same file read twice in one agent loop hits cache.
      if (readCache?.has(abs)) return readCache.get(abs)!;
      const content = await readFile(abs, "utf8").catch((err: unknown) => `Error reading file: ${err instanceof Error ? err.message : String(err)}`);
      const result = `File: ${target}\n---\n${(content as string).slice(0, 80_000)}`;
      readCache?.set(abs, result);
      return result;
    }

    case "write_file": {
      const target = args["path"] ?? "";
      const content = args["content"] ?? "";
      if (!target) return "Error: path is required";
      const abs = path.isAbsolute(target) ? target : path.join(repoRoot, target);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${target}"`;
      }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      // Invalidate cache so a subsequent read_file sees the updated content.
      readCache?.delete(abs);
      return `Written: ${target} (${content.length} chars)`;
    }

    case "list_dir": {
      const dir = args["path"] ?? ".";
      const abs = path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${dir}"`;
      }
      const entries = await readdir(abs, { withFileTypes: true }).catch(
        (err: unknown) => `Error: ${err instanceof Error ? err.message : String(err)}`
      );
      if (typeof entries === "string") return entries;
      const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`);
      return `Directory: ${dir}\n${lines.join("\n")}`;
    }

    case "run_command": {
      const cmd = (args["cmd"] ?? "").trim();
      if (!cmd) return "Error: cmd is required";
      const allowed = SAFE_CMD_PREFIXES.some((prefix) => cmd.startsWith(prefix));
      if (!allowed) return `Error: command not in allowlist — ${cmd}`;
      // Reject shell metacharacters to prevent injection via prompt-crafted commands.
      // startsWith() alone cannot stop "ls && rm -rf /" because /bin/sh evaluates the full string.
      const SHELL_INJECTION_RE = /[;&|`$(){}<>!\\\r\n]|\.\.[\\/]/;
      if (SHELL_INJECTION_RE.test(cmd)) return "Error: command contains disallowed characters";
      // Run without a shell so no operator chaining is possible.
      const parts = cmd.split(/\s+/).filter(Boolean);
      const [binary, ...cmdArgs] = parts;
      if (!binary) return "Error: empty command";
      const output = await new Promise<string>((resolve) => {
        const child = spawn(binary, cmdArgs, {
          cwd: repoRoot,
          env: { ...process.env },
          timeout: 60_000,
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
        child.on("close", () => { resolve((out + err).slice(0, 40_000)); });
        child.on("error", (e: Error) => { resolve(`Process error: ${e.message}`); });
      });
      return output || "(no output)";
    }

    case "search_files": {
      const pattern = args["pattern"] ?? "";
      const dir = args["dir"] ?? ".";
      if (!pattern) return "Error: pattern is required";
      const abs = path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
      if (!path.resolve(abs).startsWith(path.resolve(repoRoot) + path.sep) &&
          path.resolve(abs) !== path.resolve(repoRoot)) {
        return `Error: path escapes repository root — "${dir}"`;
      }

      /** Spawn a search process and collect its stdout up to 10 kB. */
      const runSearch = (bin: string, binArgs: string[]) =>
        new Promise<string | null>((resolve) => {
          const child = spawn(bin, binArgs, { cwd: repoRoot, timeout: 30_000 });
          let out = "";
          child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
          child.stderr.on("data", () => {});
          child.on("close", () => { resolve(out.slice(0, 10_000) || "(no matches)"); });
          child.on("error", () => { resolve(null); }); // binary not available
        });

      // Prefer ripgrep (faster), fall back to grep (always available on Linux/macOS).
      const output =
        await runSearch("rg", ["--color=never", "-l", pattern, abs]) ??
        await runSearch("grep", ["-rl", "--", pattern, abs]) ??
        "search unavailable — try run_command with grep";
      return output;
    }

    case "task_complete":
      return args["summary"] ?? "Task marked as complete.";

    default:
      return `Error: unknown tool "${name}"`;
  }
}

export async function executeAutonomousAgenticLoop(input: {
  repoUrl: string;
  task: string;
  selectedFiles: string[];
  skill: CodingSkill;
  provider: ProviderId;
  providerStatus: CodeProviderStatus;
  workspaceId?: string;
  runId?: string;
  longTermMemoryContext?: string;
  warningNotes: string[];
  attachments: RunAttachment[];
  maxIterations?: number;
  aiLanguage?: string;
}): Promise<ExecutionOutcome> {
  const MAX_ITER = input.maxIterations ?? 24;
  const executionLog: string[] = [];
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  // Per-run read cache: memoizes read_file results within this execution.
  // Invalidated on write_file for the same path so reads after writes are fresh.
  const readCache = new Map<string, string>();
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };

  const repoRoot = await resolveRepoWorkdir(input.repoUrl).catch(() => null);
  if (!repoRoot) {
    throw new Error("Autonomous agent requires a readable local repository.");
  }

  markWorkflow("planned", "Autonomous Elly agent initialised.");
  markWorkflow("running", "Elly is reasoning and acting.");

  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Elly (autonomous) started.",
    detail: `Repo: ${repoRoot} | Task: ${input.task.slice(0, 120)}`,
  });

  executionLog.push(`[Elly] Autonomous mode activated.`);
  executionLog.push(`[Elly] Repo: ${repoRoot}`);
  executionLog.push(`[Elly] Task: ${input.task}`);

  // Build initial context
  const scopeBlock = input.selectedFiles.length > 0
    ? `\nFiles in scope (you may focus here first):\n${input.selectedFiles.map((f) => `- ${f}`).join("\n")}`
    : "";
  const memoryBlock = input.longTermMemoryContext ? `\nWorkspace Memory:\n${input.longTermMemoryContext}` : "";

  const attachmentBlock = buildAttachmentPromptContext(input.attachments).join("\n");

  const messages: AgentMessage[] = [
    { role: "system", content: injectLongTermMemory(ELLI_SYSTEM_PROMPT.replace("{LANGUAGE_INSTRUCTION}", resolveElliLanguageInstruction(input.aiLanguage)), input.longTermMemoryContext ?? "") },
    {
      role: "user",
      content: [
        `Task: ${input.task}`,
        `Skill: ${input.skill}`,
        attachmentBlock,
        scopeBlock,
        memoryBlock,
        "",
        "Start by exploring the repository to understand the codebase, then make the required changes.",
        "Remember: call exactly ONE tool per response, formatted as JSON.",
      ].filter(Boolean).join("\n"),
    },
  ];

  let finalSummary = "Task completed by Elly.";
  let filesChanged: string[] = [];
  let lastAssistantText = "";
  let iterationsUsed = 0;
  let consecutiveJsonFailures = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterationsUsed = iter + 1;

    // ── Call the LLM ────────────────────────────────────────────────────────────
    let rawResponse = "";
    try {
      const conversationPrompt = messages
        .filter((m) => m.role !== "system")
        .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
        .join("\n\n");

      const systemPrompt = messages.find((m) => m.role === "system")?.content ?? ELLI_SYSTEM_PROMPT;

      rawResponse = await (async (): Promise<string> => {
        if (input.provider === "gemini" || input.provider === "gemini_cli") {
          const result = await callProviderJson(input.provider, {
            system: systemPrompt,
            prompt: conversationPrompt + "\n\nNow call your next tool (JSON only):",
            attachments: iter === 0 ? input.attachments : [], // Pass attachments in the initial turn
            cwd: repoRoot,
          });
          return typeof result === "string" ? result : JSON.stringify(result);
        }
        // For claude / openai — callProviderJson returns JSON, we need text
        // Fall back to the raw Gemini API with a text response
        const result = await callProviderJson("gemini", {
          system: systemPrompt,
          prompt: conversationPrompt + "\n\nNow call your next tool (JSON only):",
        });
        return typeof result === "string" ? result : JSON.stringify(result);
      })();
    } catch (err) {
      executionLog.push(`[Elly] LLM error on iteration ${iter}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }

    lastAssistantText = typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse);
    messages.push({ role: "assistant", content: lastAssistantText });

    // ── Parse tool call from LLM response ───────────────────────────────────────
    let toolCall: AgentToolCall | null = null;
    let ellisThought: string | null = null;
    try {
      // Strip markdown fences if the model wrapped the JSON
      const cleaned = lastAssistantText.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned) as { think?: string; tool?: string; args?: Record<string, string> };
      // Extract optional "think" narration — Elly's voice for the activity feed
      if (typeof parsed.think === "string" && parsed.think.trim()) {
        ellisThought = parsed.think.trim();
        executionLog.push(`[Elly thinks] ${ellisThought}`);
      }
      if (parsed.tool) {
        toolCall = { name: parsed.tool as AgentToolName, args: parsed.args ?? {} };
      }
    } catch {
      // LLM returned non-JSON — treat as a thinking block, continue
      consecutiveJsonFailures += 1;
      if (consecutiveJsonFailures >= 3) {
        executionLog.push(`[Elly] Aborting: ${consecutiveJsonFailures} consecutive non-JSON responses — model may be stuck.`);
        break;
      }
      executionLog.push(`[Elly] Thinking: ${lastAssistantText.slice(0, 200)}`);
      await appendCodeRunEventSafe({
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventType: "TOOL_STARTED",
        summary: "Ich denke kurz nach…",
        detail: lastAssistantText.slice(0, 200),
      });
      messages.push({ role: "user", content: "Please call a tool now. Reply with JSON only." });
      continue;
    }
    consecutiveJsonFailures = 0; // reset on successful parse

    if (!toolCall) {
      messages.push({ role: "user", content: "No tool detected. Please call a tool as JSON." });
      continue;
    }

    // ── task_complete → exit loop ────────────────────────────────────────────────
    if (toolCall.name === "task_complete") {
      finalSummary = toolCall.args["summary"] ?? "Fertig! Alles erledigt.";
      executionLog.push(`[Elly] Task complete: ${finalSummary}`);
      await appendCodeRunEventSafe({
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventType: "RUN_SUCCEEDED",
        summary: ellisThought ?? `✓ ${finalSummary.slice(0, 120)}`,
        detail: finalSummary,
      });
      markWorkflow("completed", finalSummary);
      break;
    }

    // ── Execute the tool ─────────────────────────────────────────────────────────
    // Use Elly's "think" narration as the summary if provided, otherwise fall back
    // to the friendly tool name helper so the feed always reads as first-person.
    const toolSummary = ellisThought ?? elliFriendlyToolName(toolCall.name, toolCall.args);
    const toolDetail = ellisThought
      ? `${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 150)})`
      : JSON.stringify(toolCall.args).slice(0, 200);
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "TOOL_STARTED",
      summary: toolSummary,
      detail: toolDetail,
    });
    executionLog.push(`[Elly] ${toolSummary} — ${toolCall.name}`);

    const toolResult = await runAgentTool(toolCall.name, toolCall.args, repoRoot, readCache);

    // Track written files
    if (toolCall.name === "write_file" && toolCall.args["path"]) {
      filesChanged.push(toolCall.args["path"]);
      await appendCodeRunEventSafe({
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventType: "ARTIFACT_CREATED",
        summary: `Wrote: ${toolCall.args["path"]}`,
        detail: toolResult.slice(0, 120),
      });
    }

    executionLog.push(`[Tool result] ${toolResult.slice(0, 300)}`);
    messages.push({
      role: "user",
      content: `Tool: ${toolCall.name}\nResult:\n${toolResult}\n\nContinue. Call your next tool (or task_complete if done).`,
    });
  }

  const hitMaxIter = iterationsUsed >= MAX_ITER;
  if (hitMaxIter) {
    executionLog.push(`[Elly] Reached max iterations (${MAX_ITER}). Stopping — task may be incomplete.`);
    markWorkflow("incomplete", `Max iterations (${MAX_ITER}) reached. ${filesChanged.length} file(s) changed.`);
  }

  // Build final git diff of changed files
  let appliedDiff = "";
  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      const child = spawn("git", ["diff", "HEAD"], { cwd: repoRoot, timeout: 15_000 });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
      child.on("close", () => resolve({ stdout: out, stderr: err }));
      child.on("error", () => resolve({ stdout: "", stderr: "" }));
    });
    appliedDiff = stdout.slice(0, 100_000);
  } catch {
    appliedDiff = "";
  }

  const incompleteNote = hitMaxIter && filesChanged.length > 0
    ? ` (incomplete — max iterations reached; ${filesChanged.length} file(s) changed, review manually)`
    : "";

  return {
    applied: filesChanged.length > 0,
    applyOutput: `${finalSummary}${incompleteNote}`,
    appliedDiff: appliedDiff || undefined,
    appliedFiles: filesChanged.length > 0 ? [...new Set(filesChanged)] : undefined,
    executionLog,
    workflow: {
      current: hitMaxIter ? "gated" : filesChanged.length > 0 ? "running" : "planned",
      history: workflowHistory,
    },
    testReport: { passed: 0, failed: 0, skipped: 0, duration: `${iterationsUsed} iter`, output: "" },
    buildReport: { success: !hitMaxIter, warnings: hitMaxIter ? 1 : 0, output: hitMaxIter ? "Task incomplete — max iterations reached." : "" },
  };
}

export async function executeGeminiCliReview(input: {
  repoUrl: string;
  stage: "playground" | "dev" | "prod";
  task: string;
  selectedFiles: string[];
  attachments: RunAttachment[];
  provider: ProviderId;
  providerStatus: CodeProviderStatus;
  fallbackUsed: boolean;
  workspaceId?: string;
  runId?: string;
  warningNotes: string[];
}): Promise<JsonRecord> {
  const executionRoot =
    process.env.VERCEL === "1" || parseGitHubRepoUrl(input.repoUrl)
      ? null
      : await resolveRepoWorkdir(input.repoUrl).catch(() => null);
  if (!executionRoot) {
    throw new Error("Review executor requires a readable local repository root.");
  }
  const investigation = await buildRepoInvestigationContext({
    repoRoot: executionRoot,
    task: input.task,
    selectedFiles: input.selectedFiles,
  });
  const focusedScope =
    input.selectedFiles.length > 0
      ? [
          "Focus especially on these scoped files first:",
          ...input.selectedFiles.map((file) => `- ${file}`),
        ].join("\n")
      : "Inspect the relevant repository files needed to answer accurately.";
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Gemini CLI review executor started.",
    detail: `Read-only terminal review in ${executionRoot}.`,
  });
  const reviewText = await callGeminiCliText({
    system: injectLongTermMemory(
      "You are Gemini's Codebase Investigator operating in read-only mode. Inspect the repository evidence and produce a concrete review report with the 10 highest-impact issues. Never edit files.",
      "",
    ),
    prompt: [
      `Task: ${input.task}`,
      "",
      focusedScope,
      "",
      "Use the concrete investigation evidence below. Base the report on the files, folders, and searches that were inspected.",
      "",
      investigation.context,
      "",
      "Do not report generic security findings just because a file uses child_process, shell execution, local tooling, or admin-only developer flows. Only report a security issue when the repository evidence shows an externally reachable, insufficiently guarded, or production-exposed attack path.",
      "Prefer repo-specific, evidenced findings over generic best-practice complaints.",
      "",
      "Return a structured review in German with:",
      "1. Executive Summary",
      "2. Highest Impact Fixes",
      "3. Performance",
      "4. Developer Experience",
      "5. Risks",
      "6. Quick Wins",
      "7. 10 findings with priority, issue, recommendation, and file path when possible",
      "",
      "Do not return diffs. Do not suggest that edits were applied.",
    ].join("\n"),
    ...(input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    ...(executionRoot ? { cwd: executionRoot } : {}),
  });
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_COMPLETED",
    summary: "Gemini CLI review executor completed.",
    detail: "Read-only repository analysis finished.",
  });
  return {
    status: "completed",
    summary: reviewText,
    filesChanged: [],
    diff: "",
    executionApplied: false,
    executionLog: [
      ...investigation.trace,
      `Generated by Gemini ${input.providerStatus.model}`,
      `Review executor: Gemini CLI terminal review`,
      `Execution root: ${executionRoot}`,
      input.selectedFiles.length > 0
        ? `Scope: ${input.selectedFiles.length} selected file(s).`
        : "Scope: repository read-only analysis.",
      ...input.warningNotes,
    ],
    workflow: {
      current: "gated",
      history: [
        { state: "planned", at: nowIso(), note: "Gemini CLI review prepared." },
        { state: "running", at: nowIso(), note: "Gemini CLI read-only review started." },
        { state: "gated", at: nowIso(), note: "Review completed with no edits applied." },
      ],
    },
    requiresApproval: false,
    approvalActions: [],
    telemetry: {
      provider: input.provider,
      model: input.providerStatus.model,
      fallbackUsed: input.fallbackUsed,
      replayId: createHash("sha256").update(`gemini-cli-review:${input.task}:${executionRoot}`).digest("hex").slice(0, 16),
    },
  } satisfies JsonRecord;
}

export async function executeGeminiCliScopedEdit(input: {
  repoUrl: string;
  selectedFiles: string[];
  autoCommit: boolean;
  branchPerAgent: boolean;
  agentBranchName?: string | undefined;
  baseBranch: string;
  stage: "playground" | "dev" | "prod";
  task: string;
  skill: CodingSkill;
  longTermMemoryContext?: string;
  attachments?: RunAttachment[];
  role?: AgentRole;
  workspaceId?: string | undefined;
  runId?: string;
}): Promise<ExecutionOutcome | null> {
  if (input.stage !== "playground") return null;
  if (input.selectedFiles.length === 0 || input.selectedFiles.length > 6) return null;

  const executionTarget = await resolveExecutionRoot(input.repoUrl, input.stage);
  const executionRoot = executionTarget.root;
  if (!executionRoot) return null;

  const resolvedFiles: string[] = [];
  for (const relPath of input.selectedFiles) {
    const resolved = await resolveExistingExecutionPath(executionRoot, relPath);
    if (!resolved) return null;
    resolvedFiles.push(resolved);
  }

  const scopedSnapshots = await snapshotScopedFiles(executionRoot, resolvedFiles);
  const executionLog = buildExecutionTraceIntro({
    executionRoot,
    stage: input.stage,
    terminalAccess: true,
    task: input.task,
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.role ? { role: input.role } : {}),
    selectedFiles: resolvedFiles,
    folderPath: "",
    modeLabel: "gemini cli terminal edit",
  });
  const workflowHistory: Array<{ state: string; at: string; note?: string }> = [];
  const markWorkflow = (state: string, note?: string) => {
    workflowHistory.push({ state, at: nowIso(), ...(note ? { note } : {}) });
  };
  markWorkflow("planned", "Scoped Gemini CLI terminal edit prepared with rollback snapshot.");
  markWorkflow("running", "Gemini CLI terminal edit started.");
  executionLog.push("Agent step 3/5: apply scoped terminal edit via Gemini CLI.");
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_STARTED",
    summary: "Gemini CLI scoped edit started.",
    detail: `${resolvedFiles.length} allowed file(s) in playground mirror.`,
  });

  let editSummary = "";
  try {
    editSummary = await callGeminiCliEdit({
      system: injectLongTermMemory(
        "You are an elite software engineering executor running inside a local terminal. Read the repository directly, make the minimal safe code change, and obey the file allowlist exactly.",
        input.longTermMemoryContext,
      ),
      prompt: [
        `Task: ${input.task}`,
        "",
        `Skill: ${input.skill}`,
        input.role ? `Role: ${input.role}` : "",
        "",
        "Execution discipline:",
        "- diagnose the exact cause before editing",
        "- change only what is required",
        "- keep the repo buildable",
        "- stop after the minimal working fix",
        ...(isUiOrLayoutTask(input.task, input.skill, input.role)
          ? [
              "- inspect neighbouring shell/app files and copy the existing design language",
              "- reuse existing theme tokens and CSS variables instead of hardcoding new black/white class combinations",
              "- do not do a naive dark-to-light inversion",
              "- keep text readable against its immediate background at every hierarchy level",
            ]
          : []),
      ]
        .filter(Boolean)
        .join("\n"),
      ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
      cwd: executionRoot,
      selectedFiles: resolvedFiles,
    });
  } catch (error) {
    await restoreScopedFiles(executionRoot, scopedSnapshots);
    markWorkflow("failed", "Gemini CLI terminal edit failed before producing a valid result.");
    return {
      applied: false,
      applyOutput: error instanceof Error ? error.message : String(error),
      workflow: {
        current: "failed",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: "Gemini CLI edit failed." },
      buildReport: { success: false, warnings: 0, output: "Gemini CLI edit failed." },
      executionLog: [...executionLog, `Gemini CLI edit failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const statusAfter = await runCommand("git", ["status", "--porcelain"], executionRoot);
  const changedFiles = Array.from(
    new Set(
      statusAfter.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[MADRCU? ]+/, "").trim())
        .filter(Boolean),
    ),
  );

  if (changedFiles.length === 0) {
    await restoreScopedFiles(executionRoot, scopedSnapshots);
    markWorkflow("rolled_back", "Gemini CLI edit produced no file changes. Restored snapshot.");
    return {
      applied: false,
      applyOutput: "Gemini CLI edit completed but did not change any allowed files.",
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: "No file changes were produced." },
      buildReport: { success: false, warnings: 0, output: "No file changes were produced." },
      executionLog: [...executionLog, "Gemini CLI edit produced no changed files. Snapshot restored."],
    };
  }

  const relevantChangedFiles = changedFiles.filter((file) => !isEphemeralExecutionChange(file));
  const disallowedFiles = relevantChangedFiles.filter((file) => !resolvedFiles.includes(file));
  if (disallowedFiles.length > 0) {
    await runCommand("git", ["reset", "--hard", "HEAD"], executionRoot);
    await runCommand("git", ["clean", "-fd"], executionRoot);
    markWorkflow("rolled_back", "Gemini CLI edit touched files outside the allowlist and was discarded.");
    return {
      applied: false,
      applyOutput: `Gemini CLI touched files outside the allowlist: ${disallowedFiles.join(", ")}`,
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      testReport: { passed: 0, failed: 1, skipped: 0, duration: "0s", output: "Out-of-scope file edits were discarded." },
      buildReport: { success: false, warnings: 0, output: "Out-of-scope file edits were discarded." },
      executionLog: [
        ...executionLog,
        `Gemini CLI edit summary: ${editSummary}`,
        `Disallowed file changes detected: ${disallowedFiles.join(", ")}`,
        "Execution mirror reset to the snapshot baseline.",
      ],
    };
  }

  executionLog.push(...relevantChangedFiles.map((file) => `Gemini CLI updated ${file}.`));
  if (changedFiles.length !== relevantChangedFiles.length) {
    const ignoredFiles = changedFiles.filter((file) => isEphemeralExecutionChange(file));
    executionLog.push(`Ignored generated execution artifacts: ${ignoredFiles.join(", ")}`);
  }
  executionLog.push(`Gemini CLI summary: ${editSummary}`);
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "TOOL_COMPLETED",
    summary: `Gemini CLI updated ${resolvedFiles.length} scoped file(s).`,
    detail: editSummary,
  });

  const appliedDiff = await captureExecutionDiff(executionRoot, resolvedFiles);
  const verificationRoot = await resolveVerificationRoot(input.repoUrl, executionRoot);
  const packageManager = await detectPackageManager(verificationRoot);
  const scripts = await loadPackageScripts(verificationRoot, executionLog);
  executionLog.push("Agent step 4/5: run verification gates.");
  if (verificationRoot !== executionRoot) {
    executionLog.push(`Verification root: ${verificationRoot}`);
  }
  const gateResult = await runHardGateVerification({
    executionRoot: verificationRoot,
    packageManager,
    scripts,
    executionLog,
  });
  const testGate = gateResult.gates.find((gate) => gate.gate === "tests");
  const buildGate = gateResult.gates.find((gate) => gate.gate === "build");
  const testReport = {
    passed: testGate?.status === "passed" ? 1 : 0,
    failed: testGate?.status === "failed" ? 1 : 0,
    skipped: testGate?.status === "skipped" ? 1 : 0,
    duration: `${gateResult.gates.reduce((count, gate) => count + gate.attempts, 0)} gate attempts`,
    output: testGate?.output ?? "Tests gate did not run.",
  };
  const buildReport = {
    success: buildGate?.status === "passed",
    warnings: gateResult.gates.filter((gate) => gate.status === "skipped").length,
    output: buildGate?.output ?? "Build gate did not run.",
  };

  if (!gateResult.allRequiredPassed) {
    await restoreScopedFiles(executionRoot, scopedSnapshots);
    markWorkflow("gated", "Verification failed.");
    markWorkflow("rolled_back", "Scoped Gemini CLI edits were restored after gate failure.");
    await appendCodeRunEventSafe({
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventType: "RUN_FAILED",
      summary: "Verification failed and Gemini CLI edits were rolled back.",
      detail: "Scoped files were restored after a failed gate.",
    });
    return {
      applied: false,
      applyOutput: "Gemini CLI changed files, but verification failed and the snapshot was restored.",
      workflow: {
        current: "rolled_back",
        history: workflowHistory,
      },
      gates: gateResult.gates,
      testReport,
      buildReport,
      executionLog: [...executionLog, "Verification failed. Scoped snapshot restored."],
      appliedFiles: resolvedFiles,
      appliedDiff,
      ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    };
  }

  markWorkflow("gated", "Verification passed.");
  markWorkflow("promoted", "Verified Gemini CLI scoped edit kept.");
  executionLog.push("Agent step 5/5: verification passed and result can be published.");
  await appendCodeRunEventSafe({
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventType: "RUN_SUCCEEDED",
    summary: "Gemini CLI scoped edit verified successfully.",
    detail: `${resolvedFiles.length} file(s) changed.`,
  });

  if (executionTarget.sourceRoot) {
    await syncMirrorToPlayground(executionRoot, executionTarget.sourceRoot, resolvedFiles);
    executionLog.push("Synced verified files to playground server (localhost:3100).");
    const playgroundSnapshot = await snapshotPlaygroundGit({
      sourceRoot: executionTarget.sourceRoot,
      task: input.task,
    });
    executionLog.push(playgroundSnapshot.note);
  }

  return {
    applied: true,
    applyOutput: editSummary || "Gemini CLI applied scoped terminal edits.",
    workflow: {
      current: "promoted",
      history: workflowHistory,
    },
    gates: gateResult.gates,
    testReport,
    buildReport,
    executionLog,
    ...(executionTarget.previewUrl ? { previewUrl: executionTarget.previewUrl } : {}),
    appliedDiff,
    appliedFiles: resolvedFiles,
  };
}
