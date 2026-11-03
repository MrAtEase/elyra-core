import path from "path";
import fs from "node:fs/promises";
import * as ts from "typescript";
import { readFileUtf8, writeFileUtf8 } from "./fsService";
import { callCodexForTask } from "./llmService";
import {
  DevTask,
  DevTaskResult,
  ApplyMode,
  PreviewChange,
  WriteMode,
  SafetyLevel,
  DevTaskBackupInfo,
  SingleEditTaskResult,
  SingleEditRunOptions,
} from "./devTaskTypes";
import { createHash } from "node:crypto";

function extractSelectedCode(fullFileContent: string, task: DevTask): string {
  const { startLine, endLine } = task.target;

  if (!startLine || !endLine) {
    return fullFileContent;
  }

  const lines = fullFileContent.split("\n");
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = Math.min(lines.length, endLine);
  const selectedLines = lines.slice(startIndex, endIndex);

  return selectedLines.join("\n");
}

export function buildPrompt(task: DevTask, selectedCode: string): string {
  return [
    "Aufgabe:",
    task.goal,
    "",
    `mode: ${task.mode}`,
    `file: ${task.target.file}`,
    "",
    "Code:",
    selectedCode,
  ].join("\n");
}

function applyNewCode(
  fullFileContent: string,
  task: DevTask,
  newSelectedCode: string,
): string {
  const { startLine, endLine } = task.target;

  // Wenn kein Bereich angegeben ist, ersetzen wir die ganze Datei.
  if (!startLine || !endLine) {
    return newSelectedCode;
  }

  const lines = fullFileContent.split("\n");
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = Math.min(lines.length, endLine);

  const before = lines.slice(0, startIndex);
  const after = lines.slice(endIndex);
  const newSelectedLines = newSelectedCode.split("\n");

  const combined = [...before, ...newSelectedLines, ...after];
  return combined.join("\n");
}

function buildUnifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const diffLines: string[] = [];
  diffLines.push(`--- a/${filePath}`);
  diffLines.push(`+++ b/${filePath}`);
  for (let i = 0; i < maxLen; i += 1) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) continue;
    if (a !== undefined) diffLines.push(`-${a}`);
    if (b !== undefined) diffLines.push(`+${b}`);
  }
  return diffLines.join("\n");
}

function computeChangeStats(before: string, after: string): { changedLines: number; changeRatio: number } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length, 1);
  let changedLines = Math.abs(beforeLines.length - afterLines.length);
  const minLen = Math.min(beforeLines.length, afterLines.length);
  for (let i = 0; i < minLen; i += 1) {
    if (beforeLines[i] !== afterLines[i]) {
      changedLines += 1;
    }
  }
  return { changedLines, changeRatio: changedLines / maxLen };
}

function checkSyntaxSafety(code: string, fileName: string): string | null {
  const result = ts.transpileModule(code, {
    fileName,
    compilerOptions: { noEmit: true },
    reportDiagnostics: true,
  });
  const diagnostics = result.diagnostics?.filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (diagnostics && diagnostics.length > 0) {
    const first = diagnostics[0];
    const message = ts.flattenDiagnosticMessageText(first.messageText, "\n");
    return `Syntax error: ${message}`;
  }
  return null;
}

function shouldBlockStrict(before: string, after: string): { blocked: boolean; reason?: string } {
  const { changedLines, changeRatio } = computeChangeStats(before, after);
  if (changedLines > 200) {
    return { blocked: true, reason: `Change too large: ${changedLines} changed lines (>200)` };
  }
  if (changeRatio > 0.3) {
    const percent = Math.round(changeRatio * 100);
    return { blocked: true, reason: `Change ratio too high: ${percent}% (>30%)` };
  }
  return { blocked: false };
}

async function createBackupForFile(
  projectRoot: string,
  relativeFile: string,
  content: string
): Promise<DevTaskBackupInfo> {
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const backupRoot = path.join(projectRoot, ".autopilot-backup", timestamp);
  const backupPath = path.join(backupRoot, relativeFile);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, content, "utf8");
  return {
    id: path.relative(projectRoot, backupRoot),
    rootDir: backupRoot,
    files: [relativeFile],
  };
}

