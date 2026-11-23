import fs from "node:fs/promises";
import path from "node:path";
import {
  SessionReport,
  SessionReportMeta,
  TaskReportItem,
  DevTaskResult,
  WriteMode,
  SafetyLevel,
} from "./devTaskTypes";

type ReportSource = {
  sessionId?: string;
  projectRoot: string;
  startedAt?: string;
  finishedAt?: string;
  applyMode?: unknown;
  writeMode?: unknown;
  safetyLevel?: unknown;
  tasks?: DevTaskResult[];
  results?: DevTaskResult[];
  overallRiskLevel?: unknown;
  overallRiskReason?: unknown;
  overallChecks?: unknown;
  blocked?: unknown;
  blockedReason?: unknown;
  applyBlockedDueToChecks?: unknown;
  preApply?: unknown;
};

function summarizeDiff(result: DevTaskResult): string | undefined {
  if (result.changedLines !== undefined && result.changeRatio !== undefined) {
    const percent = Math.round((result.changeRatio || 0) * 100);
    return `${result.changedLines} lines (~${percent}%)`;
  }
  if (result.diff) {
    const lines = result.diff.split("\n");
    const diffLines = lines.filter((l) => l.startsWith("+") || l.startsWith("-")).length;
    return `${diffLines} diff lines`;
  }
  return undefined;
}

function summarizeTasks(tasks: DevTaskResult[]): string {
  if (!tasks || tasks.length === 0) {
    return "Keine Tasks ausgeführt.";
  }
  const lines = tasks.map((t) => {
    const status = t.status || "unknown";
    const file = t.file || "n/a";
    const summary = t.summary || "";
    return `- ${t.id}: ${file} (${status})${summary ? ` – ${summary}` : ""}`;
  });
  return lines.join("\n");
}

export function buildSessionReport(result: ReportSource): SessionReport {
  const sessionId = result.sessionId || "unknown-session";
  const startedAt = result.startedAt || new Date().toISOString();
  const finishedAt = result.finishedAt || new Date().toISOString();
  const meta: SessionReportMeta = {
    sessionId,
    startedAt,
    finishedAt,
    projectRoot: result.projectRoot,
    writeMode: result.writeMode as WriteMode | undefined,
    safetyLevel: result.safetyLevel as SafetyLevel | undefined,
  };

  const tasks: TaskReportItem[] = (result.tasks || result.results || []).map((task: DevTaskResult) => ({
    id: task.id,
    mode: task.mode || "refactor",
    file: task.file || "unknown",
    writeMode: task.writeMode,
    safetyLevel: task.safetyLevel,
    status: task.status,
    summary: task.summary,
    diffSummary: summarizeDiff(task),
    blockedReason: task.blockedReason,
  }));

  const overallSummary = `Diese Autopilot-Session hat ${tasks.length} Tasks ausgeführt:\n${summarizeTasks(
    tasks
  )}`;

  return {
    meta,
    tasks,
    overallSummary,
  };
}

function renderTask(task: TaskReportItem): string {
  const lines: string[] = [];
  lines.push(`### ${task.id} – ${task.file}`);
  lines.push("");
  lines.push(`- Status: ${task.status}`);
  lines.push(
    `- Mode: ${task.mode} (writeMode=${task.writeMode || "n/a"}, safety=${task.safetyLevel || "n/a"})`
  );
  if (task.summary) lines.push(`- Kurzbeschreibung: ${task.summary}`);
  if (task.diffSummary) lines.push(`- Diff: ${task.diffSummary}`);
  if (task.testsBefore) lines.push(`- Tests before: ${task.testsBefore.length}`);
  if (task.testsAfter) lines.push(`- Tests after: ${task.testsAfter.length}`);
  if (task.testsBlockedApply) lines.push(`- Blocked by tests`);
  if (task.blockedReason) lines.push(`- Blocked reason: ${task.blockedReason}`);
  lines.push("");
  return lines.join("\n");
}

export function renderSessionReportMarkdown(report: SessionReport): string {
  const { meta } = report;
  const lines: string[] = [];
  lines.push(`# Autopilot Session Report – ${meta.sessionId}`);
  lines.push("");
  lines.push(`- **Projekt**: \`${meta.projectRoot}\``);
  lines.push(`- **Start**: \`${meta.startedAt}\``);
  lines.push(`- **Ende**: \`${meta.finishedAt}\``);
  lines.push(`- **WriteMode**: \`${meta.writeMode ?? "n/a"}\``);
  lines.push(`- **Safety**: \`${meta.safetyLevel ?? "n/a"}\``);
  lines.push("");
  lines.push("## Zusammenfassung");
  lines.push("");
  lines.push(report.overallSummary || "Keine Zusammenfassung verfügbar.");
  lines.push("");
  lines.push("## Tasks");
  lines.push("");
  report.tasks.forEach((task) => {
    lines.push(renderTask(task));
  });

  return lines.join("\n");
}

export async function writeSessionReportMarkdown(
  baseDir: string,
  sessionId: string,
  markdown: string
): Promise<string> {
  const safeId = sessionId || "session";
  const fileName = `${safeId}.md`;
  await fs.mkdir(baseDir, { recursive: true });
  const filePath = path.join(baseDir, fileName);
  await fs.writeFile(filePath, markdown, "utf8");
  return filePath;
}