function summarizeChange(file: string, before: string, after: string, writeMode: WriteMode, blocked: boolean): string {
  const { changedLines, changeRatio } = computeChangeStats(before, after);
  const percent = Math.round(changeRatio * 100);
  if (blocked) {
    return `Blocked update for ${file} (${changedLines} lines diff, ${percent}% change)`;
  }
  if (writeMode === "apply") {
    return `Applied changes to ${file} (${changedLines} lines diff, ${percent}% change)`;
  }
  return `Previewed changes for ${file} (${changedLines} lines diff, ${percent}% change)`;
}

export async function runDevTask(task: DevTask): Promise<DevTaskResult> {
  const resolvedRoot = path.resolve(task.projectRoot);
  const filePath = path.resolve(resolvedRoot, task.target.file);
  const applyMode: ApplyMode = task.applyMode ?? "apply";
  const writeMode: WriteMode = task.writeMode ?? applyMode ?? "apply";
  const safetyLevel: SafetyLevel = task.safetyLevel ?? "none";

  try {
    if (!filePath.startsWith(resolvedRoot)) {
      throw new Error(`Path escapes project root: ${task.target.file}`);
    }

    const fullFileContent = await readFileUtf8(filePath);
    const selectedCode = extractSelectedCode(fullFileContent, task);
    const prompt = buildPrompt(task, selectedCode);

    console.log(
      `[DevTaskRunner] Prepared prompt (applyMode=${applyMode}, writeMode=${writeMode}, safety=${safetyLevel}):\n`,
      prompt
    );

    const newSelectedCode = await callCodexForTask({
      task,
      prompt,
      selectedCode,
    });

    const updatedContent = applyNewCode(fullFileContent, task, newSelectedCode);

    let blocked = false;
    let blockedReason: string | undefined;

    if (safetyLevel === "basic" || safetyLevel === "strict") {
      const syntaxError = checkSyntaxSafety(updatedContent, task.target.file);
      if (syntaxError) {
        blocked = true;
        blockedReason = syntaxError;
      }
    }

    if (!blocked && safetyLevel === "strict") {
      const strictCheck = shouldBlockStrict(fullFileContent, updatedContent);
      if (strictCheck.blocked) {
        blocked = true;
        blockedReason = strictCheck.reason;
      }
    }

    const diff = buildUnifiedDiff(task.target.file, fullFileContent, updatedContent);
    const summary = summarizeChange(task.target.file, fullFileContent, updatedContent, writeMode, blocked);
    const { changedLines, changeRatio } = computeChangeStats(fullFileContent, updatedContent);

    if (blocked) {
      console.warn(`[DevTaskRunner] blocked task ${task.id}: ${blockedReason}`);
      return {
        id: task.id,
        status: "failed",
        appliedMode: applyMode,
        writeMode,
        applied: false,
        file: task.target.file,
        safetyLevel,
        originalCode: fullFileContent,
        updatedCode: updatedContent,
        diff,
        summary,
        changedLines,
        changeRatio,
        blocked: true,
        blockedReason,
      };
    }

    const result: DevTaskResult = {
      id: task.id,
      status: "done",
      appliedMode: applyMode,
      writeMode,
      applied: writeMode === "apply",
      file: task.target.file,
      safetyLevel,
      diff,
      summary,
      changedLines,
      changeRatio,
    };

    if (writeMode === "apply") {
      const backup = await createBackupForFile(task.projectRoot, task.target.file, fullFileContent);
      await writeFileUtf8(filePath, updatedContent);
      return { ...result, backup };
    }

    const previewChange: PreviewChange = {
      file: task.target.file,
      before: fullFileContent,
      after: updatedContent,
    };

    return {
      ...result,
      previewChanges: [previewChange],
      originalCode: fullFileContent,
      updatedCode: updatedContent,
      applied: false,
    };

  } catch (error) {
    console.error("[DevTaskRunner] Error while running task:", error);

    const result: DevTaskResult = {
      id: task.id,
      status: "failed",
      appliedMode: task.applyMode ?? "apply",
      writeMode: task.writeMode ?? task.applyMode ?? "apply",
      applied: (task.writeMode ?? task.applyMode ?? "apply") === "apply",
      file: task.target.file,
      safetyLevel: task.safetyLevel ?? "none",
      errorMessage:
        error instanceof Error ? error.message : String(error),
    };

    return result;
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function runSingleFileEditTask(
  projectRoot: string,
  task: DevTask,
  options: SingleEditRunOptions = {}
): Promise<SingleEditTaskResult> {
  const writeMode: WriteMode = (options.writeMode as WriteMode) ?? task.writeMode ?? task.applyMode ?? "preview";
  const safetyLevel: SafetyLevel = (options.safetyLevel as SafetyLevel) ?? task.safetyLevel ?? "none";
  const resolvedRoot = path.resolve(projectRoot);
  const filePath = path.resolve(resolvedRoot, task.target.file);

  try {
    if (!filePath.startsWith(resolvedRoot)) {
      throw new Error(`Path escapes project root: ${task.target.file}`);
    }

    const fullFileContent = await readFileUtf8(filePath);
    const selectedCode = extractSelectedCode(fullFileContent, task);
    const prompt = buildPrompt(task, selectedCode);
    const newSelectedCode = await callCodexForTask({ task, prompt, selectedCode });
    const updatedContent = applyNewCode(fullFileContent, task, newSelectedCode);

    let blocked = false;
    let blockedReason: string | undefined;

    if (safetyLevel === "basic" || safetyLevel === "strict") {
      const syntaxError = checkSyntaxSafety(updatedContent, task.target.file);
      if (syntaxError) {
        blocked = true;
        blockedReason = syntaxError;
      }
    }

    if (!blocked && safetyLevel === "strict") {
      const strictCheck = shouldBlockStrict(fullFileContent, updatedContent);
      if (strictCheck.blocked) {
        blocked = true;
        blockedReason = strictCheck.reason;
      }
    }

    const diff = buildUnifiedDiff(task.target.file, fullFileContent, updatedContent);
    const summary = summarizeChange(task.target.file, fullFileContent, updatedContent, writeMode, blocked);
    const { changedLines, changeRatio } = computeChangeStats(fullFileContent, updatedContent);
    const diffSummary = `${changedLines} lines (${Math.round((changeRatio || 0) * 100)}%)`;

    const baseResult: SingleEditTaskResult = {
      id: task.id,
      file: task.target.file,
      mode: task.mode,
      status: blocked ? "failed" : "done",
      safetyLevel,
      writeMode,
      applied: writeMode === "apply" && !blocked,
      diff,
      summary,
      diffSummary,
      changedLines,
      changeRatio,
      originalCode: fullFileContent,
      updatedCode: updatedContent,
      originalContentHash: hashContent(fullFileContent),
      newContentHash: hashContent(updatedContent),
      blocked,
      blockedReason,
    };

    if (blocked) {
      return baseResult;
    }

    if (writeMode === "apply") {
      const backup = await createBackupForFile(projectRoot, task.target.file, fullFileContent);
      await writeFileUtf8(filePath, updatedContent);
      return { ...baseResult, backup };
    }

    return {
      ...baseResult,
      applied: false,
      previewChanges: [
        { file: task.target.file, before: fullFileContent, after: updatedContent },
      ],
    };
  } catch (error) {
    console.error("[DevTaskRunner] Error in runSingleFileEditTask:", error);
    return {
      id: task.id,
      file: task.target.file,
      mode: task.mode,
      status: "failed",
      writeMode: (options.writeMode as WriteMode) ?? task.writeMode ?? task.applyMode ?? "preview",
      safetyLevel: (options.safetyLevel as SafetyLevel) ?? task.safetyLevel ?? "none",
      applied: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
