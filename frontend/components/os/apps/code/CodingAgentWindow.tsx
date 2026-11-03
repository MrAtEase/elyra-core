"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  FileDiff,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  GitPullRequest,
  Hammer,
  ImagePlus,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { useWhoamiLoader } from "@/lib/auth/useWhoamiLoader";
import { useLocale } from "@/components/providers/LocaleProvider";
import { CODING_SKILLS, type CodingSkill } from "@/types/taskContract";

// ── Types ──────────────────────────────────────────────────────────────────────

import type { RunPhase, PlanStep, PlanArtifact, FileChanged, ReviewFinding, InvestigatorLogEntry, ResultArtifact, ProviderStatus, LiveRunEvent, ProviderStatusMap, ChatMessage, SkillInfo, RepoOption, FolderOption, FileOption, SuggestedScope, AttachmentDraft, CenterTab, PromotionStage, AgentRole, ExecutionMode, TeamMode, TeamConfig, LocalRunStatus, LocalAgentRunRecord, QueuedAgentTask, PlaygroundVersion, PromotionAuditRecord, ContractDeliverable, ExecutionContract } from "@/types/agent";





function mergeLiveRunEvents(current: LiveRunEvent[], incoming: LiveRunEvent[]): LiveRunEvent[] {
  const merged = new Map<string, LiveRunEvent>();
  for (const event of current) {
    merged.set(event.id, event);
  }
  for (const event of incoming) {
    merged.set(event.id, event);
  }
  return [...merged.values()].slice(-20);
}

function looksLikeBroadAnalysisTask(task: string): boolean {
  const lower = task.toLowerCase();
  const analysisIntent =
    /(scan|scanne|audit|review|analys|analyse|inspect|find|list|nenne|top\s*\d+|probleme|issues|risks|root cause|ursache)/.test(
      lower,
    );
  const repoTarget =
    /(repo|repository|project|projekt|codebase|gesamte|entire|whole|app|service|integration)/.test(lower);
  return analysisIntent && repoTarget;
}

function looksLikeWholeRepoReviewTask(task: string): boolean {
  const lower = task.toLowerCase();
  const reviewIntent =
    /(scan|scanne|audit|review|analys|analyse|inspect|find|list|show|nenne|top\s*\d+|issues|probleme|errors|risks)/.test(
      lower,
    );
  const wholeRepoTarget =
    /(whole repo|whole repository|entire repo|entire repository|full repo|gesamte[sr]?\s+repo|ganze[sr]?\s+repo|gesamte[sr]?\s+repository|full codebase|entire codebase)/.test(
      lower,
    );
  return reviewIntent && wholeRepoTarget;
}

function extractFilesFromUnifiedDiff(diff: string): string[] {
  if (!diff.trim()) return [];
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const targetPath = match?.[2]?.trim();
    if (targetPath) files.add(targetPath);
  }
  return [...files];
}


// ── Helpers ────────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (v != null ? String(v) : "");
const has = (v: unknown): boolean => v != null && v !== "";

const SKILL_ICONS: Record<CodingSkill, typeof Hammer> = {
  "fix-build":          Hammer,
  "implement-feature":  Sparkles,
  "refactor-module":    RefreshCw,
  "write-tests":        FlaskConical,
  "review-code":        Search,
  "add-types":          Code2,
  "ux-ui-design":       Sparkles,
  "security-scan":      Shield,
  "tdd-guide":          FlaskConical,
  "db-review":          FileText,
  "perf-audit":         Gauge,
  "api-design":         GitPullRequest,
  "code-explain":       MessageSquare,
  "custom":             Terminal,
};
const LOCAL_RUN_LEDGER_KEY = "elyra_agent_runs";
const LOCAL_RUN_ARTIFACT_PREFIX = "elyra_agent_run_artifact";
const LOCAL_AGENT_QUEUE_PREFIX = "elyra_agent_queue";
const PENDING_CODE_RUN_ID_KEY = "elyra_pending_code_run_id";
const LAST_REPO_URL_KEY = "elyra_last_repo_url";
const PLAN_REQUEST_TIMEOUT_MS = 300_000;  // 5 min — Gemini/OpenAI need 2-4 min for large repo context
const EXECUTE_REQUEST_TIMEOUT_MS = 600_000; // 10 min — large diffs + build gate can take 8+ min
const AGENT_ROLE_OPTIONS: Array<{ value: AgentRole; label: string }> = [
  { value: "general", label: "General" },
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "ui", label: "UI/Design" },
  { value: "infra", label: "Infra/Runtime" },
  { value: "qa", label: "QA/Tests" },
];
const DEFAULT_TEAM_CONFIG: TeamConfig = {
  general: 0,
  frontend: 2,
  backend: 1,
  ui: 1,
  infra: 0,
  qa: 1,
};





const SUGGESTED_SCOPE_MATCHERS: Array<{ reason: string; patterns: RegExp[]; filePatterns: RegExp[] }> = [
  {
    reason: "Identity / profile menu",
    patterns: [/\bmenu\b/i, /\bmenü\b/i, /\bprofile\b/i, /\bprofil\b/i, /\baccount\b/i, /\bkonto\b/i, /\bidentity\b/i, /\bdropdown\b/i],
    filePatterns: [/IdentityMenu\.tsx$/i],
  },
  {
    reason: "Weather app",
    patterns: [/\bwetter\b/i, /\bweather\b/i, /\bsurf\b/i, /\bforecast\b/i],
    filePatterns: [/WeatherWindow\.tsx$/i],
  },
  {
    reason: "Intent line / composer",
    patterns: [/\bintent\b/i, /\bcomposer\b/i, /\bchat input\b/i, /\benter\b/i, /\bshift\+enter\b/i],
    filePatterns: [/IntentLine\.tsx$/i],
  },
  {
    reason: "AI dock / chat",
    patterns: [/\bdock\b/i, /\bchat\b/i, /\bthread\b/i, /\bassistant\b/i],
    filePatterns: [/AIDock\.tsx$/i, /Chat/i],
  },
  {
    reason: "Workspace shell / routing",
    patterns: [/\bworkspace\b/i, /\brouting\b/i, /\bos shell\b/i, /\bwindow\b/i],
    filePatterns: [/WorkspaceOS\.tsx$/i, /windowManager\.ts$/i, /WindowChrome\.tsx$/i],
  },
  {
    reason: "Mail app",
    patterns: [/\bmail\b/i, /\binbox\b/i, /\bgmail\b/i, /\bdraft\b/i],
    filePatterns: [/MailProgram\.tsx$/i],
  },
  {
    reason: "Calendar app",
    patterns: [/\bcalendar\b/i, /\bkalender\b/i, /\bweek\b/i, /\bevent\b/i],
    filePatterns: [/CalendarProgram\.tsx$/i],
  },
  {
    reason: "Tasks app",
    patterns: [/\btask\b/i, /\btodo\b/i, /\baufgabe\b/i],
    filePatterns: [/TasksApp\.tsx$/i],
  },
  {
    reason: "Builder / workflow",
    patterns: [/\bbuilder\b/i, /\bworkflow\b/i, /\bautomation\b/i],
    filePatterns: [/BuilderWindow\.tsx$/i, /StudioWindow\.tsx$/i],
  },
  {
    reason: "Code orchestration backend",
    patterns: [/\bcoder\b/i, /\bcode run\b/i, /\borchestrator\b/i, /\bagent\b/i],
    filePatterns: [/app\/api\/os\/code\/run\/route\.ts$/i, /ChiefOrchestratorConsole\.tsx$/i, /WorkspaceShell\.tsx$/i],
  },
];

/**
 * Converts a raw event summary into Elly's voice.
 * - Already first-person (starts with "Ich ", "Hmm", "Ah", etc.) → pass through
 * - Legacy robotic format "Elly → toolname" → humanize
 * - System noise phrases → friendly equivalents
 */
function elliVoice(summary: string | undefined | null): string {
  if (!summary) return "Elly arbeitet…";
  // Already Elly voice — first-person German or English narration
  if (/^(Ich |Hmm|Ah |Ok,|Fertig|Moment|Let |Da |So |Was |Das |✓ )/.test(summary)) return summary;
  // Legacy robotic "Elly → toolname" format (before the think key was added)
  if (summary.startsWith("Elly → ")) {
    const tool = summary.slice(7).trim();
    const map: Record<string, string> = {
      read_file:    "Datei lesen…",
      write_file:   "Datei schreiben…",
      list_dir:     "Verzeichnis erkunden…",
      search_files: "Suchen…",
      run_command:  "Befehl ausführen…",
    };
    return map[tool] ?? summary;
  }
  // System messages
  if (summary === "Elly is thinking…") return "Ich denke kurz nach…";
  if (/marked the task as complete/i.test(summary)) return "Fertig!";
  if (/^Elly →/.test(summary)) return summary.replace("Elly →", "").trim();
  return summary;
}

function parseInvestigatorLogLine(line: string): InvestigatorLogEntry {
  const trimmed = line.trim();
  if (!trimmed) {
    return { kind: "plain", title: "" };
  }
  if (/^Thinking:\s*/i.test(trimmed)) {
    return {
      kind: "thinking",
      title: "Thinking",
      detail: trimmed.replace(/^Thinking:\s*/i, "").trim(),
    };
  }
  if (/^check\s+/i.test(trimmed)) {
    const body = trimmed.replace(/^check\s+/i, "").trim();
    const firstSpace = body.indexOf(" ");
    const entry: InvestigatorLogEntry = {
      kind: "tool",
      title: firstSpace > 0 ? body.slice(0, firstSpace) : body,
    };
    if (firstSpace > 0) {
      entry.detail = body.slice(firstSpace + 1).trim();
    }
    return entry;
  }
  if (/^Generated by Gemini\s+/i.test(trimmed)) {
    return {
      kind: "status",
      title: "Gemini",
      detail: trimmed.replace(/^Generated by Gemini\s+/i, "").trim(),
    };
  }
  // Plain entries: always store full text as detail so the <details> element
  // can be expanded to show the complete (non-truncated) message.
  return { kind: "plain", title: trimmed, detail: trimmed };
}

function scoreSuggestedScope(task: string, fileOptions: FileOption[]): SuggestedScope | null {
  const normalizedTask = task.trim().toLowerCase();
  if (!normalizedTask || fileOptions.length === 0) return null;

  const explicitPathMatches = fileOptions
    .filter((option) => normalizedTask.includes(option.value.toLowerCase()) || normalizedTask.includes(option.label.toLowerCase()))
    .map((option) => option.value);
  if (explicitPathMatches.length > 0) {
    return {
      reason: "Matched explicit file path from the task.",
      files: explicitPathMatches.slice(0, 6),
    };
  }

  const keywordScores = new Map<string, number>();
  const matchedReasons: string[] = [];
  for (const matcher of SUGGESTED_SCOPE_MATCHERS) {
    if (!matcher.patterns.some((pattern) => pattern.test(task))) continue;
    matchedReasons.push(matcher.reason);
    for (const option of fileOptions) {
      if (matcher.filePatterns.some((pattern) => pattern.test(option.value) || pattern.test(option.label))) {
        keywordScores.set(option.value, (keywordScores.get(option.value) ?? 0) + 3);
      }
    }
  }

  const tokenHints = normalizedTask
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  for (const option of fileOptions) {
    const haystack = `${option.label} ${option.value}`.toLowerCase();
    for (const token of tokenHints) {
      if (haystack.includes(token)) {
        keywordScores.set(option.value, (keywordScores.get(option.value) ?? 0) + 1);
      }
    }
  }

  const ranked = [...keywordScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file)
    .slice(0, 6);
  if (ranked.length === 0) return null;

  return {
    reason:
      matchedReasons.length > 0
        ? `Matched app or feature hints: ${[...new Set(matchedReasons)].join(", ")}.`
        : "Matched filenames and task keywords.",
    files: ranked,
  };
}

type DockRunStepStatus = "pending" | "running" | "completed" | "failed";

function publishDockRunUpdate(input: {
  text: string;
  status: "running" | "completed" | "failed";
  steps: Array<{ id: string; label: string; status: DockRunStepStatus; detail?: string }>;
}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("elyra:code-run-update", { detail: input }));
}

function clearDockRunUpdate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("elyra:code-run-update", { detail: { clear: true } }));
}

function loadRunLedger(): LocalAgentRunRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_RUN_LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalAgentRunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRunLedger(records: LocalAgentRunRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_RUN_LEDGER_KEY, JSON.stringify(records.slice(0, 40)));
    window.dispatchEvent(new CustomEvent("elyra:run-ledger-updated"));
  } catch {
    // ignore
  }
}

function runArtifactStorageKey(runId: string) {
  return `${LOCAL_RUN_ARTIFACT_PREFIX}:${runId}`;
}

function saveRunArtifact(runId: string, artifact: ResultArtifact): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(runArtifactStorageKey(runId), JSON.stringify(artifact));
    return true;
  } catch (err) {
    // QuotaExceededError — artifact too large for localStorage (scan-repo findings can be several MB).
    // The caller should fall back to server-side persistence.
    const name = err instanceof Error ? err.name : String(err);
    console.warn(`[CodingAgentWindow] saveRunArtifact: localStorage write failed (${name}) for run ${runId}. Relying on server save.`);
    return false;
  }
}

function loadRunArtifact(runId: string): ResultArtifact | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(runArtifactStorageKey(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResultArtifact;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function saveRunArtifactServer(input: {
  run: LocalAgentRunRecord;
  artifact: ResultArtifact;
  workspaceId?: string;
}) {
  const headers = await withSupabaseAuthorization({
    "Content-Type": "application/json",
    ...(input.workspaceId ? { "x-workspace-id": input.workspaceId } : {}),
  });
  await fetch("/api/os/code/runs", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(input),
  });
}

async function loadRunRecordServer(
  runId: string,
  workspaceId: string,
): Promise<{ run: LocalAgentRunRecord | null; artifact: ResultArtifact | null }> {
  const headers = await withSupabaseAuthorization(
    workspaceId ? { "x-workspace-id": workspaceId } : {}
  );
  const query = new URLSearchParams();
  if (workspaceId) query.set("workspaceId", workspaceId);
  const response = await fetch(`/api/os/code/runs/${encodeURIComponent(runId)}${query.size ? `?${query.toString()}` : ""}`, {
    method: "GET",
    headers,
    credentials: "include",
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; run?: Partial<LocalAgentRunRecord>; artifact?: ResultArtifact }
    | null;
  if (!response.ok || !payload?.ok) {
    return { run: null, artifact: null };
  }
  const runApp: LocalAgentRunRecord["app"] =
    payload.run?.app === "orchestrator" ? "orchestrator" : "code";
  const runStage: LocalAgentRunRecord["stage"] =
    payload.run?.stage === "dev" || payload.run?.stage === "prod" ? payload.run.stage : "playground";
  const runStatus: LocalAgentRunRecord["status"] =
    payload.run?.status === "planning" ||
    payload.run?.status === "running" ||
    payload.run?.status === "failed" ||
    payload.run?.status === "completed"
      ? payload.run.status
      : "completed";
  const run = payload.run && typeof payload.run === "object"
    ? {
        id: typeof payload.run.id === "string" ? payload.run.id : runId,
        app: runApp,
        agent: typeof payload.run.agent === "string" ? payload.run.agent : "custom",
        task: typeof payload.run.task === "string" ? payload.run.task : "Untitled code task",
        repoUrl: typeof payload.run.repoUrl === "string" ? payload.run.repoUrl : "",
        branch: typeof payload.run.branch === "string" ? payload.run.branch : "main",
        workspaceId: typeof payload.run.workspaceId === "string" ? payload.run.workspaceId : workspaceId,
        stage: runStage,
        status: runStatus,
        startedAt: typeof payload.run.startedAt === "number" ? payload.run.startedAt : Date.now(),
        updatedAt: typeof payload.run.updatedAt === "number" ? payload.run.updatedAt : Date.now(),
        ...(typeof payload.run.folderPath === "string" ? { folderPath: payload.run.folderPath } : {}),
        ...(Array.isArray(payload.run.selectedFiles)
          ? { selectedFiles: payload.run.selectedFiles.map((item) => String(item)).filter(Boolean).slice(0, 12) }
          : {}),
        ...(typeof payload.run.summary === "string" ? { summary: payload.run.summary } : {}),
        ...(typeof payload.run.previewUrl === "string" ? { previewUrl: payload.run.previewUrl } : {}),
        ...(typeof payload.run.filesChanged === "number" ? { filesChanged: payload.run.filesChanged } : {}),
        ...(typeof payload.run.estimatedCostUsd === "number" ? { estimatedCostUsd: payload.run.estimatedCostUsd } : {}),
        ...(typeof payload.run.replayId === "string" ? { replayId: payload.run.replayId } : {}),
        ...(typeof payload.run.gateFailures === "number" ? { gateFailures: payload.run.gateFailures } : {}),
      }
    : null;
  const artifact = payload.artifact && typeof payload.artifact === "object" ? payload.artifact : null;
  return { run, artifact };
}

function loadAgentQueue(workspaceId: string): QueuedAgentTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${LOCAL_AGENT_QUEUE_PREFIX}:${workspaceId || "global"}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<QueuedAgentTask>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const task = typeof item.task === "string" ? item.task : "";
        if (!task) return null;
        return {
          id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
          role: (item.role ?? "general") as AgentRole,
          skill: (item.skill ?? "custom") as CodingSkill,
          task,
          repoUrl: typeof item.repoUrl === "string" ? item.repoUrl : "",
          branch: typeof item.branch === "string" ? item.branch : "main",
          folderPath: typeof item.folderPath === "string" ? item.folderPath : "",
          selectedFiles: Array.isArray(item.selectedFiles) ? item.selectedFiles.map((value) => String(value)) : [],
          stage: (item.stage ?? "playground") as PromotionStage,
          terminalAccess: typeof item.terminalAccess === "boolean" ? item.terminalAccess : true,
          useReasoning: typeof item.useReasoning === "boolean" ? item.useReasoning : false,
          branchPerAgent: typeof item.branchPerAgent === "boolean" ? item.branchPerAgent : true,
          executionMode: item.executionMode === "strict" ? "strict" : "adaptive",
          vibeCoding: typeof item.vibeCoding === "boolean" ? item.vibeCoding : true,
          teamMode: item.teamMode === "manual" ? "manual" : "auto",
          teamConfig: {
            general: typeof item.teamConfig === "object" && item.teamConfig && typeof (item.teamConfig as Record<string, unknown>).general === "number" ? Number((item.teamConfig as Record<string, unknown>).general) : DEFAULT_TEAM_CONFIG.general,
            frontend: typeof item.teamConfig === "object" && item.teamConfig && typeof (item.teamConfig as Record<string, unknown>).frontend === "number" ? Number((item.teamConfig as Record<string, unknown>).frontend) : DEFAULT_TEAM_CONFIG.frontend,
            backend: typeof item.teamConfig === "object" && item.teamConfig && typeof (item.teamConfig as Record<string, unknown>).backend === "number" ? Number((item.teamConfig as Record<string, unknown>).backend) : DEFAULT_TEAM_CONFIG.backend,
            ui: typeof item.teamConfig === "object" && item.teamConfig && typeof (item.teamConfig as Record<string, unknown>).ui === "number" ? Number((item.teamConfig as Record<string, unknown>).ui) : DEFAULT_TEAM_CONFIG.ui,
            infra: typeof item.teamConfig === "object" && item.teamConfig && typeof (item.teamConfig as Record<string, unknown>).infra === "number" ? Number((item.teamConfig as Record<string, unknown>).infra) : DEFAULT_TEAM_CONFIG.infra,
            qa: typeof item.teamConfig === "object" && item.teamConfig && typeof (item.teamConfig as Record<string, unknown>).qa === "number" ? Number((item.teamConfig as Record<string, unknown>).qa) : DEFAULT_TEAM_CONFIG.qa,
          },
          budgetUsd: typeof item.budgetUsd === "number" ? item.budgetUsd : 5,
          deadlineMinutes: typeof item.deadlineMinutes === "number" ? item.deadlineMinutes : 60,
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        } satisfies QueuedAgentTask;
      })
      .filter((item): item is QueuedAgentTask => item !== null);
  } catch {
    return [];
  }
}

function saveAgentQueue(workspaceId: string, queue: QueuedAgentTask[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LOCAL_AGENT_QUEUE_PREFIX}:${workspaceId || "global"}`, JSON.stringify(queue.slice(0, 20)));
  } catch {
    // ignore
  }
}

async function postRunRequest(
  headers: HeadersInit,
  body: Record<string, unknown>,
  timeoutMs: number,
  phaseLabel: "plan" | "execute",
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch("/api/os/code/run", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${phaseLabel} request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function parseJsonResponse<T>(response: Response, phaseLabel: "plan" | "execute"): Promise<T> {
  const raw = await response.text().catch(() => "");
  if (!raw.trim()) {
    throw new Error(`${phaseLabel} request returned an empty response body.`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${phaseLabel} request returned invalid JSON.`);
  }
}

// ── Diff line coloring ─────────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return <p className="text-xs text-[color:var(--text-muted)]">No diff available.</p>;
  const lines = diff.split("\n");
  return (
    <pre className="overflow-x-auto text-xs leading-5 font-mono">
      {lines.map((line, i) => {
        let cls = "text-[color:var(--text-secondary)]";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "text-[color:var(--text-secondary)] opacity-60";
        else if (line.startsWith("+")) cls = "text-emerald-400 bg-emerald-400/5";
        else if (line.startsWith("-")) cls = "text-red-400 bg-red-400/5";
        else if (line.startsWith("@@")) cls = "text-sky-400 opacity-80";
        return (
          <span key={i} className={`block whitespace-pre ${cls}`}>{line || " "}</span>
        );
      })}
    </pre>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CodingAgentWindow() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryWorkspaceId =
    searchParams.get("workspaceId")?.trim() ??
    searchParams.get("workspace_id")?.trim() ??
    "";
  const { data: whoami } = useWhoamiLoader();
  const { resolvedLanguage } = useLocale();
  const effectiveWorkspaceId = queryWorkspaceId || whoami?.activeWorkspace?.id?.trim() || "";
  const activeWorkspaceLabel =
    whoami?.activeWorkspace?.name?.trim() ||
    whoami?.activeWorkspace?.slug?.trim() ||
    effectiveWorkspaceId ||
    "current workspace";

  // ── Provider & skill metadata ────────────────────────────────────────────────
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusMap>({});
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [toolAllowlist, setToolAllowlist] = useState<Array<{ cmd: string; description: string }>>([]);
  const [repoOptions, setRepoOptions] = useState<RepoOption[]>([]);
  const [folderOptions, setFolderOptions] = useState<FolderOption[]>([]);
  const [fileOptions, setFileOptions] = useState<FileOption[]>([]);

  // ── Repo config ──────────────────────────────────────────────────────────────
  // Restore last repo URL immediately so we don't flash "Custom repository" on every reload
  const [repoUrl, setRepoUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(LAST_REPO_URL_KEY) ?? "";
  });
  const [branch, setBranch] = useState("main");
  const [folderPath, setFolderPath] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFilesPinned, setSelectedFilesPinned] = useState(false);

  // ── Task config ──────────────────────────────────────────────────────────────
  const [selectedSkill, setSelectedSkill] = useState<CodingSkill>("custom");
  const [agentRole, setAgentRole] = useState<AgentRole>("general");
  const [taskText, setTaskText] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("auto");
  const [useReasoning, setUseReasoning] = useState(false);
  const [terminalAccess, setTerminalAccess] = useState(true);
  const [branchPerAgent, setBranchPerAgent] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("adaptive");
  const [vibeCoding, setVibeCoding] = useState(true);
  const [teamMode, setTeamMode] = useState<TeamMode>("auto");
  const [teamConfig, setTeamConfig] = useState<TeamConfig>(DEFAULT_TEAM_CONFIG);
  const [autoCommit, setAutoCommit] = useState(false);
  // Auto-enable GitHub PR mode when running from a cloud URL (not localhost).
  const [githubMode, setGithubMode] = useState(
    () => typeof window !== "undefined" && !window.location.hostname.includes("localhost")
  );
  const [suggestionsOnly, setSuggestionsOnly] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [designDraftUrl, setDesignDraftUrl] = useState("");

  // ── Run state ────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [planArtifact, setPlanArtifact] = useState<PlanArtifact | null>(null);
  const [resultArtifact, setResultArtifact] = useState<ResultArtifact | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // GitHub Cloud Coder: PR URL returned after successful apply + push
  const [ghPrUrl, setGhPrUrl] = useState<string | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("chat");

  // Simple mode hides advanced controls — on by default for a cleaner vibe-coding UX
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("elyra_coder_simple_mode");
    return stored === null ? true : stored === "true";
  });

  const [approved, setApproved] = useState(false);
  const [providerDropOpen, setProviderDropOpen] = useState(false);
  const [showAllowlist, setShowAllowlist] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  const [autoRunRequested, setAutoRunRequested] = useState(false);
  const [autoExecuteRequested, setAutoExecuteRequested] = useState(false);
  const [deliveryStage, setDeliveryStage] = useState<PromotionStage>("playground");
  const [budgetUsd, setBudgetUsd] = useState(5);
  const [deadlineMinutes, setDeadlineMinutes] = useState(60);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [queuedTasks, setQueuedTasks] = useState<QueuedAgentTask[]>([]);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [orchestratorProgress, setOrchestratorProgress] = useState<{
    activeTask: string;
    index: number;
    total: number;
    status: "planning" | "executing" | "done" | "failed";
    completed: number;
    failed: number;
  } | null>(null);
  const [queueConcurrency, setQueueConcurrency] = useState(2);
  const [playgroundVersions, setPlaygroundVersions] = useState<PlaygroundVersion[]>([]);
  const [playgroundHead, setPlaygroundHead] = useState<string | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollbackCommit, setRollbackCommit] = useState<string | null>(null);
  const [promotingMain, setPromotingMain] = useState(false);
  const [promotionAudit, setPromotionAudit] = useState<PromotionAuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [liveRunEvents, setLiveRunEvents] = useState<LiveRunEvent[]>([]);
  const strictAiMode = executionMode === "strict";
  const [contractMode, setContractMode] = useState<"product_build" | "company_launch">("product_build");
  const [executionContract, setExecutionContract] = useState<ExecutionContract | null>(null);
  const [contractApproved, setContractApproved] = useState(false);
  const lastOpenedRunIdRef = useRef<string | null>(null);
  const isRunning = phase === "planning" || phase === "executing";

  const logsEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const orchestratorStopRef = useRef(false);
  const requestHeaders = useCallback(
    async (init?: HeadersInit) =>
      withSupabaseAuthorization({
        ...init,
        ...(effectiveWorkspaceId ? { "x-workspace-id": effectiveWorkspaceId } : {}),
      }),
    [effectiveWorkspaceId],
  );

  const suggestedScope = useMemo(
    () => scoreSuggestedScope(taskText, fileOptions),
    [taskText, fileOptions],
  );
  const wholeRepoReviewMode =
    selectedSkill === "review-code" &&
    suggestionsOnly &&
    looksLikeWholeRepoReviewTask(taskText);
  const isReviewOnlyResult = selectedSkill === "review-code" && suggestionsOnly;
  const effectiveSelectedFiles = useMemo(
    () =>
      wholeRepoReviewMode
        ? []
        : selectedFiles.length > 0
          ? selectedFiles
          : suggestedScope?.files.slice(0, 12) ?? [],
    [selectedFiles, suggestedScope, wholeRepoReviewMode],
  );
  const canApplySuggestedScope =
    !wholeRepoReviewMode &&
    suggestedScope != null &&
    suggestedScope.files.length > 0 &&
    suggestedScope.files.some((file) => !selectedFiles.includes(file));
  const usingAutoSuggestedScope =
    !wholeRepoReviewMode && selectedFiles.length === 0 && effectiveSelectedFiles.length > 0;
  const displayedTargetFileCount = wholeRepoReviewMode
    ? 0
    : selectedFiles.length > 0
      ? selectedFiles.length
      : effectiveSelectedFiles.length;


  useEffect(() => {
    setQueuedTasks(loadAgentQueue(effectiveWorkspaceId));
  }, [effectiveWorkspaceId]);

  useEffect(() => {
    if (selectedFilesPinned) return;
    setSelectedFiles([]);
  }, [taskText, repoUrl, folderPath, selectedFilesPinned]);



  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);











  useEffect(() => {
    saveAgentQueue(effectiveWorkspaceId, queuedTasks);
  }, [effectiveWorkspaceId, queuedTasks]);

  useEffect(() => {
    if (!activeRunId || !effectiveWorkspaceId || !isRunning) return;
    let cancelled = false;
    let streamConnected = false;
    let pollingInterval: number | null = null;
    let eventSource: EventSource | null = null;

    const loadEvents = async () => {
      try {
        const headers = await requestHeaders({});
        const response = await fetch(`/api/os/runs/${encodeURIComponent(activeRunId)}/events`, {
          method: "GET",
          headers,
          credentials: "include",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              events?: Array<{
                id?: string;
                event_type?: string;
                created_at?: string;
                payload_json?: { summary?: string; detail?: string };
              }>;
            }
          | null;
        if (cancelled || !response.ok || !Array.isArray(payload?.events)) return;
        const mapped: LiveRunEvent[] = payload.events
          .flatMap((event, index) => {
            const summary = typeof event.payload_json?.summary === "string"
              ? event.payload_json.summary.trim()
              : typeof event.event_type === "string"
                ? event.event_type.replaceAll("_", " ").toLowerCase()
                : "";
            if (!summary) return [];
            return [{
              id: typeof event.id === "string" ? event.id : `${index}-${summary}`,
              type: typeof event.event_type === "string" ? event.event_type : "UNKNOWN",
              at: typeof event.created_at === "string" ? event.created_at : new Date().toISOString(),
              summary,
              ...(typeof event.payload_json?.detail === "string"
                ? { detail: event.payload_json.detail.trim() }
                : {}),
            } satisfies LiveRunEvent];
          })
          .slice(-20);
        setLiveRunEvents((current) => mergeLiveRunEvents(current, mapped));
      } catch {
        if (!cancelled && !streamConnected) setLiveRunEvents([]);
      }
    };

    try {
      eventSource = new EventSource(`/api/os/runs/${encodeURIComponent(activeRunId)}/stream`);
      eventSource.addEventListener("run.event", (event) => {
        streamConnected = true;
        const payload = JSON.parse((event as MessageEvent).data) as LiveRunEvent;
        setLiveRunEvents((current) => mergeLiveRunEvents(current, [payload]));
      });
      eventSource.addEventListener("run.terminal", (event) => {
        streamConnected = true;
        const payload = JSON.parse((event as MessageEvent).data) as LiveRunEvent;
        setLiveRunEvents((current) => mergeLiveRunEvents(current, [payload]));
      });
      eventSource.addEventListener("run.error", () => {
        if (!pollingInterval) {
          pollingInterval = window.setInterval(() => {
            void loadEvents();
          }, 1200);
        }
      });
      eventSource.onerror = () => {
        if (!pollingInterval) {
          pollingInterval = window.setInterval(() => {
            void loadEvents();
          }, 1200);
        }
        eventSource?.close();
      };
    } catch {
      pollingInterval = window.setInterval(() => {
        void loadEvents();
      }, 1200);
    }

    void loadEvents();

    return () => {
      cancelled = true;
      if (pollingInterval) window.clearInterval(pollingInterval);
      eventSource?.close();
    };
  }, [activeRunId, effectiveWorkspaceId, isRunning, requestHeaders]);

  // ── Load metadata ────────────────────────────────────────────────────────────
  // Step 1: fetch providers + repo list immediately (no file scan — responds in <500 ms).
  useEffect(() => {
    void (async () => {
      const headers = await requestHeaders({});
      const quickQuery = new URLSearchParams({ quick: "1" });
      if (effectiveWorkspaceId) quickQuery.set("workspaceId", effectiveWorkspaceId);
      fetch(`/api/os/code/run?${quickQuery.toString()}`, { headers })
        .then((r) => r.json())
        .then((data: { providerStatus?: ProviderStatusMap; repoOptions?: RepoOption[]; skills?: SkillInfo[] }) => {
          if (data.providerStatus) setProviderStatuses(data.providerStatus);
          if (data.skills) setSkills(data.skills);
          if (data.repoOptions && data.repoOptions.length > 0) {
            setRepoOptions(data.repoOptions);
            // Auto-select first repo so the file scan starts immediately
            setRepoUrl((current) => current.trim() ? current : (data.repoOptions?.[0]?.value ?? ""));
          }
        })
        .catch(() => null);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveWorkspaceId, requestHeaders]); // only on mount / workspace change — not on every repoUrl change

  // Step 2: full metadata fetch (includes repo scan — may take 10–30 s).
  useEffect(() => {
    void (async () => {
      const headers = await requestHeaders({});
      const query = new URLSearchParams();
      if (effectiveWorkspaceId) query.set("workspaceId", effectiveWorkspaceId);
      if (repoUrl.trim()) query.set("repoUrl", repoUrl.trim());
      fetch(`/api/os/code/run${query.size ? `?${query.toString()}` : ""}`, { headers })
        .then((r) => r.json())
        .then((data: {
          providerStatus?: ProviderStatusMap;
          skills?: SkillInfo[];
          toolAllowlist?: Array<{ cmd: string; description: string }>;
          repoOptions?: RepoOption[];
          folderOptions?: FolderOption[];
          fileOptions?: FileOption[];
        }) => {
          if (data.providerStatus) setProviderStatuses(data.providerStatus);
          if (data.skills) setSkills(data.skills);
          if (data.toolAllowlist) setToolAllowlist(data.toolAllowlist);
          if (data.repoOptions) {
            setRepoOptions(data.repoOptions);
            // Use functional update to avoid stale-closure overwriting a URL the
            // user is actively typing (e.g. a GitHub repo URL).
            setRepoUrl((current) =>
              current.trim() ? current : (data.repoOptions?.[0]?.value ?? current)
            );
          }
          if (data.folderOptions) {
            setFolderOptions(data.folderOptions);
            setFolderPath((currentFolder) =>
              data.folderOptions?.some((option) => option.value === currentFolder) ? currentFolder : ""
            );
          }
          const nextFileOptions = data.fileOptions ?? [];
          setFileOptions(nextFileOptions);
          setSelectedFiles((currentFiles) =>
            currentFiles.filter((file) => nextFileOptions.some((option) => option.value === file))
          );
        })
        .catch(() => null);
    })();
  }, [effectiveWorkspaceId, repoUrl, requestHeaders]);

  // GitHub Cloud Coder: when the user enters a GitHub URL, fetch the file tree
  // from the new /api/os/code/github/files endpoint and populate fileOptions.
  useEffect(() => {
    const trimmed = repoUrl.trim();
    // Only activate for GitHub URLs
    if (!trimmed.startsWith("https://github.com/") && !trimmed.startsWith("github.com/")) return;
    if (!effectiveWorkspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await requestHeaders({});
        const query = new URLSearchParams({
          repo: trimmed.replace(/^https?:\/\//, ""),
          branch: branch || "main",
          workspaceId: effectiveWorkspaceId,
        });
        const res = await fetch(`/api/os/code/github/files?${query.toString()}`, { headers });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as { ok?: boolean; files?: string[] };
        if (!payload.ok || !Array.isArray(payload.files) || cancelled) return;
        const nextFileOptions: FileOption[] = payload.files.map((f) => ({
          value: f,
          label: f,
          size: 0,
          ext: f.includes(".") ? f.split(".").pop() ?? "" : "",
        }));
        setFileOptions(nextFileOptions);
        setSelectedFiles((current) =>
          current.filter((file) => nextFileOptions.some((opt) => opt.value === file)),
        );
      } catch {
        // Silently ignore — user may not have GitHub connected
      }
    })();
    return () => { cancelled = true; };
  }, [repoUrl, branch, effectiveWorkspaceId, requestHeaders]);

  const importQueuedTask = useCallback(() => {
    try {
      const raw = window.localStorage.getItem("elyra_ai_task_queue");
      if (!raw) return;
      window.localStorage.removeItem("elyra_ai_task_queue");
      const payload = JSON.parse(raw) as {
        task?: string;
        skill?: CodingSkill;
        role?: AgentRole;
        repoUrl?: string;
        folderPath?: string;
        attachments?: AttachmentDraft[];
        selectedFiles?: string[];
        autoRun?: boolean;
        autoExecute?: boolean;
        stage?: PromotionStage;
        terminalAccess?: boolean;
        useReasoning?: boolean;
        branchPerAgent?: boolean;
        executionMode?: ExecutionMode;
        vibeCoding?: boolean;
        teamMode?: TeamMode;
        teamConfig?: Partial<TeamConfig>;
        budgetUsd?: number;
        deadlineMinutes?: number;
      };
      if (payload.task) setTaskText(payload.task);
      if (payload.skill) setSelectedSkill(payload.skill);
      if (payload.role) setAgentRole(payload.role);
      if (payload.repoUrl) setRepoUrl(payload.repoUrl);
      if (payload.folderPath) setFolderPath(payload.folderPath);
      if (Array.isArray(payload.attachments)) {
        setAttachments(payload.attachments.slice(0, 4));
      }
      if (Array.isArray(payload.selectedFiles)) {
        setSelectedFilesPinned(false);
        setSelectedFiles(payload.selectedFiles.map((item) => String(item).trim()).filter(Boolean).slice(0, 12));
      } else {
        setSelectedFilesPinned(false);
        setSelectedFiles([]);
      }
      if (payload.stage === "dev" || payload.stage === "prod") {
        setDeliveryStage(payload.stage);
      } else {
        setDeliveryStage("playground");
      }
      if (typeof payload.terminalAccess === "boolean") setTerminalAccess(payload.terminalAccess);
      if (typeof payload.useReasoning === "boolean") setUseReasoning(payload.useReasoning);
      if (typeof payload.branchPerAgent === "boolean") setBranchPerAgent(payload.branchPerAgent);
      if (payload.executionMode === "strict" || payload.executionMode === "adaptive") setExecutionMode(payload.executionMode);
      if (typeof payload.vibeCoding === "boolean") setVibeCoding(payload.vibeCoding);
      if (payload.teamMode === "auto" || payload.teamMode === "manual") setTeamMode(payload.teamMode);
      if (payload.teamConfig && typeof payload.teamConfig === "object") {
        setTeamConfig({
          general: typeof payload.teamConfig.general === "number" ? payload.teamConfig.general : DEFAULT_TEAM_CONFIG.general,
          frontend: typeof payload.teamConfig.frontend === "number" ? payload.teamConfig.frontend : DEFAULT_TEAM_CONFIG.frontend,
          backend: typeof payload.teamConfig.backend === "number" ? payload.teamConfig.backend : DEFAULT_TEAM_CONFIG.backend,
          ui: typeof payload.teamConfig.ui === "number" ? payload.teamConfig.ui : DEFAULT_TEAM_CONFIG.ui,
          infra: typeof payload.teamConfig.infra === "number" ? payload.teamConfig.infra : DEFAULT_TEAM_CONFIG.infra,
          qa: typeof payload.teamConfig.qa === "number" ? payload.teamConfig.qa : DEFAULT_TEAM_CONFIG.qa,
        });
      }
      if (typeof payload.budgetUsd === "number") setBudgetUsd(payload.budgetUsd);
      if (typeof payload.deadlineMinutes === "number") setDeadlineMinutes(payload.deadlineMinutes);
      setActiveRunId(null);
      setAutoRunRequested(payload.autoRun === true);
      setAutoExecuteRequested(payload.autoExecute === true);
      setActionMsg(
        payload.autoRun === true
          ? payload.autoExecute === true
            ? "AI task imported from the intent line. Plan and execute will run automatically."
            : "AI task imported from the intent line. Generating plan automatically. Review it before Execute."
          : "AI task imported. Review the task and generate a plan.",
      );
    } catch {
      // ignore malformed quickstart payloads
    }
  }, []);

  useEffect(() => {
    importQueuedTask();

    const onQueuedTask = () => {
      importQueuedTask();
    };

    window.addEventListener("elyra:code-task-queued", onQueuedTask);
    return () => window.removeEventListener("elyra:code-task-queued", onQueuedTask);
  }, [importQueuedTask]);

  // ── Bulk queue import from Builder "Run All in Coder" ─────────────────────
  useEffect(() => {
    try {
      // Only trigger when the ?import=bulk param is present (set by BuilderWindow)
      const params = new URLSearchParams(window.location.search);
      if (params.get("import") !== "bulk") return;

      const raw = window.localStorage.getItem("elyra_agent_bulk_queue");
      if (!raw) return;
      window.localStorage.removeItem("elyra_agent_bulk_queue");

      const items = JSON.parse(raw) as Array<Partial<QueuedAgentTask>>;
      if (!Array.isArray(items) || items.length === 0) return;

      const tasks: QueuedAgentTask[] = items
        .map((item): QueuedAgentTask | null => {
          const task = typeof item.task === "string" ? item.task.trim() : "";
          if (!task) return null;
          return {
            id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
            role: "general" as AgentRole,
            skill: (item.skill ?? "fix-build") as CodingSkill,
            task,
            repoUrl: repoUrl.trim() || (typeof item.repoUrl === "string" ? item.repoUrl : ""),
            branch: branch.trim() || "main",
            folderPath: folderPath.trim(),
            selectedFiles: Array.isArray(item.selectedFiles) ? item.selectedFiles.map(String) : [],
            stage: "playground" as PromotionStage,
            terminalAccess: true,
            useReasoning: true,
            branchPerAgent: true,
            executionMode: "adaptive" as ExecutionMode,
            vibeCoding: true,
            teamMode: "auto" as TeamMode,
            teamConfig: { ...DEFAULT_TEAM_CONFIG },
            budgetUsd: 5,
            deadlineMinutes: 60,
            createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
          };
        })
        .filter((item): item is QueuedAgentTask => item !== null);

      if (tasks.length === 0) return;
      setQueuedTasks((current) => [...tasks, ...current].slice(0, 40));
      setActionMsg(
        `${tasks.length} finding${tasks.length > 1 ? "s" : ""} imported from Builder. Click "Run Queue" to execute.`,
      );

      // Remove the ?import=bulk param from URL without reload
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("import");
      window.history.replaceState(null, "", newUrl.toString());
    } catch {
      // ignore malformed bulk queue
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Persist last repo URL so reload shows it instantly instead of "Custom repository" flash ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (repoUrl.trim()) {
      window.localStorage.setItem(LAST_REPO_URL_KEY, repoUrl.trim());
    }
  }, [repoUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("elyra_coder_simple_mode", String(simpleMode));
  }, [simpleMode]);

  // ── Auto-scroll logs ─────────────────────────────────────────────────────────
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  useEffect(() => {
    if (!providerDropOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-code-provider-menu]")) {
        setProviderDropOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [providerDropOpen]);

  const loadPlaygroundVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const headers = await requestHeaders({});
      const response = await fetch("/api/os/code/playground/versions", {
        method: "GET",
        headers,
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        versions?: PlaygroundVersion[];
        head?: string | null;
      } | null;
      if (!response.ok || !payload?.ok) return;
      setPlaygroundVersions(Array.isArray(payload.versions) ? payload.versions : []);
      setPlaygroundHead(typeof payload.head === "string" ? payload.head : null);
    } catch {
      setPlaygroundVersions([]);
      setPlaygroundHead(null);
    } finally {
      setVersionsLoading(false);
    }
  }, [requestHeaders]);

  const loadPromotionAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const headers = await requestHeaders({});
      const query = new URLSearchParams();
      if (effectiveWorkspaceId) query.set("workspaceId", effectiveWorkspaceId);
      const response = await fetch(`/api/os/code/promotion-audit${query.size ? `?${query.toString()}` : ""}`, {
        method: "GET",
        headers,
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; records?: PromotionAuditRecord[] } | null;
      if (!response.ok || !payload?.ok) return;
      setPromotionAudit(Array.isArray(payload.records) ? payload.records : []);
    } catch {
      setPromotionAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, [effectiveWorkspaceId, requestHeaders]);

  const appendPromotionAudit = useCallback(async (record: Omit<PromotionAuditRecord, "id" | "createdAt">) => {
    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      await fetch("/api/os/code/promotion-audit", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(record),
      });
      await loadPromotionAudit();
    } catch {
      // best-effort audit trail
    }
  }, [loadPromotionAudit, requestHeaders]);



  useEffect(() => {
    void loadPlaygroundVersions();
  }, [loadPlaygroundVersions]);

  useEffect(() => {
    void loadPromotionAudit();
  }, [loadPromotionAudit]);

  // NOTE: The Code window Elly chat is session-specific — it does NOT load workspace
  // chat history from the server. Each session starts with the fresh welcome state.
  // Loading server history caused old unrelated conversations (e.g. weather queries)
  // to bleed into the code window on every page load / run open.

  const updateRunLedger = useCallback((input: {
    runId?: string;
    app?: "code" | "orchestrator";
    agent?: string;
    task?: string;
    repoUrl?: string;
    branch?: string;
    status: LocalRunStatus;
    stage?: PromotionStage;
    folderPath?: string;
    selectedFiles?: string[];
    summary?: string;
    previewUrl?: string;
    filesChanged?: number;
    estimatedCostUsd?: number;
    replayId?: string;
    gateFailures?: number;
  }): string => {
    const runId = input.runId ?? activeRunId ?? crypto.randomUUID();
    if (!activeRunId && !input.runId) {
      setActiveRunId(runId);
    }
    const now = Date.now();
    const current = loadRunLedger();
    const existing = current.find((record) => record.id === runId);
    const nextSummary = input.summary ?? existing?.summary;
    const nextPreviewUrl = input.previewUrl ?? existing?.previewUrl;
    const nextFilesChanged = input.filesChanged ?? existing?.filesChanged;
    const nextEstimatedCostUsd = input.estimatedCostUsd ?? existing?.estimatedCostUsd;
    const nextReplayId = input.replayId ?? existing?.replayId;
    const nextGateFailures = input.gateFailures ?? existing?.gateFailures;
    const nextFolderPath = input.folderPath ?? existing?.folderPath ?? folderPath.trim();
    const nextSelectedFiles = input.selectedFiles ?? existing?.selectedFiles ?? [...selectedFiles];
    const next: LocalAgentRunRecord = {
      id: runId,
      app: input.app ?? existing?.app ?? "code",
      agent: input.agent ?? existing?.agent ?? selectedSkill,
      task: input.task ?? (taskText.trim() || existing?.task || "Untitled code task"),
      repoUrl: input.repoUrl ?? (repoUrl.trim() || existing?.repoUrl || ""),
      branch: input.branch ?? (branch.trim() || existing?.branch || "main"),
      workspaceId: effectiveWorkspaceId,
      stage: input.stage ?? existing?.stage ?? deliveryStage,
      status: input.status,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      ...(nextFolderPath ? { folderPath: nextFolderPath } : {}),
      ...(nextSelectedFiles.length > 0 ? { selectedFiles: nextSelectedFiles } : {}),
      ...(selectedSkill ? { skill: selectedSkill } : {}),
      ...(typeof nextSummary === "string" ? { summary: nextSummary } : {}),
      ...(typeof nextPreviewUrl === "string" ? { previewUrl: nextPreviewUrl } : {}),
      ...(typeof nextFilesChanged === "number" ? { filesChanged: nextFilesChanged } : {}),
      ...(typeof nextEstimatedCostUsd === "number" ? { estimatedCostUsd: nextEstimatedCostUsd } : {}),
      ...(typeof nextReplayId === "string" ? { replayId: nextReplayId } : {}),
      ...(typeof nextGateFailures === "number" ? { gateFailures: nextGateFailures } : {}),
    };
    saveRunLedger([next, ...current.filter((record) => record.id !== runId)]);
    return runId;
  }, [activeRunId, branch, deliveryStage, effectiveWorkspaceId, folderPath, repoUrl, selectedFiles, selectedSkill, taskText]);

  const toggleSelectedFile = useCallback((file: string) => {
    setSelectedFilesPinned(true);
    setSelectedFiles((currentFiles) => {
      if (currentFiles.includes(file)) {
        return currentFiles.filter((entry) => entry !== file);
      }
      if (currentFiles.length >= 12) {
        return currentFiles;
      }
      return [...currentFiles, file];
    });
  }, []);

  const copyText = useCallback(async (value: string, successLabel: string) => {
    if (!value.trim()) {
      setActionMsg("Nothing to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setActionMsg(successLabel);
    } catch {
      setActionMsg("Clipboard access failed.");
    }
  }, []);

  const sendChatMessage = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatLoading) return;
    if (!effectiveWorkspaceId) {
      setActionMsg("Chat requires an active workspace.");
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    const draftMessages = [...chatMessages, nextUserMessage];
    setChatMessages(draftMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      const response = await fetch("/api/v1/chat", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          workspaceId: effectiveWorkspaceId,
          aiLanguage: resolvedLanguage,
          messages: draftMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { role?: "assistant"; content?: string; error?: string }
        | null;
      if (!response.ok || !payload || typeof payload.content !== "string") {
        throw new Error(payload?.error || "Chat request failed.");
      }
      const assistantContent = payload.content;

      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
        },
      ]);
      setCenterTab("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat request failed.";
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Chat error: ${message}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, chatMessages, effectiveWorkspaceId, requestHeaders]);

  const loadAttachments = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const nextFiles = Array.from(fileList).slice(0, 4);
    const loaded = await Promise.all(
      nextFiles.map(
        (file) =>
          new Promise<AttachmentDraft | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = typeof reader.result === "string" ? reader.result : "";
              const base64 = result.includes(",") ? result.split(",")[1] ?? "" : "";
              if (!base64) {
                resolve(null);
                return;
              }
              resolve({
                id: `${file.name}-${file.lastModified}-${file.size}`,
                name: file.name,
                mimeType: file.type || "application/octet-stream",
                sizeBytes: file.size,
                dataBase64: base64,
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );

    setAttachments((current) => {
      const merged = [...current];
      for (const item of loaded) {
        if (!item) continue;
        if (merged.some((existing) => existing.id === item.id)) continue;
        merged.push(item);
      }
      return merged.slice(0, 4);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const prepareFollowUpTask = useCallback((task: string, preferredSkill: CodingSkill = "custom") => {
    setSelectedSkill(preferredSkill);
    setSuggestionsOnly(false);
    setAutoRunRequested(false);
    setAutoExecuteRequested(false);
    setTaskText(task);
    setPlanArtifact(null);
    setResultArtifact(null);
    setLogs([]);
    setErrorMsg(null);
    setApproved(false);
    setPhase("idle");
    setCenterTab("plan");
    setShowPreviewPanel(false);
    setExecutionContract(null);
    setContractApproved(false);
    setActionMsg("Task primed. Generate a new plan to work on it.");
  }, []);

  const focusFindingFile = useCallback((filePath: string) => {
    const normalized = filePath.trim().replace(/^\/+|\/+$/g, "");
    if (!normalized) return;
    const parts = normalized.split("/");
    if (parts.length > 1) {
      setFolderPath(parts.slice(0, -1).join("/"));
    } else {
      setFolderPath("");
    }
    setActionMsg(`Scoped review to ${normalized}`);
  }, []);

  const sendFindingsToBuilder = useCallback((findings: ReviewFinding[]) => {
    if (findings.length === 0) {
      setActionMsg("No findings available for Builder.");
      return;
    }
    try {
      const payload = {
        source: "code-review",
        createdAt: new Date().toISOString(),
        repoUrl,
        branch,
        folderPath,
        findings,
      };
      window.localStorage.setItem("elyra_builder_review_queue", JSON.stringify(payload));
      window.location.assign(
        effectiveWorkspaceId
          ? `/os/builder?workspaceId=${encodeURIComponent(effectiveWorkspaceId)}`
          : "/os/builder"
      );
    } catch {
      setActionMsg("Unable to hand off findings to Builder.");
    }
  }, [branch, effectiveWorkspaceId, folderPath, repoUrl]);

  /**
   * Queue ALL findings directly as individual agent tasks — no Builder redirect.
   * Each finding becomes one clean QueuedAgentTask with the full fix description.
   */
  /**
   * Resolve the correct stage for a finding.
   * Playground only mirrors `frontend/` — any file outside that directory
   * (worker/, supabase/, scripts/, root config files, etc.) must go to "dev"
   * so the full monorepo is available for patching.
   */
  const resolveStageForFile = useCallback(
    (filePath: string | undefined): PromotionStage => {
      if (!filePath) return deliveryStage;
      const normalized = filePath.replace(/\\/g, "/");
      const isFrontendOnly = normalized.startsWith("frontend/") || normalized.startsWith("./frontend/");
      if (!isFrontendOnly && deliveryStage === "playground") {
        // Non-frontend file can't be patched in playground mirror — use dev
        return "dev";
      }
      return deliveryStage;
    },
    [deliveryStage],
  );

  const queueAllFindings = useCallback((findings: ReviewFinding[]) => {
    if (findings.length === 0) {
      setActionMsg("No findings to queue.");
      return;
    }
    const now = Date.now();
    const tasks: QueuedAgentTask[] = findings.map((finding, i) => {
      const fileStage = resolveStageForFile(finding.file);

      // For playground-stage tasks, strip recommendations that require creating
      // non-frontend files (e.g. Supabase migrations) to avoid cross-boundary diffs.
      const recommendation = fileStage === "playground" && finding.recommendation
        ? finding.recommendation
            .replace(/Erstelle[^.]*Supabase[^.]*\./gi, "")
            .replace(/Create[^.]*migration[^.]*\./gi, "")
            .trim()
        : finding.recommendation;

      const taskText = [
        `Fix this issue${finding.file ? ` in ${finding.file}` : ""}: ${finding.title}.`,
        `Problem: ${finding.issue}`,
        recommendation ? `Recommendation: ${recommendation}` : "",
      ].filter(Boolean).join(" ").trim();

      return {
        id: crypto.randomUUID(),
        role: "general" as AgentRole,
        skill: "fix-build" as CodingSkill,
        task: taskText,
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || "main",
        folderPath: folderPath.trim(),
        selectedFiles: finding.file ? [finding.file] : [],
        stage: fileStage,
        terminalAccess,
        useReasoning,
        branchPerAgent,
        executionMode,
        vibeCoding,
        teamMode,
        teamConfig: { ...teamConfig },
        budgetUsd,
        deadlineMinutes,
        createdAt: now + i,
      };
    });

    const playgroundCount = tasks.filter((t) => t.stage === "playground").length;
    const devCount = tasks.filter((t) => t.stage === "dev").length;
    const stageNote = devCount > 0
      ? ` (${playgroundCount} playground, ${devCount} dev — non-frontend files)`
      : " on Playground";

    setQueuedTasks((current) => [...tasks, ...current].slice(0, 40));
    setActionMsg(
      `${tasks.length} finding${tasks.length > 1 ? "s" : ""} queued${stageNote}. Click "Run Queue" to execute.`,
    );
  }, [branch, branchPerAgent, budgetUsd, deadlineMinutes, deliveryStage, executionMode, folderPath, repoUrl, resolveStageForFile, teamConfig, teamMode, terminalAccess, useReasoning, vibeCoding]);

  const buildRunPayload = useCallback(
    (
      nextPhase: "plan" | "execute",
      overrides?: Partial<{
        skill: CodingSkill;
        task: string;
        repoUrl: string;
        branch: string;
        folderPath: string;
        selectedFiles: string[];
        attachments: AttachmentDraft[];
        stage: PromotionStage;
        useReasoning: boolean;
        autoCommit: boolean;
        suggestionsOnly: boolean;
        agentRole: AgentRole;
        terminalAccess: boolean;
        branchPerAgent: boolean;
        executionMode: ExecutionMode;
        vibeCoding: boolean;
        teamMode: TeamMode;
        teamConfig: TeamConfig;
        agentBranchName: string;
        budgetUsd: number;
        deadlineMinutes: number;
        designApproved: boolean;
        designDraftUrl: string;
        autoGenerateDraft: boolean;
        runId: string;
        autonomous: boolean;
      }>,
    ) => ({
      skill: overrides?.skill ?? selectedSkill,
      task: overrides?.task ?? taskText.trim(),
      repoUrl: overrides?.repoUrl ?? repoUrl,
      branch: overrides?.branch ?? branch,
      folderPath: overrides?.folderPath ?? folderPath,
      provider: selectedProvider,
      useReasoning: overrides?.useReasoning ?? useReasoning,
      suggestionsOnly: overrides?.suggestionsOnly ?? suggestionsOnly,
      selectedFiles: overrides?.selectedFiles ?? effectiveSelectedFiles,
      autoCommit: overrides?.autoCommit ?? autoCommit,
      githubMode,
      strictAi: strictAiMode,
      executionMode: overrides?.executionMode ?? executionMode,
      vibeCoding: overrides?.vibeCoding ?? vibeCoding,
      agentRole: overrides?.agentRole ?? agentRole,
      teamMode: overrides?.teamMode ?? teamMode,
      teamConfig: overrides?.teamConfig ?? teamConfig,
      terminalAccess: overrides?.terminalAccess ?? terminalAccess,
      branchPerAgent: overrides?.branchPerAgent ?? branchPerAgent,
      agentBranchName: overrides?.agentBranchName,
      budgetUsd: overrides?.budgetUsd ?? budgetUsd,
      deadlineMinutes: overrides?.deadlineMinutes ?? deadlineMinutes,
      designApproved: overrides?.designApproved ?? false,
      designDraftUrl: overrides?.designDraftUrl ?? designDraftUrl.trim(),
      autoGenerateDraft:
        overrides?.autoGenerateDraft ??
        (selectedSkill === "ux-ui-design" && !designDraftUrl.trim()),
      attachments: overrides?.attachments ?? attachments,
      workspaceId: effectiveWorkspaceId,
      runId: overrides?.runId ?? activeRunId ?? undefined,
      stage: overrides?.stage ?? deliveryStage,
      phase: nextPhase,
      autonomous: overrides?.autonomous ?? false,
      aiLanguage: resolvedLanguage,
    }),
    [
      agentRole,
      attachments,
      autoCommit,
      githubMode,
      branch,
      branchPerAgent,
      budgetUsd,
      deadlineMinutes,
      designDraftUrl,
      selectedSkill,
      deliveryStage,
      executionMode,
      vibeCoding,
      folderPath,
      repoUrl,
      effectiveSelectedFiles,
      selectedProvider,
      selectedSkill,
      strictAiMode,
      suggestionsOnly,
      taskText,
      teamConfig,
      teamMode,
      terminalAccess,
      useReasoning,
      activeRunId,
      effectiveWorkspaceId,
      resolvedLanguage,
    ],
  );

  const buildExecutionContract = useCallback((): ExecutionContract | null => {
    const objective = taskText.trim();
    if (!objective) return null;
    const mode = contractMode;
    const assumptions =
      mode === "company_launch"
        ? [
            "Deliverables will be generated in iterative drafts first.",
            "Legal/financial documents require human final review before external use.",
          ]
        : [
            "Changes should stay within selected repo/file scope unless explicitly expanded.",
            "All code changes must pass strict apply + verification gates.",
          ];
    const budgetFactor = budgetUsd >= 10 ? 2 : budgetUsd >= 5 ? 1 : 0;
    const deadlineFactor = deadlineMinutes <= 30 ? 0 : deadlineMinutes <= 90 ? 1 : 2;
    const dynamicFrontendCount = Math.max(1, Math.min(3, budgetFactor + deadlineFactor));
    const dynamicBackendCount = Math.max(1, Math.min(3, budgetFactor + (deadlineFactor > 0 ? 1 : 0)));
    const team =
      mode === "company_launch"
        ? [
            { role: "ui" as AgentRole, count: 1, focus: "Brand, deck structure, presentation flow." },
            { role: "frontend" as AgentRole, count: 1, focus: "Landing and product narrative assets." },
            { role: "backend" as AgentRole, count: 1, focus: "Operational architecture and API feasibility." },
            { role: "qa" as AgentRole, count: 1, focus: "Quality gate and consistency checks." },
            { role: "general" as AgentRole, count: 1, focus: "Founder-ops synthesis and planning." },
          ]
        : [
            { role: "ui" as AgentRole, count: 1, focus: "UX clarity, visual consistency, interaction polish." },
            { role: "frontend" as AgentRole, count: dynamicFrontendCount, focus: "UI implementation and client performance." },
            { role: "backend" as AgentRole, count: dynamicBackendCount, focus: "API, caching, reliability, data contracts." },
            { role: "qa" as AgentRole, count: 1, focus: "Regression tests and release gating." },
          ];
    const deliverables: ContractDeliverable[] =
      mode === "company_launch"
        ? [
            { id: "deck", label: "Investor pitch deck", ownerRole: "ui" },
            { id: "plan", label: "Business plan", ownerRole: "general" },
            { id: "docs", label: "Core business documents set", ownerRole: "qa" },
            { id: "launch", label: "Go-to-market execution checklist", ownerRole: "frontend" },
          ]
        : [
            { id: "impl", label: "Implemented feature/refactor set", ownerRole: "frontend" },
            { id: "perf", label: "Performance hardening changes", ownerRole: "backend" },
            { id: "tests", label: "Verification and regression tests", ownerRole: "qa" },
          ];
    const risks =
      mode === "company_launch"
        ? [
            "Business assumptions may require external validation.",
            "Legal content must be jurisdiction-reviewed.",
          ]
        : [
            "Parallel changes can create branch conflicts.",
            "Performance gains may regress UX if not validated together.",
          ];
    const gates =
      mode === "company_launch"
        ? [
            "Contract approval required before agent launch.",
            "Final publish blocked until human review of legal/finance artifacts.",
          ]
        : [
            "Strict AI apply must pass (no fallback patching).",
            "Build + tests + QA review required before promotion.",
            "Hard gates required: lint, typecheck, tests, build, perf, a11y, visual.",
          ];

    return {
      id: crypto.randomUUID(),
      objective,
      mode,
      assumptions,
      team,
      deliverables,
      risks,
      gates,
      estimatedMinutes: mode === "company_launch" ? 120 : Math.max(45, 30 + dynamicFrontendCount * 10 + dynamicBackendCount * 10),
    };
  }, [budgetUsd, contractMode, deadlineMinutes, taskText]);

  const deriveTeamPlan = useCallback((): Array<{ role: AgentRole; count: number; focus: string }> => {
    if (teamMode === "manual") {
      const manual: Array<{ role: AgentRole; count: number; focus: string }> = [
        { role: "ui", count: Math.max(0, Math.round(teamConfig.ui)), focus: "Visual quality and interaction polish." },
        { role: "frontend", count: Math.max(0, Math.round(teamConfig.frontend)), focus: "UI implementation and client performance." },
        { role: "backend", count: Math.max(0, Math.round(teamConfig.backend)), focus: "API reliability, caching, data contracts." },
        { role: "infra", count: Math.max(0, Math.round(teamConfig.infra)), focus: "Runtime, tooling, deployment reliability." },
        { role: "qa", count: Math.max(0, Math.round(teamConfig.qa)), focus: "Regression prevention and gate verification." },
        { role: "general", count: Math.max(0, Math.round(teamConfig.general)), focus: "Cross-cutting synthesis and coordination." },
      ];
      const filtered = manual.filter((slot) => slot.count > 0);
      return filtered.length > 0 ? filtered : [{ role: "qa", count: 1, focus: "Regression prevention and gate verification." }];
    }

    const budgetFactor = budgetUsd >= 10 ? 2 : budgetUsd >= 5 ? 1 : 0;
    const deadlineFactor = deadlineMinutes <= 30 ? 0 : deadlineMinutes <= 90 ? 1 : 2;
    const frontend = Math.max(1, Math.min(4, budgetFactor + deadlineFactor));
    const backend = Math.max(1, Math.min(3, budgetFactor + (deadlineFactor > 0 ? 1 : 0)));
    const includeInfra = budgetUsd >= 8 || deadlineMinutes >= 120;
    const includeGeneral = /\b(strategy|architecture|company|launch|roadmap|orchestrate)\b/i.test(taskText);
    const autoPlan: Array<{ role: AgentRole; count: number; focus: string }> = [
      { role: "ui", count: 1, focus: "Visual quality and interaction polish." },
      { role: "frontend", count: frontend, focus: "UI implementation and client performance." },
      { role: "backend", count: backend, focus: "API reliability, caching, data contracts." },
      { role: "qa", count: 1, focus: "Regression prevention and gate verification." },
    ];
    if (includeInfra) autoPlan.push({ role: "infra", count: 1, focus: "Runtime, tooling, deployment reliability." });
    if (includeGeneral) autoPlan.push({ role: "general", count: 1, focus: "Cross-cutting synthesis and coordination." });
    return autoPlan;
  }, [budgetUsd, deadlineMinutes, taskText, teamConfig, teamMode]);

  const teamPlanSummary = useMemo(
    () =>
      deriveTeamPlan()
        .map((slot) => `${slot.count} ${slot.role}`)
        .join(" + "),
    [deriveTeamPlan],
  );

  const queueContractTeam = useCallback(
    (contract: ExecutionContract) => {
      const createdAt = Date.now();
      const generated: QueuedAgentTask[] = [];
      let offset = 0;
      for (const slot of contract.team) {
        for (let index = 0; index < slot.count; index += 1) {
          generated.push({
            id: crypto.randomUUID(),
            role: slot.role,
            skill: slot.role === "qa" ? "write-tests" : "custom",
            task: `${contract.objective}\n\nTeam focus: ${slot.focus}`,
            repoUrl: repoUrl.trim(),
            branch: branch.trim() || "main",
            folderPath: folderPath.trim(),
            selectedFiles: [...selectedFiles],
            stage: deliveryStage,
            terminalAccess,
            useReasoning: true,
            branchPerAgent,
            executionMode,
            vibeCoding,
            teamMode,
            teamConfig: { ...teamConfig },
            budgetUsd,
            deadlineMinutes,
            createdAt: createdAt + offset,
          });
          offset += 1;
        }
      }
      setQueuedTasks((current) => [...generated, ...current].slice(0, 40));
      setActionMsg(`Execution contract approved: queued ${generated.length} specialist agents.`);
    },
    [branch, branchPerAgent, budgetUsd, deadlineMinutes, deliveryStage, executionMode, vibeCoding, folderPath, repoUrl, selectedFiles, teamConfig, teamMode, terminalAccess],
  );

  // ── Plan phase ───────────────────────────────────────────────────────────────
  const handlePlan = useCallback(async () => {
    if (!taskText.trim()) return;
    const runId = updateRunLedger({
      status: "planning",
      ...(effectiveSelectedFiles.length > 0 ? { selectedFiles: effectiveSelectedFiles } : {}),
    });
    setLiveRunEvents([]);
    publishDockRunUpdate({
      text: taskText.trim(),
      status: "running",
      steps: [
        {
          id: "plan",
          label: "Generate plan",
          status: "running",
          detail: "Preparing the coding plan from the current task and repository context.",
        },
      ],
    });
    setPhase("planning");
    setPlanArtifact(null);
    setResultArtifact(null);
    setLogs([]);
    setErrorMsg(null);
    setApproved(false);
    setCenterTab("plan");
    addLog(`Planning started for skill: ${selectedSkill}`);
    addLog(`Task: ${taskText.trim()}`);
    addLog(`Workspace: ${activeWorkspaceLabel}`);
    if (repoUrl) addLog(`Repo: ${repoUrl} @ ${branch}`);
    if (folderPath.trim()) addLog(`Folder scope: ${folderPath.trim()}`);
    if (wholeRepoReviewMode) {
      addLog("Review scope: whole repository.");
    } else if (selectedFiles.length > 0) {
      addLog(`File scope: ${selectedFiles.length} file(s)`);
    } else if (usingAutoSuggestedScope) {
      addLog(`Suggested scope applied automatically: ${effectiveSelectedFiles.length} file(s).`);
    }
    if (attachments.length > 0) addLog(`Attachments: ${attachments.length}`);
    addLog("Agent will inspect repository context and produce an execution plan.");
    if (selectedSkill === "review-code" && suggestionsOnly) {
      addLog("Review-only mode: the agent will scan the repo and return suggestions without a patch.");
    }

    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      const res = await postRunRequest(
        headers,
        buildRunPayload("plan", { runId, autonomous: true }),
        PLAN_REQUEST_TIMEOUT_MS,
        "plan",
      );
      const data = await parseJsonResponse<{
        ok: boolean;
        source?: string;
        warning?: string;
        artifact?: PlanArtifact;
        error?: string;
        plan?: PlanArtifact["plan"];
        runId?: string;
        status?: string;
        selectedFiles?: string[];
      }>(res, "plan");

      if (!data.ok) {
        publishDockRunUpdate({
          text: taskText.trim(),
          status: "failed",
          steps: [
            {
              id: "plan",
              label: "Generate plan",
              status: "failed",
              detail: str(data.error) || "Plan generation failed.",
            },
          ],
        });
        setAutoExecuteRequested(false);
        setErrorMsg(str(data.error) || "Plan generation failed.");
        setPhase("error");
        addLog(`Error: ${str(data.error)}`);
        return;
      }

      if (data.warning) addLog(`⚠ ${data.warning}`);
      if (data.source) addLog(`Source: ${data.source}`);
      if (!wholeRepoReviewMode && Array.isArray(data.selectedFiles) && data.selectedFiles.length > 0) {
        const scoped = data.selectedFiles.map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
        setSelectedFilesPinned(false);
        setSelectedFiles(scoped);
        updateRunLedger({ runId, status: "planning", selectedFiles: scoped });
        addLog(`Resolved scope: ${scoped.length} file(s) selected by backend autoscope.`);
      }

      const artifact = data.artifact as PlanArtifact | undefined;
      if (artifact) {
        // Autonomous execution already completed during the plan step — treat as execute result
        if (data.source === "elli-autonomous") {
          const execArtifact = artifact as unknown as ResultArtifact;
          setResultArtifact(execArtifact);
          if (Array.isArray(execArtifact.executionLog) && execArtifact.executionLog.length > 0) {
            for (const line of execArtifact.executionLog) addLog(line);
          }
          addLog(`Autonomous execution complete: ${execArtifact.filesChanged?.length ?? 0} file(s) changed`);
          if (execArtifact.buildReport) {
            addLog(`Build: ${execArtifact.buildReport.success ? "✓ success" : "✗ failed"}`);
          }
          publishDockRunUpdate({
            text: taskText.trim(),
            status: execArtifact.buildReport?.success === false ? "failed" : "completed",
            steps: [
              {
                id: "patch",
                label: execArtifact.executionApplied ? "Patch applied" : "Patch not applied",
                status: execArtifact.executionApplied ? "completed" : "failed",
                detail: execArtifact.summary,
              },
              {
                id: "build",
                label: "Run build",
                status: execArtifact.buildReport?.success ? "completed" : "failed",
                detail: execArtifact.buildReport?.output ?? "",
              },
            ],
          });
          updateRunLedger({
            runId,
            status: execArtifact.buildReport?.success === false ? "failed" : "completed",
            summary: execArtifact.summary,
            filesChanged: execArtifact.filesChanged?.length ?? 0,
            gateFailures: (execArtifact.gates ?? []).filter((g) => g.status === "failed").length,
          });
          setCenterTab("diff");
          setPhase("done");
          return;
        }
        setPlanArtifact(artifact);
        addLog(`Plan ready: ${artifact.plan?.steps?.length ?? 0} steps, ~${artifact.plan?.estimatedMinutes ?? 0} min`);
        publishDockRunUpdate({
          text: taskText.trim(),
          status: autoExecuteRequested ? "running" : "completed",
          steps: (artifact.plan?.steps ?? []).map((step, index) => ({
            id: `plan-step-${step.step}`,
            label: step.title,
            status:
              autoExecuteRequested
                ? index === 0
                  ? "running"
                  : "pending"
                : "completed",
            detail: step.description,
          })),
        });
      }
      setPhase("done"); // plan phase done, waiting for user approval to execute
    } catch (err) {
      publishDockRunUpdate({
        text: taskText.trim(),
        status: "failed",
        steps: [
          {
            id: "plan",
            label: "Generate plan",
            status: "failed",
            detail: err instanceof Error ? err.message : "Unexpected error",
          },
        ],
      });
      setAutoExecuteRequested(false);
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setErrorMsg(msg);
      setPhase("error");
      addLog(`Fatal: ${msg}`);
    }
  }, [taskText, selectedSkill, repoUrl, branch, folderPath, suggestionsOnly, selectedFiles, effectiveSelectedFiles, usingAutoSuggestedScope, attachments, activeWorkspaceLabel, addLog, updateRunLedger, buildRunPayload, requestHeaders, wholeRepoReviewMode, setCenterTab]);

  // ── Execute phase (after approval) ───────────────────────────────────────────
  const handleExecute = useCallback(async (options?: { designApproved?: boolean; autoGenerateDraft?: boolean }) => {
    const runId = updateRunLedger({
      status: "running",
      ...(effectiveSelectedFiles.length > 0 ? { selectedFiles: effectiveSelectedFiles } : {}),
    });
    setLiveRunEvents([]);
    publishDockRunUpdate({
      text: taskText.trim(),
      status: "running",
      steps: [
        {
          id: "execute",
          label: "Apply changes",
          status: "running",
          detail: "Applying the generated patch and running verification.",
        },
      ],
    });
    setApproved(true);
    setPhase("executing");
    setCenterTab("logs");
    setShowPreviewPanel(false);
    setGhPrUrl(null); // reset from previous GitHub run
    addLog("Agent step 1/5: analyze task and execution scope.");

    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      addLog(terminalAccess ? "Local coding agent started with terminal access." : "Managed coding agent started.");
      addLog(`Workspace: ${activeWorkspaceLabel}`);
      if (wholeRepoReviewMode) {
        addLog("Agent scope: whole repository review.");
      } else if (selectedFiles.length > 0) {
        addLog(`Agent scope: selected file allowlist (${selectedFiles.length} file(s)).`);
      } else if (usingAutoSuggestedScope) {
        addLog(`Agent scope: suggested file allowlist (${effectiveSelectedFiles.length} file(s)).`);
      } else if (folderPath.trim()) {
        addLog(`Agent scope: folder ${folderPath.trim()}`);
      } else {
        addLog("Agent scope: resolving from selected files, folder, or backend autoscope.");
      }
      addLog("Agent step 2/5: inspect relevant files and confirm root cause before editing.");
      if (agentRole === "ui" || selectedSkill === "ux-ui-design" || /ui|layout|spacing|overlap|window|intent line|intentline/i.test(taskText)) {
        addLog("Agent policy: UI/layout root-cause mode active. Shared shell and window constraints are checked before leaf components.");
      }
      if (selectedSkill === "review-code" && suggestionsOnly) {
        addLog("Executing repository review mode...");
      }
      const res = await postRunRequest(
        headers,
        buildRunPayload("execute", {
          runId,
          ...(typeof options?.designApproved === "boolean" ? { designApproved: options.designApproved } : {}),
          ...(typeof options?.autoGenerateDraft === "boolean" ? { autoGenerateDraft: options.autoGenerateDraft } : {}),
        }),
        EXECUTE_REQUEST_TIMEOUT_MS,
        "execute",
      );
      const data = await parseJsonResponse<{
        ok: boolean;
        source?: string;
        warning?: string;
        artifact?: ResultArtifact;
        error?: string;
        status?: string;
        summary?: string;
        selectedFiles?: string[];
        prUrl?: string;
        compareUrl?: string;
        branchName?: string;
      }>(res, "execute");
      const resolvedSelectedFiles =
        wholeRepoReviewMode
          ? []
          : Array.isArray(data.selectedFiles)
            ? data.selectedFiles.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
            : [];

      if (!data.ok) {
        updateRunLedger({ status: "failed", summary: str(data.error) || "Execution failed." });
        publishDockRunUpdate({
          text: taskText.trim(),
          status: "failed",
          steps: [
            {
              id: "execute",
              label: "Apply changes",
              status: "failed",
              detail: str(data.error) || "Execution failed.",
            },
          ],
        });
        setAutoExecuteRequested(false);
        setErrorMsg(str(data.error) || "Execution failed.");
        setPhase("error");
        addLog(`Error: ${str(data.error)}`);
        return;
      }

      if (data.warning) addLog(`⚠ ${data.warning}`);
      // GitHub Cloud Coder: show PR URL if the backend created one
      if (data.prUrl) {
        setGhPrUrl(data.prUrl);
        addLog(`🔀 GitHub PR opened: ${data.prUrl}`);
        window.open(data.prUrl, "_blank", "noopener,noreferrer");
      } else if (data.compareUrl) {
        setGhPrUrl(data.compareUrl);
        addLog(`📊 GitHub compare: ${data.compareUrl}`);
      }
      if (!wholeRepoReviewMode && resolvedSelectedFiles.length > 0) {
        setSelectedFilesPinned(false);
        setSelectedFiles(resolvedSelectedFiles);
        updateRunLedger({ runId, status: "running", selectedFiles: resolvedSelectedFiles });
        addLog(`Resolved scope: ${resolvedSelectedFiles.length} file(s) selected by backend autoscope.`);
      }
      const artifact = data.artifact as ResultArtifact | undefined;
      if (artifact) {
        setResultArtifact(artifact);
        if (Array.isArray(artifact.executionLog) && artifact.executionLog.length > 0) {
          for (const line of artifact.executionLog) {
            addLog(line);
          }
        }
        if (selectedSkill === "review-code" && suggestionsOnly) {
          addLog("Review complete: recommendations ready.");
        } else {
          addLog(`Execution complete: ${artifact.filesChanged?.length ?? 0} file(s) changed`);
        }
        if (artifact.testReport) {
          addLog(`Tests: ${artifact.testReport.passed} passed, ${artifact.testReport.failed} failed`);
        }
        if (artifact.buildReport) {
          addLog(`Build: ${artifact.buildReport.success ? "✓ success" : "✗ failed"}`);
        }
        publishDockRunUpdate({
          text: taskText.trim(),
          status: selectedSkill === "review-code" && suggestionsOnly
            ? "completed"
            : artifact.buildReport?.success === false
              ? "failed"
              : "completed",
          steps:
            selectedSkill === "review-code" && suggestionsOnly
              ? [
                  {
                    id: "review",
                    label: "Repository analysis",
                    status: "completed",
                    detail: artifact.summary,
                  },
                  {
                    id: "findings",
                    label: "Prioritize findings",
                    status: (artifact.findings?.length ?? 0) > 0 ? "completed" : "pending",
                    detail: `${artifact.findings?.length ?? 0} finding(s) identified.`,
                  },
                ]
              : [
                  {
                    id: "patch",
                    label: artifact.executionApplied ? "Patch applied" : "Patch not applied",
                    status: artifact.executionApplied ? "completed" : "failed",
                    detail: artifact.summary,
                  },
                  {
                    id: "test",
                    label: "Run tests",
                    status:
                      artifact.testReport.failed > 0
                        ? "failed"
                        : artifact.testReport.passed > 0
                          ? "completed"
                          : "pending",
                    detail: artifact.testReport.output,
                  },
                  {
                    id: "build",
                    label: "Run build",
                    status: artifact.buildReport.success ? "completed" : "failed",
                    detail: artifact.buildReport.output,
                  },
                ],
        });
        const runIdForArtifact = updateRunLedger({
          status: artifact.buildReport?.success === false ? "failed" : "completed",
          folderPath: folderPath.trim(),
          selectedFiles:
            resolvedSelectedFiles.length > 0
              ? resolvedSelectedFiles
              : (artifact.filesChanged ?? []).map((file) => file.path).filter(Boolean).slice(0, 12),
          summary: artifact.summary,
          ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
          filesChanged: artifact.filesChanged?.length ?? 0,
          ...(artifact.telemetry?.estimatedCostUsd != null ? { estimatedCostUsd: artifact.telemetry.estimatedCostUsd } : {}),
          ...(artifact.telemetry?.replayId ? { replayId: artifact.telemetry.replayId } : {}),
          gateFailures: (artifact.gates ?? []).filter((gate) => gate.status === "failed").length,
        });
        const savedLocally = saveRunArtifact(runIdForArtifact, artifact);
        const persistedRun = loadRunLedger().find((record) => record.id === runIdForArtifact);
        // Always save to server; especially important when localStorage is full (large scan-repo artifacts).
        if (persistedRun) {
          void saveRunArtifactServer({ run: persistedRun, artifact, workspaceId: effectiveWorkspaceId });
          if (!savedLocally) {
            console.info(`[CodingAgentWindow] Artifact for run ${runIdForArtifact} saved to server (localStorage quota exceeded).`);
          }
        }
        void loadPlaygroundVersions();
        setShowPreviewPanel(Boolean(artifact.previewUrl));
        setCenterTab("diff");
      }
      setPhase("done");
    } catch (err) {
      publishDockRunUpdate({
        text: taskText.trim(),
        status: "failed",
        steps: [
          {
            id: "execute",
            label: "Apply changes",
            status: "failed",
            detail: err instanceof Error ? err.message : "Unexpected error",
          },
        ],
      });
      setAutoExecuteRequested(false);
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setErrorMsg(msg);
      setPhase("error");
      addLog(`Fatal: ${msg}`);
    }
  }, [taskText, selectedSkill, suggestionsOnly, activeWorkspaceLabel, addLog, buildRunPayload, effectiveWorkspaceId, folderPath, loadPlaygroundVersions, requestHeaders, selectedFiles, effectiveSelectedFiles, usingAutoSuggestedScope, terminalAccess, updateRunLedger, wholeRepoReviewMode]);

  const openRunById = useCallback(async (runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return;
    const ledger = loadRunLedger();
    const localArtifact = loadRunArtifact(normalizedRunId);
    const localRun = ledger.find((item) => item.id === normalizedRunId) ?? null;
    // Always fetch from server when local artifact is missing — server may have findings/changes
    // that weren't stored locally (e.g. large review artifacts that exceeded localStorage quota).
    const needsServerFetch = !localArtifact;
    const serverRecord = needsServerFetch
      ? await loadRunRecordServer(normalizedRunId, effectiveWorkspaceId)
      : null;
    // Prefer local run metadata; fall back to server only if server run has a valid id
    const serverRun = serverRecord?.run?.id ? serverRecord.run : null;
    const run = localRun ?? serverRun ?? null;
    const artifact = localArtifact ?? serverRecord?.artifact ?? null;
    if (!run?.id && !artifact) {
      setActionMsg("Run not found.");
      return;
    }
    // Use normalizedRunId as fallback id when server record has empty run metadata
    const runId_ = run?.id ?? normalizedRunId;
    setActiveRunId(runId_);
    if (run?.task) setTaskText(run.task);
    if (run?.repoUrl) setRepoUrl(run.repoUrl);
    setBranch(run?.branch || "main");
    if (run?.stage) setDeliveryStage(run.stage);
    if (run?.folderPath != null) setFolderPath(run.folderPath);
    if (Array.isArray(run?.selectedFiles)) setSelectedFiles(run.selectedFiles);
    if (run?.skill) {
      setSelectedSkill(run.skill);
      // review-code runs are always suggestions-only (no patch diff)
      if (run.skill === "review-code") setSuggestionsOnly(true);
    }
    // Detect review run by findings even when skill is missing (pre-fix runs)
    const isReviewArtifact = (artifact?.findings?.length ?? 0) > 0;
    if (isReviewArtifact) setSuggestionsOnly(true);
    // Clear stale chat so old workspace conversations don't bleed into this run view
    setChatMessages([]);
    if (!localRun && run?.id) {
      saveRunLedger([run as LocalAgentRunRecord, ...ledger.filter((item) => item.id !== run.id)]);
    }
    if (artifact) {
      const stage = run?.stage ?? "playground";
      const fallbackPreviewUrl =
        stage === "playground"
          ? "http://localhost:3100/os"
          : stage === "dev"
            ? "http://localhost:3000/os"
            : undefined;
      const artifactWithPreview =
        artifact.previewUrl || !fallbackPreviewUrl
          ? artifact
          : { ...artifact, previewUrl: fallbackPreviewUrl };
      setResultArtifact(artifactWithPreview);
      setPhase("done");
      // For review runs with findings: go to Diff (findings panel). For code runs: Diff (patch).
      setCenterTab("diff");
      setShowPreviewPanel(Boolean(artifactWithPreview.previewUrl));
      if (!localArtifact && serverRecord?.artifact) {
        saveRunArtifact(normalizedRunId, artifactWithPreview);
        setActionMsg(isReviewArtifact ? `Review geladen: ${artifact.findings!.length} Findings.` : "Run loaded from server.");
      } else {
        setActionMsg(isReviewArtifact ? `Review geladen: ${artifact.findings!.length} Findings.` : "Run loaded from local history.");
      }
    } else {
      // No artifact stored — show Logs so user can see the run trace instead of stale chat
      setCenterTab("logs");
      setPhase("done");
      setActionMsg("Run metadata loaded. Full artifact is not available for this run.");
    }
  }, [effectiveWorkspaceId]);  // repoUrl intentionally excluded: no longer used as fallback inside callback

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenRun = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string }>).detail;
      const runId = detail?.runId?.trim();
      if (!runId) return;
      // Remove the pending key immediately so a subsequent page reload doesn't re-load this run
      try { window.localStorage.removeItem(PENDING_CODE_RUN_ID_KEY); } catch { /* ignore */ }
      // Mark as opened so the URL-param useEffect doesn't trigger a duplicate load
      lastOpenedRunIdRef.current = runId;
      void openRunById(runId);
    };
    window.addEventListener("elyra:open-code-run", onOpenRun);
    return () => window.removeEventListener("elyra:open-code-run", onOpenRun);
  }, [openRunById]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingRunId = window.localStorage.getItem(PENDING_CODE_RUN_ID_KEY)?.trim();
    if (!pendingRunId) return;
    window.localStorage.removeItem(PENDING_CODE_RUN_ID_KEY);
    lastOpenedRunIdRef.current = pendingRunId;
    void openRunById(pendingRunId);
  }, [openRunById]);

  useEffect(() => {
    const queryRunId = searchParams.get("openRunId")?.trim();
    if (!queryRunId) return;
    // Strip openRunId from the URL immediately so reloads don't re-trigger this run
    const cleanParams = new URLSearchParams(searchParams.toString());
    cleanParams.delete("openRunId");
    const cleanUrl =
      window.location.pathname +
      (cleanParams.size > 0 ? `?${cleanParams.toString()}` : "");
    router.replace(cleanUrl);
    if (lastOpenedRunIdRef.current === queryRunId) return;
    lastOpenedRunIdRef.current = queryRunId;
    void openRunById(queryRunId);
  }, [openRunById, router, searchParams]);

  const rollbackPlaygroundTo = useCallback(async (commit: string) => {
    if (!commit || rollbackCommit) return;
    setRollbackCommit(commit);
    setActionMsg(`Rolling playground back to ${commit}...`);
    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      const response = await fetch("/api/os/code/playground/versions", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ action: "rollback", commit }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; head?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Rollback failed.");
      }
      addLog(`Playground rollback applied to ${payload.head ?? commit}.`);
      setActionMsg(`Playground rollback successful (${payload.head ?? commit}).`);
      await loadPlaygroundVersions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rollback failed.";
      addLog(`Playground rollback failed: ${message}`);
      setActionMsg(message);
    } finally {
      setRollbackCommit(null);
    }
  }, [addLog, loadPlaygroundVersions, requestHeaders, rollbackCommit]);

  const snapshotPlaygroundNow = useCallback(async () => {
    setVersionsLoading(true);
    setActionMsg("Creating playground snapshot...");
    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      const response = await fetch("/api/os/code/playground/versions", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "snapshot",
          message: `playground: manual ${new Date().toLocaleString()}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; head?: string; output?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Snapshot failed.");
      }
      addLog(payload.output || `Playground snapshot committed (${payload.head ?? "unknown"}).`);
      setActionMsg(payload.output || "Playground snapshot committed.");
      await loadPlaygroundVersions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Snapshot failed.";
      addLog(`Playground snapshot failed: ${message}`);
      setActionMsg(message);
    } finally {
      setVersionsLoading(false);
    }
  }, [addLog, loadPlaygroundVersions]);

  const handleReset = useCallback(() => {
    clearDockRunUpdate();
    setAutoRunRequested(false);
    setAutoExecuteRequested(false);
    setPhase("idle");
    setPlanArtifact(null);
    setResultArtifact(null);
    setLogs([]);
    setErrorMsg(null);
    setApproved(false);
    setCenterTab("plan");
    setShowPreviewPanel(false);
    setActiveRunId(null);
    setExecutionContract(null);
    setContractApproved(false);
    setActionMsg(null);
  }, []);

  const enqueueCurrentTask = useCallback(() => {
    const nextTask = taskText.trim();
    if (!nextTask) return;
    const record: QueuedAgentTask = {
      id: crypto.randomUUID(),
      role: agentRole,
      skill: selectedSkill,
      task: nextTask,
      repoUrl: repoUrl.trim(),
      branch: branch.trim() || "main",
      folderPath: folderPath.trim(),
      selectedFiles: [...selectedFiles],
      stage: deliveryStage,
      terminalAccess,
      useReasoning,
      branchPerAgent,
      executionMode,
      vibeCoding,
      teamMode,
      teamConfig: { ...teamConfig },
      budgetUsd,
      deadlineMinutes,
      createdAt: Date.now(),
    };
    setQueuedTasks((current) => [record, ...current].slice(0, 20));
    setActionMsg("Task added to agent queue.");
  }, [taskText, agentRole, selectedSkill, repoUrl, branch, folderPath, selectedFiles, deliveryStage, terminalAccess, useReasoning, branchPerAgent, executionMode, vibeCoding, teamMode, teamConfig, budgetUsd, deadlineMinutes]);

  const removeQueuedTask = useCallback((id: string) => {
    setQueuedTasks((current) => current.filter((task) => task.id !== id));
  }, []);

  const spawnDefaultTeam = useCallback(() => {
    const baseTask = taskText.trim();
    if (!baseTask) return;
    const now = Date.now();
    const plan = deriveTeamPlan();
    const makeTask = (
      role: AgentRole,
      suffix: string,
      skill: CodingSkill,
      offset: number,
      reasoning = true,
    ): QueuedAgentTask => ({
      id: crypto.randomUUID(),
      role,
      skill,
      task: `${baseTask}\n\nTeam focus: ${suffix}`,
      repoUrl: repoUrl.trim(),
      branch: branch.trim() || "main",
      folderPath: folderPath.trim(),
      selectedFiles: [...selectedFiles],
      stage: deliveryStage,
      terminalAccess,
      useReasoning: reasoning,
      branchPerAgent,
      executionMode,
      vibeCoding,
      teamMode,
      teamConfig: { ...teamConfig },
      budgetUsd,
      deadlineMinutes,
      createdAt: now + offset,
    });

    const roleFocus: Record<AgentRole, string> = {
      ui: "Design system polish and readability pass.",
      frontend: "Interaction and rendering performance refinement.",
      backend: "API latency, caching and reliability hardening.",
      infra: "Runtime/deploy/tooling resilience improvements.",
      qa: "Regression tests and verification gate.",
      general: "Cross-functional synthesis and execution support.",
    };

    const roleSkill: Record<AgentRole, CodingSkill> = {
      ui: "implement-feature",
      frontend: "implement-feature",
      backend: "refactor-module",
      infra: "fix-build",
      qa: "write-tests",
      general: "custom",
    };

    const team: QueuedAgentTask[] = [];
    let offset = 1;
    for (const slot of plan) {
      for (let i = 0; i < slot.count; i += 1) {
        team.push(
          makeTask(
            slot.role,
            `${roleFocus[slot.role]} (${i + 1}/${slot.count})`,
            roleSkill[slot.role],
            offset,
            slot.role !== "qa",
          ),
        );
        offset += 1;
      }
    }

    setQueuedTasks((current) => [...team, ...current].slice(0, 30));
    setActionMsg(`Spawned team (${teamMode}): ${teamPlanSummary}.`);
  }, [taskText, deriveTeamPlan, repoUrl, branch, folderPath, selectedFiles, deliveryStage, terminalAccess, branchPerAgent, executionMode, vibeCoding, teamMode, teamConfig, budgetUsd, deadlineMinutes, teamPlanSummary]);

  const runQueuedTask = useCallback((id: string) => {
    const next = queuedTasks.find((task) => task.id === id);
    if (!next) return;
    setTaskText(next.task);
    setAgentRole(next.role);
    setSelectedSkill(next.skill);
    setRepoUrl(next.repoUrl);
    setBranch(next.branch);
    setFolderPath(next.folderPath);
    setSelectedFilesPinned(false);
    setSelectedFiles(next.selectedFiles);
    setDeliveryStage(next.stage);
    setTerminalAccess(next.terminalAccess);
    setUseReasoning(next.useReasoning);
    setBranchPerAgent(next.branchPerAgent);
    setExecutionMode(next.executionMode);
    setVibeCoding(next.vibeCoding);
    setTeamMode(next.teamMode);
    setTeamConfig(next.teamConfig);
    setBudgetUsd(next.budgetUsd);
    setDeadlineMinutes(next.deadlineMinutes);
    setQueuedTasks((current) => current.filter((task) => task.id !== id));
    setAutoRunRequested(true);
    setAutoExecuteRequested(false);
    setActionMsg("Queued task loaded. Generating plan.");
  }, [queuedTasks]);

  const runQueuedTaskDetached = useCallback(
    async (queued: QueuedAgentTask, taskIndex: number, totalTasks: number, completedCount: number, failedCount: number) => {
      const orchestratorRunId = `orch-${queued.id}`;
      setOrchestratorProgress({
        activeTask: queued.task,
        index: taskIndex + 1,
        total: totalTasks,
        status: "planning",
        completed: completedCount,
        failed: failedCount,
      });
      updateRunLedger({
        runId: orchestratorRunId,
        app: "orchestrator",
        agent: queued.role,
        task: queued.task,
        repoUrl: queued.repoUrl,
        branch: queued.branch,
        stage: queued.stage,
        status: "planning",
        summary: "Queued by orchestrator",
      });
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      addLog(`Orchestrator: planning "${queued.task}" (${queued.role})`);
      const planRes = await postRunRequest(
        headers,
        buildRunPayload("plan", {
          task: queued.task,
          skill: queued.skill,
          repoUrl: queued.repoUrl,
          branch: queued.branch,
          folderPath: queued.folderPath,
          stage: queued.stage,
          agentRole: queued.role,
          terminalAccess: queued.terminalAccess,
          useReasoning: queued.useReasoning,
          attachments: [],
          selectedFiles: queued.selectedFiles,
          branchPerAgent: queued.branchPerAgent,
          executionMode: queued.executionMode,
          vibeCoding: queued.vibeCoding,
          teamMode: queued.teamMode,
          teamConfig: queued.teamConfig,
          agentBranchName: `codex/${queued.role}-${queued.id.slice(0, 8)}`,
          budgetUsd: queued.budgetUsd,
          deadlineMinutes: queued.deadlineMinutes,
          autonomous: true,
        }),
        PLAN_REQUEST_TIMEOUT_MS,
        "plan",
      );
      const planData = await parseJsonResponse<{ ok: boolean; error?: string; warning?: string; artifact?: ResultArtifact; source?: string }>(planRes, "plan");
      if (!planData.ok) {
        throw new Error(planData.error || "Plan failed");
      }
      if (planData.warning) addLog(`Orchestrator warning: ${planData.warning}`);

      // Autonomous execution already happened during the plan step — skip the separate execute
      if (planData.source === "elli-autonomous" && planData.artifact) {
        const outcome = planData.artifact;
        const taskSucceeded = outcome.buildReport?.success ?? false;
        addLog(
          `Orchestrator: ${queued.role} (autonomous) completed "${queued.task}" (${outcome.executionApplied ? "applied" : "not applied"}, build ${taskSucceeded ? "ok" : "failed"})`,
        );
        setOrchestratorProgress((prev) =>
          prev
            ? { ...prev, status: taskSucceeded ? "done" : "failed", completed: prev.completed + (taskSucceeded ? 1 : 0), failed: prev.failed + (taskSucceeded ? 0 : 1) }
            : null,
        );
        updateRunLedger({
          runId: orchestratorRunId,
          app: "orchestrator",
          agent: queued.role,
          task: queued.task,
          repoUrl: queued.repoUrl,
          branch: queued.branch,
          status: taskSucceeded ? "completed" : "failed",
          stage: queued.stage,
          summary: outcome.summary,
          ...(outcome.previewUrl ? { previewUrl: outcome.previewUrl } : {}),
          filesChanged: outcome.filesChanged?.length ?? 0,
          ...(outcome.telemetry?.estimatedCostUsd != null ? { estimatedCostUsd: outcome.telemetry.estimatedCostUsd } : {}),
          ...(outcome.telemetry?.replayId ? { replayId: outcome.telemetry.replayId } : {}),
          gateFailures: (outcome.gates ?? []).filter((gate) => gate.status === "failed").length,
        });
        return;
      }

      setOrchestratorProgress((prev) => prev ? { ...prev, status: "executing" } : null);
      addLog(`Orchestrator: executing "${queued.task}" (${queued.role})`);
      const execRes = await postRunRequest(
        headers,
        buildRunPayload("execute", {
          task: queued.task,
          skill: queued.skill,
          repoUrl: queued.repoUrl,
          branch: queued.branch,
          folderPath: queued.folderPath,
          stage: queued.stage,
          agentRole: queued.role,
          terminalAccess: queued.terminalAccess,
          useReasoning: queued.useReasoning,
          attachments: [],
          selectedFiles: queued.selectedFiles,
          branchPerAgent: queued.branchPerAgent,
          executionMode: queued.executionMode,
          vibeCoding: queued.vibeCoding,
          teamMode: queued.teamMode,
          teamConfig: queued.teamConfig,
          agentBranchName: `codex/${queued.role}-${queued.id.slice(0, 8)}`,
          budgetUsd: queued.budgetUsd,
          deadlineMinutes: queued.deadlineMinutes,
        }),
        EXECUTE_REQUEST_TIMEOUT_MS,
        "execute",
      );
      const execData = await parseJsonResponse<{
        ok: boolean;
        error?: string;
        artifact?: ResultArtifact;
      }>(execRes, "execute");
      if (!execData.ok || !execData.artifact) {
        throw new Error(execData.error || "Execute failed");
      }
      const outcome = execData.artifact;
      const taskSucceeded = outcome.buildReport.success;
      addLog(
        `Orchestrator: ${queued.role} completed "${queued.task}" (${outcome.executionApplied ? "applied" : "not applied"}, build ${taskSucceeded ? "ok" : "failed"})`,
      );
      setOrchestratorProgress((prev) =>
        prev
          ? {
              ...prev,
              status: taskSucceeded ? "done" : "failed",
              completed: prev.completed + (taskSucceeded ? 1 : 0),
              failed: prev.failed + (taskSucceeded ? 0 : 1),
            }
          : null,
      );
      updateRunLedger({
        runId: orchestratorRunId,
        app: "orchestrator",
        agent: queued.role,
        task: queued.task,
        repoUrl: queued.repoUrl,
        branch: queued.branch,
        status: taskSucceeded ? "completed" : "failed",
        stage: queued.stage,
        summary: outcome.summary,
        ...(outcome.previewUrl ? { previewUrl: outcome.previewUrl } : {}),
        filesChanged: outcome.filesChanged?.length ?? 0,
        ...(outcome.telemetry?.estimatedCostUsd != null ? { estimatedCostUsd: outcome.telemetry.estimatedCostUsd } : {}),
        ...(outcome.telemetry?.replayId ? { replayId: outcome.telemetry.replayId } : {}),
        gateFailures: (outcome.gates ?? []).filter((gate) => gate.status === "failed").length,
      });
    },
    [addLog, buildRunPayload, setOrchestratorProgress, updateRunLedger],
  );

  const runOrchestratorQueue = useCallback(async () => {
    if (queuedTasks.length === 0 || orchestratorRunning) return;
    orchestratorStopRef.current = false;
    setOrchestratorRunning(true);
    setOrchestratorProgress(null);
    // Switch to chat tab so the live progress panel is immediately visible
    setCenterTab("chat");
    setActionMsg(`Orchestrator started with concurrency ${queueConcurrency}.`);

    const queueSnapshot = [...queuedTasks];
    const totalTasks = queueSnapshot.length;
    setQueuedTasks([]);

    let cursor = 0;
    // Shared mutable counters — safe in JS single-threaded event loop
    const counts = { completed: 0, failed: 0 };
    const worker = async () => {
      while (!orchestratorStopRef.current) {
        const index = cursor;
        cursor += 1;
        const job = queueSnapshot[index];
        if (!job) break;
        try {
          await runQueuedTaskDetached(job, index, totalTasks, counts.completed, counts.failed);
          counts.completed += 1;
        } catch (error) {
          counts.failed += 1;
          setOrchestratorProgress((prev) =>
            prev ? { ...prev, status: "failed", failed: prev.failed + 1 } : null,
          );
          updateRunLedger({
            runId: `orch-${job.id}`,
            app: "orchestrator",
            agent: job.role,
            task: job.task,
            repoUrl: job.repoUrl,
            branch: job.branch,
            stage: job.stage,
            status: "failed",
            summary: error instanceof Error ? error.message : "Unexpected failure",
          });
          addLog(
            `Orchestrator error (${job.role}): ${error instanceof Error ? error.message : "Unexpected failure"}`,
          );
        }
      }
    };

    const workers = Array.from({ length: Math.max(1, Math.min(4, queueConcurrency)) }, () => worker());
    await Promise.all(workers);
    setOrchestratorRunning(false);
    setActionMsg(orchestratorStopRef.current ? "Orchestrator stopped." : "Orchestrator queue completed.");
  }, [addLog, orchestratorRunning, queueConcurrency, queuedTasks, runQueuedTaskDetached, setCenterTab, setOrchestratorProgress, updateRunLedger]);

  const stopOrchestratorQueue = useCallback(() => {
    orchestratorStopRef.current = true;
    setOrchestratorRunning(false);
    setActionMsg("Stopping orchestrator…");
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const hasPlan = planArtifact !== null && !!planArtifact.plan;
  const hasResult = resultArtifact !== null && (!!resultArtifact.status || !!resultArtifact.summary);
  const canRun = taskText.trim().length > 0 && phase === "idle";
  const canApprove = hasPlan && phase === "done" && !approved && !hasResult;
  const designPromotionBlocked = Boolean(resultArtifact?.designDraft?.url && resultArtifact?.designDraft?.approved !== true);
  const resultHasDiff = typeof resultArtifact?.diff === "string" && resultArtifact.diff.trim().length > 0;
  const resultHasChangedFiles = Array.isArray(resultArtifact?.filesChanged) && resultArtifact.filesChanged.length > 0;
  const resultWasApplied = resultArtifact?.executionApplied === true || resultArtifact?.workflow?.current === "promoted";
  const hasPromotableResult = hasResult && resultWasApplied && (resultHasDiff || resultHasChangedFiles);
  const canPromoteToDev = hasPromotableResult && resultArtifact?.buildReport?.success === true && deliveryStage === "playground" && !designPromotionBlocked;
  const canPromoteToProd = hasPromotableResult && resultArtifact?.buildReport?.success === true && deliveryStage === "dev" && !designPromotionBlocked;
  const canPromoteToMain = hasPromotableResult && resultArtifact?.buildReport?.success === true && deliveryStage === "dev" && !designPromotionBlocked;
  const promoteBlockedReason = !hasResult
    ? "No run result available yet."
    : !resultWasApplied
      ? "This run was analysis-only and did not apply code changes."
      : !resultHasDiff && !resultHasChangedFiles
        ? "No promotable file changes were recorded for this run."
        : resultArtifact?.buildReport?.success !== true
          ? "Promotion requires a successful build gate."
          : designPromotionBlocked
            ? "Approve the design draft before promotion."
            : null;

  useEffect(() => {
    if (!autoRunRequested || !canRun) return;
    setAutoRunRequested(false);
    setAutoExecuteRequested(false);
    void handlePlan();
  }, [autoRunRequested, canRun, handlePlan]);

  useEffect(() => {
    if (!autoExecuteRequested || !canApprove) return;
    setAutoExecuteRequested(false);
    void handleExecute();
  }, [autoExecuteRequested, canApprove, handleExecute]);

  const promoteRun = useCallback(async (nextStage: PromotionStage) => {
    if (!resultArtifact?.executionApplied && resultArtifact?.workflow?.current !== "promoted") {
      setActionMsg("Promotion blocked: this run did not apply code changes.");
      return;
    }
    if (!resultArtifact?.diff?.trim()) {
      setActionMsg("Promotion blocked: no applied diff available.");
      return;
    }
    if (resultArtifact.designDraft?.url && resultArtifact.designDraft.approved !== true) {
      setActionMsg("Promotion blocked: approve design draft first (Approve Design & Execute).");
      return;
    }

    setPhase("executing");
    setErrorMsg(null);
    setActionMsg(`Promoting to ${nextStage.toUpperCase()}...`);
    addLog(`Promotion started: replaying applied diff into ${nextStage}.`);
    const localRunRecord = activeRunId
      ? loadRunLedger().find((item) => item.id === activeRunId) ?? null
      : null;
    const promotionRepoUrl = (localRunRecord?.repoUrl || repoUrl).trim();
    const promotionBranch = (localRunRecord?.branch || branch).trim() || "main";
    const promotionFromStage = localRunRecord?.stage ?? deliveryStage;
    const promotionSelectedFiles = Array.isArray(resultArtifact.filesChanged)
      ? resultArtifact.filesChanged
          .map((entry) => (entry && typeof entry.path === "string" ? entry.path.trim() : ""))
          .filter(Boolean)
      : [];
    const fallbackPromotionFiles =
      promotionSelectedFiles.length > 0 ? promotionSelectedFiles : extractFilesFromUnifiedDiff(resultArtifact.diff ?? "");
    if (fallbackPromotionFiles.length === 0) {
      setActionMsg("Promotion blocked: no changed files could be resolved from the applied diff.");
      addLog("Promotion blocked: unable to resolve changed files from artifact diff.");
      return;
    }
    void appendPromotionAudit({
      workspaceId: effectiveWorkspaceId,
      fromStage: promotionFromStage,
      toStage: nextStage,
      status: "started",
      branch: promotionBranch,
      repoUrl: promotionRepoUrl,
      summary: `Promotion started (${promotionFromStage} -> ${nextStage}).`,
      ...(activeRunId ? { runId: activeRunId } : {}),
    });

    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      const res = await postRunRequest(
        headers,
        {
          ...buildRunPayload("execute", {
            stage: nextStage,
            repoUrl: promotionRepoUrl,
            branch: promotionBranch,
            selectedFiles: fallbackPromotionFiles,
            ...(resultArtifact.designDraft?.approved ? { designApproved: true } : {}),
            ...(resultArtifact.designDraft?.url ? { designDraftUrl: resultArtifact.designDraft.url } : {}),
          }),
          providedDiff: resultArtifact.diff,
        },
        EXECUTE_REQUEST_TIMEOUT_MS,
        "execute",
      );
      const data = await parseJsonResponse<{
        ok: boolean;
        artifact?: ResultArtifact;
        error?: string;
        warning?: string;
      }>(res, "execute");
      if (!data.ok || !data.artifact) {
        throw new Error(data.error || `Promotion to ${nextStage.toUpperCase()} failed.`);
      }
      const promotedArtifact = data.artifact;
      const appliedFiles = promotedArtifact.filesChanged?.length ?? 0;
      const idempotentReplay =
        Array.isArray(promotedArtifact.executionLog) &&
        promotedArtifact.executionLog.some((line) =>
          /already present in target stage/i.test(line),
        );
      const promotionApplied =
        promotedArtifact.executionApplied === true || idempotentReplay;
      if (!promotionApplied) {
        throw new Error(
          `Promotion verification failed: patch was not applied in ${nextStage.toUpperCase()} (executionApplied=${String(
            promotedArtifact.executionApplied,
          )}, filesChanged=${appliedFiles}).`,
        );
      }
      if (appliedFiles === 0 && !idempotentReplay) {
        addLog(
          `Promotion warning: ${nextStage.toUpperCase()} run reported 0 changed files.`,
        );
      }
      if (promotedArtifact.buildReport?.success !== true) {
        throw new Error(`Promotion verification failed: ${nextStage.toUpperCase()} build gate did not pass.`);
      }
      if (data.warning) addLog(`⚠ ${data.warning}`);
      setResultArtifact(promotedArtifact);
      setDeliveryStage(nextStage);
      setPhase("done");
      updateRunLedger({
        status: "completed",
        stage: nextStage,
        summary: `Promoted run to ${nextStage.toUpperCase()}.`,
        ...(promotedArtifact.previewUrl ? { previewUrl: promotedArtifact.previewUrl } : {}),
        filesChanged: promotedArtifact.filesChanged?.length ?? 0,
      });
      void appendPromotionAudit({
        workspaceId: effectiveWorkspaceId,
        fromStage: promotionFromStage,
        toStage: nextStage,
        status: "completed",
        summary: `Promotion completed (${promotionFromStage} -> ${nextStage}).`,
        filesChanged: promotedArtifact.filesChanged?.length ?? 0,
        branch: promotionBranch,
        repoUrl: promotionRepoUrl,
        ...(activeRunId ? { runId: activeRunId } : {}),
        ...(promotedArtifact.telemetry?.replayId ? { replayId: promotedArtifact.telemetry.replayId } : {}),
      });
      setActionMsg(
        nextStage === "dev"
          ? "Promotion to Dev applied and verified."
          : "Promotion to Prod applied and verified."
      );
      addLog(`Promotion finished: ${nextStage.toUpperCase()} apply + verification passed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Promotion failed.";
      setPhase("error");
      setErrorMsg(message);
      setActionMsg(message);
      addLog(`Promotion failed: ${message}`);
      void appendPromotionAudit({
        workspaceId: effectiveWorkspaceId,
        fromStage: promotionFromStage,
        toStage: nextStage,
        status: "failed",
        summary: message,
        branch: promotionBranch,
        repoUrl: promotionRepoUrl,
        ...(activeRunId ? { runId: activeRunId } : {}),
      });
    }
  }, [activeRunId, addLog, appendPromotionAudit, branch, buildRunPayload, deliveryStage, effectiveWorkspaceId, repoUrl, requestHeaders, resultArtifact, updateRunLedger]);

  const promoteToMainBranch = useCallback(async () => {
    if (!canPromoteToMain || !resultArtifact) return;
    setPromotingMain(true);
    setActionMsg("Creating promotion branch + pushing to origin...");
    addLog("Promotion started: creating codex/* branch for PR to main.");
    void appendPromotionAudit({
      workspaceId: effectiveWorkspaceId,
      fromStage: deliveryStage,
      toStage: "main",
      status: "started",
      branch,
      repoUrl: repoUrl.trim(),
      summary: "Main promotion started.",
      ...(activeRunId ? { runId: activeRunId } : {}),
    });
    try {
      const headers = await requestHeaders({ "Content-Type": "application/json" });
      const response = await fetch("/api/os/code/promote", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          workspaceId: effectiveWorkspaceId,
          baseBranch: "main",
          commitMessage: `feat(dev): ${taskText.trim() || "promoted changes"}`,
          prTitle: `Promote dev changes: ${taskText.trim() || "update"}`,
          prBody: resultArtifact.summary,
          files: (resultArtifact.filesChanged ?? []).map((file) => file.path),
          createPullRequest: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        branchName?: string;
        compareUrl?: string | null;
        prUrl?: string | null;
        prCreated?: boolean;
        prWarning?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Promotion branch push failed.");
      }
      addLog(`Promotion branch pushed: ${payload.branchName ?? "codex/*"}`);
      if (payload.prCreated && payload.prUrl) {
        addLog(`Pull request created: ${payload.prUrl}`);
      } else if (payload.prWarning) {
        addLog(`PR warning: ${payload.prWarning}`);
      }
      if (payload.compareUrl) {
        addLog(`Open PR compare: ${payload.compareUrl}`);
      }
      const preferredUrl = payload.prUrl || payload.compareUrl;
      setActionMsg(
        payload.prCreated
          ? "Promotion branch pushed and PR created."
          : preferredUrl
            ? "Promotion branch pushed. Open GitHub link to continue."
            : "Promotion branch pushed."
      );
      void appendPromotionAudit({
        workspaceId: effectiveWorkspaceId,
        fromStage: deliveryStage,
        toStage: "main",
        status: "completed",
        branch,
        repoUrl: repoUrl.trim(),
        summary: payload.prCreated ? "Promotion branch pushed and PR created." : "Promotion branch pushed.",
        filesChanged: resultArtifact.filesChanged?.length ?? 0,
        ...(activeRunId ? { runId: activeRunId } : {}),
        ...(resultArtifact.telemetry?.replayId ? { replayId: resultArtifact.telemetry.replayId } : {}),
        ...(payload.prUrl ? { prUrl: payload.prUrl } : {}),
      });
      if (preferredUrl) {
        window.open(preferredUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Promotion to main failed.";
      addLog(`Promotion failed: ${message}`);
      setActionMsg(message);
      void appendPromotionAudit({
        workspaceId: effectiveWorkspaceId,
        fromStage: deliveryStage,
        toStage: "main",
        status: "failed",
        summary: message,
        branch,
        repoUrl: repoUrl.trim(),
        ...(activeRunId ? { runId: activeRunId } : {}),
      });
    } finally {
      setPromotingMain(false);
    }
  }, [activeRunId, addLog, appendPromotionAudit, branch, canPromoteToMain, deliveryStage, effectiveWorkspaceId, repoUrl, requestHeaders, resultArtifact, taskText]);

  const handleStageSelect = useCallback((nextStage: PromotionStage) => {
    if (isRunning) return;
    if (nextStage === "dev" && canPromoteToDev) {
      void promoteRun("dev");
      return;
    }
    if (nextStage === "prod" && canPromoteToProd) {
      void promoteRun("prod");
      return;
    }
    setDeliveryStage(nextStage);
  }, [canPromoteToDev, canPromoteToProd, isRunning, promoteRun]);

  const providerEntries = Object.entries(providerStatuses);
  const autoPrefersBroadAnalysisProvider =
    selectedSkill === "review-code" || looksLikeBroadAnalysisTask(taskText);
  const effectiveProviderId =
    selectedProvider === "auto"
      ? (autoPrefersBroadAnalysisProvider
          ? (providerStatuses.gemini?.configured
              ? "gemini"
              : providerStatuses.gemini_cli?.configured
                ? "gemini_cli"
                : providerStatuses.openai?.configured
                  ? "openai"
                  : providerStatuses.claude_direct?.configured
                    ? "claude_direct"
                    : providerStatuses.claude_vertex?.configured
                      ? "claude_vertex"
                      : "gemini")
          : agentRole === "frontend" || agentRole === "ui"
          ? (providerStatuses.gemini_cli?.configured
              ? "gemini_cli"
              : providerStatuses.gemini?.configured
                ? "gemini"
                : providerStatuses.openai?.configured
                  ? "openai"
                  : providerStatuses.claude_direct?.configured
                    ? "claude_direct"
                    : providerStatuses.claude_vertex?.configured
                      ? "claude_vertex"
                      : "gemini")
          : "gemini")
      : selectedProvider;
  const currentProvider = providerStatuses[effectiveProviderId];
  const reasoningSupported = currentProvider?.capabilities?.supportsReasoning !== false;
  const patchActionsSupported = currentProvider?.capabilities?.supportsCodePatch !== false;
  const effectiveUseReasoning = useReasoning && reasoningSupported;
  const summaryText = resultArtifact?.summary ?? planArtifact?.plan?.summary ?? "";
  const fileListText = useMemo(
    () =>
      (resultArtifact?.filesChanged ?? [])
        .map((file) => `${file.path} (+${file.linesAdded} -${file.linesRemoved})`)
        .join("\n"),
    [resultArtifact]
  );
  const activityFeed = useMemo(() => {
    if (isRunning && liveRunEvents.length > 0) {
      return liveRunEvents.map((event) =>
        event.detail ? `${event.summary} — ${event.detail}` : event.summary
      );
    }
    const executionLog = Array.isArray(resultArtifact?.executionLog) ? resultArtifact.executionLog : [];
    if (executionLog.length > 0) {
      return executionLog.slice(-60);
    }
    return logs.slice(-40).map((entry) => entry.replace(/^\[[^\]]+\]\s*/, ""));
  }, [isRunning, liveRunEvents, logs, resultArtifact]);

  // Map liveRunEvents directly when running — preserves event_type as kind so
  // every entry has a proper detail and the <details> element is expandable.
  // The `id` field carries the stable Supabase event ID so that the React key
  // stays the same across re-renders, which lets the browser's native <details>
  // toggle state survive liveRunEvents updates without being reset by React.
  const investigatorActivityFeed = useMemo((): InvestigatorLogEntry[] => {
    if (isRunning && liveRunEvents.length > 0) {
      return liveRunEvents
        .filter((ev) => ev.summary)
        .map((ev): InvestigatorLogEntry => {
          const t = ev.type ?? "";
          const title = elliVoice(ev.summary);
          const detail = ev.detail || ev.summary;
          const id = ev.id;
          if (t === "PLAN_WRITTEN") return { id, kind: "status", title, detail };
          if (t === "TOOL_STARTED" || t === "TOOL_REQUESTED") return { id, kind: "tool", title, detail };
          if (t === "TOOL_COMPLETED") return { id, kind: "tool", title, detail };
          if (t === "APPROVAL_REQUIRED" || t === "AUTH_REQUIRED") return { id, kind: "thinking", title, detail };
          if (t === "ARTIFACT_CREATED") return { id, kind: "thinking", title, detail };
          if (t === "RUN_CREATED" || t === "RUN_SUCCEEDED" || t === "RUN_FAILED" || t === "RUN_CANCELLED") return { id, kind: "status", title, detail };
          // Generic fallback — always include detail so entry is expandable
          return { id, kind: "plain", title, detail };
        });
    }
    return activityFeed
      .map((line, i) => ({ ...parseInvestigatorLogLine(line), id: `log-${i}` }))
      .filter((entry) => entry.title || entry.detail);
  }, [isRunning, liveRunEvents, activityFeed]);
  const reviewFindings = resultArtifact?.findings ?? [];
  const reviewNextSteps = resultArtifact?.nextSteps ?? [];

  useEffect(() => {
    if (useReasoning && !reasoningSupported) {
      setUseReasoning(false);
    }
  }, [reasoningSupported, useReasoning]);

  useEffect(() => {
    const reviewMode = selectedSkill === "review-code";
    setSuggestionsOnly(reviewMode);
    if (reviewMode) {
      setTaskText((currentTask) =>
        currentTask.trim()
          ? currentTask
          : "Scan the current repository end-to-end and list the highest-impact improvements only."
      );
    }
  }, [selectedSkill]);

  // ── Phase stepper ────────────────────────────────────────────────────────────
  const PHASES: { id: string; label: string }[] = [
    { id: "plan", label: "Plan" },
    { id: "execute", label: "Execute" },
    { id: "review", label: "Review" },
    { id: "done", label: "Done" },
  ];
  const phaseIndex =
    phase === "idle" ? -1
    : phase === "planning" ? 0
    : phase === "executing" ? 1
    : phase === "done" && !hasResult ? 0
    : phase === "done" && hasResult ? 3
    : phase === "error" ? -1
    : 0;

  return (
    <div className="flex h-full w-full overflow-hidden bg-[color:var(--bg-surface)] text-[color:var(--text-primary)]">
      {/* ── Left panel: Repo + Task + Controls ─────────────────────────────────── */}
      <aside
        className="flex w-64 shrink-0 flex-col gap-0 overflow-y-auto border-r"
        style={{ borderColor: "var(--os-border-soft)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--os-border-soft)" }}
        >
          <div className="flex items-center gap-2">
            <Code2 size={15} className="text-orange-400 shrink-0" />
            <span className="text-sm font-semibold tracking-tight">Coding Agent</span>
          </div>
          {/* Simple / Advanced mode toggle */}
          <div
            className="flex items-center rounded-full border p-0.5 text-[10px] font-semibold"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
          >
            <button
              type="button"
              onClick={() => setSimpleMode(true)}
              className="rounded-full px-2 py-0.5 transition-colors"
              style={{
                background: simpleMode ? "color-mix(in srgb, #f97316 18%, var(--bg-surface))" : "transparent",
                color: simpleMode ? "#f97316" : "var(--text-muted)",
              }}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setSimpleMode(false)}
              className="rounded-full px-2 py-0.5 transition-colors"
              style={{
                background: !simpleMode ? "color-mix(in srgb, #f97316 18%, var(--bg-surface))" : "transparent",
                color: !simpleMode ? "#f97316" : "var(--text-muted)",
              }}
            >
              Advanced
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Repo URL */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--text-secondary)]">
              <GitBranch size={11} />
              Repository
            </label>
            <select
              value={repoOptions.some((option) => option.value === repoUrl) ? repoUrl : ""}
              onChange={(e) => {
                const nextRepo = e.target.value;
                setRepoUrl(nextRepo);
                setFolderPath("");
              }}
              disabled={isRunning || repoOptions.length === 0}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            >
              <option value="">Custom repository…</option>
              {repoOptions.map((option) => (
                <option key={option.id} value={option.value}>
                  {option.label} {option.source === "github" ? "(GitHub)" : "(Local)"}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={selectedSkill === "review-code" ? "Pick a repo, paste a GitHub URL, or enter a local path" : "https://github.com/org/repo or /absolute/local/path"}
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isRunning}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            />
            <select
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              disabled={isRunning || folderOptions.length === 0}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            >
              {folderOptions.map((option) => (
                <option key={option.value || "__root__"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Specific folder inside the repo (optional)"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              disabled={isRunning}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            />
            <div
              className="rounded-lg border p-2"
              style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
            >
              {suggestedScope ? (
                <div
                  className="mb-2 rounded-lg border p-2"
                  style={{
                    borderColor: "rgba(249,115,22,0.2)",
                    background: "color-mix(in srgb, #f97316 8%, var(--bg-elevated))",
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-300">
                        Suggested scope
                      </p>
                      <p className="text-[10px] text-[color:var(--text-secondary)]">
                        {suggestedScope.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFilesPinned(true);
                        setSelectedFiles(suggestedScope.files.slice(0, 12));
                      }}
                      disabled={isRunning || !canApplySuggestedScope}
                      className="rounded-lg border px-2 py-1 text-[10px] font-medium transition disabled:opacity-50"
                      style={{
                        borderColor: "rgba(249,115,22,0.28)",
                        color: "#fdba74",
                        background: "rgba(249,115,22,0.08)",
                      }}
                    >
                      Apply suggested scope
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {suggestedScope.files.map((file) => (
                      <span
                        key={file}
                        className="rounded-md border px-1.5 py-0.5 text-[9px] font-mono"
                        style={{
                          borderColor: selectedFiles.includes(file) ? "rgba(249,115,22,0.28)" : "var(--os-border-soft)",
                          color: selectedFiles.includes(file) ? "#fdba74" : "var(--text-secondary)",
                          background: selectedFiles.includes(file) ? "rgba(249,115,22,0.08)" : "transparent",
                        }}
                        title={file}
                      >
                        {file}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  Target files
                </p>
                <span className="text-[10px] text-[color:var(--text-muted)]">
                  {displayedTargetFileCount}/12
                </span>
              </div>
              {wholeRepoReviewMode ? (
                <p className="mb-1.5 text-[10px] text-[color:var(--text-secondary)]">
                  Whole-repository review mode is active. No file allowlist is applied.
                </p>
              ) : null}
              {usingAutoSuggestedScope ? (
                <p className="mb-1.5 text-[10px] text-[color:var(--text-secondary)]">
                  Using suggested scope automatically until you choose files yourself.
                </p>
              ) : null}
              {!wholeRepoReviewMode && fileOptions.length > 0 ? (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {fileOptions.slice(0, 24).map((option) => {
                    const active = (selectedFiles.length > 0 ? selectedFiles : effectiveSelectedFiles).includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          toggleSelectedFile(option.value);
                        }}
                        disabled={isRunning}
                        className="flex items-center justify-between rounded-lg border px-2 py-1.5 text-left text-[10px] transition disabled:opacity-50"
                        style={{
                          borderColor: active ? "rgba(249,115,22,0.28)" : "var(--os-border-soft)",
                          background: active ? "color-mix(in srgb, #f97316 10%, var(--bg-elevated))" : "transparent",
                          color: active ? "#fdba74" : "var(--text-secondary)",
                        }}
                        title={option.value}
                      >
                        <span className="min-w-0 truncate font-mono">{option.label}</span>
                        <span className="ml-2 shrink-0 text-[9px]">{active ? "✓" : "+"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : wholeRepoReviewMode ? (
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  Findings from this review can still reference files anywhere in the repository.
                </p>
              ) : (
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  No file targets available for this repo.
                </p>
              )}
            </div>
            <input
              type="text"
              placeholder="Branch (e.g. main)"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isRunning}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            />
          </div>

          {/* Task */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Task</label>
            {!simpleMode && (
              <>
                <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
                  {(["playground", "dev", "prod"] as PromotionStage[]).map((stage) => {
                    const active = deliveryStage === stage;
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => handleStageSelect(stage)}
                        disabled={isRunning}
                        className="flex-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition disabled:opacity-50"
                        style={{
                          background: active ? "color-mix(in srgb, #f97316 14%, var(--bg-surface))" : "transparent",
                          color: active ? "#f97316" : "var(--text-muted)",
                        }}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  Playground runs write into an isolated mirror under <span className="font-mono">.run/playground</span>. Frontend preview is served on <span className="font-mono">localhost:3100</span>.
                </p>
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  Dev/Prod execute is locked. Promote from a successful playground run to apply changes upstream.
                </p>
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  Tip: Clicking <span className="font-mono">dev</span> or <span className="font-mono">prod</span> triggers promotion when gates are green.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[10px] text-[color:var(--text-muted)]">
                    Budget (USD)
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={budgetUsd}
                      onChange={(event) => setBudgetUsd(Number(event.target.value) || 0)}
                      disabled={isRunning}
                      className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2 py-1 text-xs disabled:opacity-50"
                      style={{ borderColor: "var(--os-border-soft)" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-[color:var(--text-muted)]">
                    Deadline (min)
                    <input
                      type="number"
                      min={5}
                      step={5}
                      value={deadlineMinutes}
                      onChange={(event) => setDeadlineMinutes(Math.max(5, Number(event.target.value) || 60))}
                      disabled={isRunning}
                      className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2 py-1 text-xs disabled:opacity-50"
                      style={{ borderColor: "var(--os-border-soft)" }}
                    />
                  </label>
                </div>
              </>
            )}
            <textarea
              rows={4}
              placeholder="Describe what the agent should do..."
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              disabled={isRunning}
              className="w-full resize-none rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs leading-relaxed placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            />
            {selectedSkill === "ux-ui-design" ? (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[color:var(--text-muted)]">
                  Design draft URL (Figma/Stitch) for pre-implementation approval
                </label>
                <input
                  type="url"
                  placeholder="https://figma.com/design/... or Stitch draft URL"
                  value={designDraftUrl}
                  onChange={(event) => setDesignDraftUrl(event.target.value)}
                  disabled={isRunning}
                  className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
                  style={{ borderColor: "var(--os-border-soft)" }}
                />
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  UX/UI skill uses a design-first gate: first approve draft, then execute patch.
                </p>
              </div>
            ) : null}
            {!simpleMode && (
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={contractMode}
                  onChange={(event) => setContractMode(event.target.value as "product_build" | "company_launch")}
                  disabled={isRunning || orchestratorRunning}
                  className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs disabled:opacity-50"
                  style={{ borderColor: "var(--os-border-soft)" }}
                >
                  <option value="product_build">Product Build</option>
                  <option value="company_launch">Company Launch</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const contract = buildExecutionContract();
                    setExecutionContract(contract);
                    setContractApproved(false);
                    setActionMsg(contract ? "Execution contract drafted. Review and approve." : "Define a task first.");
                  }}
                  disabled={!taskText.trim() || isRunning || orchestratorRunning}
                  className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                  style={{ borderColor: "rgba(56,189,248,0.28)", color: "#7dd3fc", background: "var(--bg-elevated)" }}
                >
                  Draft Contract
                </button>
              </div>
            )}
          </div>

          {!simpleMode && (<>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--text-secondary)]">
              <ImagePlus size={11} />
              Upload context
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.csv,.pdf"
              onChange={(event) => {
                void loadAttachments(event.target.files);
              }}
              disabled={isRunning}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
              className="flex items-center justify-center gap-2 rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-2 text-xs transition disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)" }}
            >
              <ImagePlus size={12} />
              Add screenshot or data
            </button>
            {attachments.length > 0 ? (
              <div className="flex flex-col gap-1">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between rounded-lg border px-2 py-1.5 text-[10px]"
                    style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                  >
                    <span className="min-w-0 truncate text-[color:var(--text-secondary)]" title={attachment.name}>
                      {attachment.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                      className="ml-2 shrink-0 text-[color:var(--text-muted)] transition hover:text-[color:var(--text-primary)]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[color:var(--text-muted)]">
                Screenshots and text/data files are sent into the Gemini run as multimodal context.
              </p>
            )}
          </div>

          {/* Skill selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Skill</label>
            <div className="flex flex-col gap-1">
              {(skills.length > 0
                ? skills
                : CODING_SKILLS
              ).map((skill) => {
                const Icon = SKILL_ICONS[skill.id] ?? Terminal;
                const active = selectedSkill === skill.id;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => setSelectedSkill(skill.id)}
                    disabled={isRunning}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-50"
                    style={{
                      background: active ? "color-mix(in srgb, #f97316 14%, var(--bg-elevated))" : "transparent",
                      color: active ? "#f97316" : "var(--text-secondary)",
                      border: `1px solid ${active ? "rgba(249,115,22,0.3)" : "transparent"}`,
                    }}
                  >
                    <Icon size={11} className="shrink-0" />
                    <span className="font-medium">{skill.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Provider</label>
            <div className="relative" data-code-provider-menu="true">
              <button
                type="button"
                onClick={() => setProviderDropOpen((o) => !o)}
                disabled={isRunning}
                className="flex w-full items-center justify-between rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs disabled:opacity-50"
                style={{ borderColor: "var(--os-border-soft)" }}
              >
                <span className="font-medium">
                  {selectedProvider === "auto"
                    ? `Auto (${currentProvider?.label ?? "role-based"})`
                    : currentProvider?.label ?? selectedProvider}
                </span>
                <ChevronDown size={10} className="text-[color:var(--text-muted)]" />
              </button>
              {providerDropOpen && (
                <div
                  className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border shadow-xl backdrop-blur-xl"
                  style={{ background: "var(--bg-elevated)", borderColor: "var(--os-border-soft)" }}
                >
                  <button
                    type="button"
                    onClick={() => { setSelectedProvider("auto"); setProviderDropOpen(false); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                  >
                    <span className="font-medium text-[color:var(--text-primary)]">Auto (role-based)</span>
                    <span className="text-sky-300 text-[10px]">recommended</span>
                  </button>
                  {providerEntries.length > 0 ? providerEntries.map(([id, st]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { setSelectedProvider(id); setProviderDropOpen(false); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-white/5 disabled:opacity-40"
                      disabled={!st.configured}
                    >
                      <span className="font-medium text-[color:var(--text-primary)]">{st.label}</span>
                      {st.configured
                        ? <span className="text-emerald-400 text-[10px]">ready</span>
                        : <span className="text-amber-400 text-[10px]">not configured</span>
                      }
                    </button>
                  )) : (
                    <div className="px-3 py-2 text-xs text-[color:var(--text-muted)]">Loading providers…</div>
                  )}
                </div>
              )}
            </div>
            {currentProvider && !currentProvider.configured && (
              <p className="text-[10px] text-amber-400">
                {currentProvider.issues?.[0] ?? "Provider not configured — fallback will be used."}
              </p>
            )}
            {currentProvider?.model ? (
              <p className="text-[10px] text-[color:var(--text-muted)]">{currentProvider.model}</p>
            ) : null}
          </div>

          {/* Reasoning toggle */}
          <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
            <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <Sparkles size={11} />
              Extended reasoning
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={effectiveUseReasoning}
              onClick={() => setUseReasoning((v) => !v)}
              disabled={isRunning || !reasoningSupported}
              className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${effectiveUseReasoning ? "bg-orange-500" : "bg-white/10"}`}
              style={{ width: 28, height: 16 }}
            >
              <span
                className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                style={{ left: effectiveUseReasoning ? 13 : 2 }}
              />
            </button>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Execution mode</label>
            <select
              value={executionMode}
              onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
              disabled={isRunning || orchestratorRunning}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            >
              <option value="adaptive">Adaptive (recommended)</option>
              <option value="strict">Strict AI only</option>
            </select>
            <p className="text-[10px] text-[color:var(--text-muted)]">
              {executionMode === "adaptive"
                ? "Adaptive mode keeps the run alive with safe fallbacks when Gemini/backbone is unstable."
                : "Strict mode blocks fallback and fails immediately if AI output/backbone is invalid."}
            </p>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
            <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <Sparkles size={11} />
              Vibe coding
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={vibeCoding}
              onClick={() => setVibeCoding((value) => !value)}
              disabled={isRunning || orchestratorRunning}
              className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${vibeCoding ? "bg-orange-500" : "bg-white/10"}`}
              style={{ width: 28, height: 16 }}
            >
              <span
                className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                style={{ left: vibeCoding ? 13 : 2 }}
              />
            </button>
          </label>
          <p className="text-[10px] text-[color:var(--text-muted)]">
            {vibeCoding
              ? "Auto-routes coding runs across Gemini, Codex(OpenAI), and Claude based on task + role."
              : "Provider routing follows your selected provider/role defaults only."}
          </p>

          <div className="rounded-lg border p-2" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[color:var(--text-secondary)]">Team orchestration</label>
              <select
                value={teamMode}
                onChange={(event) => setTeamMode(event.target.value as TeamMode)}
                disabled={isRunning || orchestratorRunning}
                className="rounded-md border bg-[color:var(--bg-surface)] px-2 py-1 text-[10px] uppercase tracking-[0.06em] disabled:opacity-50"
                style={{ borderColor: "var(--os-border-soft)" }}
              >
                <option value="auto">auto</option>
                <option value="manual">manual</option>
              </select>
            </div>
            {teamMode === "manual" ? (
              <div className="grid grid-cols-3 gap-1">
                {(["ui", "frontend", "backend", "infra", "qa", "general"] as AgentRole[]).map((role) => (
                  <label key={role} className="flex flex-col gap-1 text-[9px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                    {role}
                    <input
                      type="number"
                      min={0}
                      max={6}
                      step={1}
                      value={teamConfig[role]}
                      onChange={(event) =>
                        setTeamConfig((current) => ({
                          ...current,
                          [role]: Math.max(0, Math.min(6, Number(event.target.value) || 0)),
                        }))
                      }
                      disabled={isRunning || orchestratorRunning}
                      className="rounded-md border bg-[color:var(--bg-surface)] px-1.5 py-1 text-[10px] disabled:opacity-50"
                      style={{ borderColor: "var(--os-border-soft)" }}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[color:var(--text-muted)]">
                Auto planner derives team size from task complexity, budget, and deadline.
              </p>
            )}
            <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">Current plan: {teamPlanSummary}</p>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
            <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <GitBranch size={11} />
              Branch per agent
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={branchPerAgent}
              onClick={() => setBranchPerAgent((value) => !value)}
              disabled={isRunning || orchestratorRunning}
              className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${branchPerAgent ? "bg-orange-500" : "bg-white/10"}`}
              style={{ width: 28, height: 16 }}
            >
              <span
                className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                style={{ left: branchPerAgent ? 13 : 2 }}
              />
            </button>
          </label>
          {!reasoningSupported ? (
            <p className="text-[10px] text-[color:var(--text-muted)]">This provider does not support reasoning mode.</p>
          ) : null}

          <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
            <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <GitPullRequest size={11} />
              Auto-commit on success
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoCommit}
              onClick={() => setAutoCommit((value) => !value)}
              disabled={isRunning}
              className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${autoCommit ? "bg-orange-500" : "bg-white/10"}`}
              style={{ width: 28, height: 16 }}
            >
              <span
                className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                style={{ left: autoCommit ? 13 : 2 }}
              />
            </button>
          </label>
          <p className="text-[10px] text-[color:var(--text-muted)]">
            If enabled, successful verified changes are committed with an <span className="font-mono">elly(...)</span> message on a dedicated <span className="font-mono">codex/...</span> branch.
          </p>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
            <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <GitPullRequest size={11} />
              GitHub PR mode
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={githubMode}
              onClick={() => setGithubMode((v) => !v)}
              disabled={isRunning}
              className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${githubMode ? "bg-orange-500" : "bg-white/10"}`}
              style={{ width: 28, height: 16 }}
            >
              <span
                className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                style={{ left: githubMode ? 13 : 2 }}
              />
            </button>
          </label>
          <p className="text-[10px] text-[color:var(--text-muted)]">
            Apply diff via GitHub PR instead of local filesystem. Required when running from production. Auto-enabled on non-localhost.
          </p>

          {selectedSkill === "review-code" ? (
            <>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
                <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
                  <Search size={11} />
                  Include proposed fixes
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!suggestionsOnly}
                  onClick={() => setSuggestionsOnly((value) => !value)}
                  disabled={isRunning}
                  className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${!suggestionsOnly ? "bg-orange-500" : "bg-white/10"}`}
                  style={{ width: 28, height: 16 }}
                >
                  <span
                    className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                    style={{ left: !suggestionsOnly ? 13 : 2 }}
                  />
                </button>
              </label>
              <p className="text-[10px] text-[color:var(--text-muted)]">
                {suggestionsOnly
                  ? "Review-only mode returns prioritised findings, file targets, and next steps without a patch."
                  : "Review + Proposed Fixes returns the same findings plus a minimal diff for the highest-priority fixes."}
              </p>
            </>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Agent role</label>
            <select
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value as AgentRole)}
              disabled={isRunning || orchestratorRunning}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            >
              {AGENT_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
            <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <Terminal size={11} />
              Terminal mode (allowlist)
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={terminalAccess}
              onClick={() => setTerminalAccess((value) => !value)}
              disabled={isRunning || orchestratorRunning}
              className={`relative h-4.5 w-8 rounded-full transition-colors disabled:opacity-50 ${terminalAccess ? "bg-orange-500" : "bg-white/10"}`}
              style={{ width: 28, height: 16 }}
            >
              <span
                className="absolute top-0.5 block h-3 w-3 rounded-full bg-white shadow transition-transform"
                style={{ left: terminalAccess ? 13 : 2 }}
              />
            </button>
          </label>
          </>)}

          {/* Run button */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handlePlan}
              disabled={!canRun}
              className="flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: canRun ? "linear-gradient(135deg, #f97316, #ea580c)" : "var(--bg-elevated)",
                color: canRun ? "#fff" : "var(--text-muted)",
              }}
            >
              {isRunning && phase === "planning" ? (
                <><Loader2 size={13} className="animate-spin" /> Planning…</>
              ) : (
                <><Play size={13} /> Generate Plan</>
              )}
            </button>
            <button
              type="button"
              onClick={enqueueCurrentTask}
              disabled={!taskText.trim() || isRunning || orchestratorRunning}
              className="flex items-center justify-center gap-2 rounded-xl border py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)", background: "var(--bg-elevated)" }}
            >
              Queue Task
            </button>
          </div>
          {!simpleMode && (
          <button
            type="button"
            onClick={spawnDefaultTeam}
            disabled={!taskText.trim() || isRunning || orchestratorRunning}
            className="w-full rounded-lg border px-2.5 py-2 text-xs font-semibold transition disabled:opacity-40"
            style={{ borderColor: "rgba(56,189,248,0.28)", color: "#7dd3fc", background: "var(--bg-elevated)" }}
          >
            Spawn Team ({teamMode}): {teamPlanSummary}
          </button>
          )}

          {!simpleMode && (
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                Orchestrator
              </p>
              <span className="text-[10px] text-[color:var(--text-muted)]">Parallel workers</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={4}
                value={queueConcurrency}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setQueueConcurrency(Number.isFinite(next) ? Math.max(1, Math.min(4, next)) : 1);
                }}
                disabled={orchestratorRunning || isRunning}
                className="w-16 rounded-lg border bg-[color:var(--bg-surface)] px-2 py-1 text-xs disabled:opacity-50"
                style={{ borderColor: "var(--os-border-soft)" }}
              />
              <button
                type="button"
                onClick={() => void runOrchestratorQueue()}
                disabled={queuedTasks.length === 0 || orchestratorRunning || isRunning}
                className="flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:opacity-40"
                style={{ borderColor: "rgba(249,115,22,0.28)", color: "#f97316" }}
              >
                {orchestratorRunning ? "Running..." : "Run Queue"}
              </button>
              <button
                type="button"
                onClick={stopOrchestratorQueue}
                disabled={!orchestratorRunning}
                className="rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:opacity-40"
                style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)" }}
              >
                Stop
              </button>
            </div>
          </div>

          )}
          {!simpleMode && queuedTasks.length > 0 ? (
            <div className="rounded-lg border p-3 border-[rgba(255,255,255,0.08)] bg-[#1e1e1e] shadow-lg mt-2">
              <p className="mb-2 text-[11px] font-semibold text-[#d4d4d4]">
                Current Tasks ({queuedTasks.length})
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {queuedTasks.slice(0, 8).map((queued) => (
                  <div key={queued.id} className="group relative flex flex-col justify-center rounded-md border border-[rgba(255,255,255,0.04)] bg-[#252526] px-3 py-2 transition-colors hover:bg-[#2d2d2d]">
                    <div className="flex items-center gap-2">
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-[#333333]">
                        <Loader2 size={10} className="text-[#858585]" />
                      </div>
                      <p className="truncate text-[11px] font-medium text-[#cccccc]">{queued.task}</p>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#858585] pl-6">
                      <span className="capitalize">{queued.role} · {queued.skill}</span>
                      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => runQueuedTask(queued.id)}
                          disabled={isRunning}
                          className="font-medium text-[#4ec9b0] hover:text-[#5ce6c9]"
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQueuedTask(queued.id)}
                          disabled={isRunning}
                          className="font-medium hover:text-[#d4d4d4]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {phase !== "idle" && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isRunning}
              className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text-secondary)] disabled:opacity-40"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          )}
        </div>

        {/* Safety policy notice */}
        <div className="mt-auto border-t px-4 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
          <button
            type="button"
            onClick={() => setShowAllowlist((v) => !v)}
            className="flex w-full items-center justify-between text-[10px] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)] transition-colors"
          >
            <span className="flex items-center gap-1"><Shield size={9} /> Safety policy</span>
            <ChevronRight size={9} className={`transition-transform ${showAllowlist ? "rotate-90" : ""}`} />
          </button>
          {showAllowlist && (
            <div className="mt-2 flex flex-col gap-0.5">
              <p className="text-[9px] text-emerald-400">✓ Network disabled</p>
              <p className="text-[9px] text-emerald-400">✓ No auto-merge</p>
              <p className="text-[9px] text-emerald-400">
                ✓ {executionMode === "strict" ? "Strict AI mode (no patch fallback)" : "Adaptive mode (safe fallback enabled)"}
              </p>
              <p className="text-[9px] text-emerald-400">✓ Approval required for PR/delete</p>
              <p className="text-[9px] text-[color:var(--text-muted)] mt-1 font-medium">Allowed commands:</p>
              {(toolAllowlist.length > 0 ? toolAllowlist : []).slice(0, 8).map((t) => (
                <p key={t.cmd} className="text-[9px] text-[color:var(--text-muted)] font-mono">{t.cmd}</p>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Center panel: Phase stepper + content ──────────────────────────────── */}
      <div
        className="flex flex-1 flex-col overflow-hidden border-r"
        style={{ borderColor: "var(--os-border-soft)" }}
      >
        {/* Phase stepper */}
        <div
          className="flex items-center border-b px-5 py-3 gap-2"
          style={{ borderColor: "var(--os-border-soft)" }}
        >
          {PHASES.map((p, i) => {
            const done = i < phaseIndex;
            const active = i === phaseIndex;
            const running = active && isRunning;
            return (
              <div key={p.id} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                      done ? "bg-emerald-400/20 text-emerald-400"
                      : active ? "bg-orange-400/20 text-orange-400"
                      : "bg-white/5 text-[color:var(--text-muted)]"
                    }`}
                  >
                    {running ? <Loader2 size={10} className="animate-spin" /> : done ? <CheckCircle2 size={10} /> : i + 1}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      done ? "text-emerald-400"
                      : active ? "text-orange-400"
                      : "text-[color:var(--text-muted)]"
                    }`}
                  >
                    {p.label}
                  </span>
                </div>
                {i < PHASES.length - 1 && (
                  <ArrowRight size={10} className={done ? "text-emerald-400" : "text-[color:var(--text-muted)]"} />
                )}
              </div>
            );
          })}

          {phase === "error" && (
            <span className="ml-auto flex items-center gap-1 text-xs text-red-400">
              <XCircle size={12} /> Error
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div
          className="flex items-center gap-1 border-b px-4"
          style={{ borderColor: "var(--os-border-soft)" }}
        >
          {(["chat", "plan", "logs", "diff"] as CenterTab[]).map((tab) => {
            const icons: Record<CenterTab, typeof FileText> = {
              chat: MessageSquare, plan: FileText, logs: Terminal, diff: FileDiff,
            };
            const Icon = icons[tab];
            const active = centerTab === tab;
            if (tab === "chat" && active) {
              // Optionally we could rename it or handle it differently
            }
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setCenterTab(tab)}
                className="flex items-center gap-1.5 border-b-2 py-2 px-2 text-xs font-medium capitalize transition-colors"
                style={{
                  borderColor: active ? "#f97316" : "transparent",
                  color: active ? "#f97316" : "var(--text-secondary)",
                }}
              >
                <Icon size={11} />
                {tab}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Chat tab ── */}
          {centerTab === "chat" && (
            <div className="flex h-full min-h-[420px] flex-col gap-2">
              {/* ── Header bar ── */}
              <div className="flex items-center justify-between rounded-xl border px-3 py-2" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
                <div className="flex items-center gap-2 min-w-0">
                  {isRunning ? (
                    <>
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#4ec9b0" }} />
                        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#4ec9b0" }} />
                      </span>
                      <p className="text-xs font-semibold text-[#4ec9b0]">
                        {phase === "planning" ? "Planning…" : "Executing…"}
                      </p>
                    </>
                  ) : orchestratorRunning ? (
                    <>
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#f97316" }} />
                        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#f97316" }} />
                      </span>
                      <p className="text-xs font-semibold" style={{ color: "#fdba74" }}>
                        {orchestratorProgress
                          ? `Queue ${orchestratorProgress.completed}/${orchestratorProgress.total} · ${orchestratorProgress.status === "planning" ? "Planung…" : "Ausführung…"}`
                          : "Queue startet…"}
                      </p>
                    </>
                  ) : investigatorActivityFeed.length > 0 ? (
                    <>
                      <CheckCircle2 size={12} className="text-[#4ec9b0] shrink-0" />
                      <p className="text-xs font-semibold text-[color:var(--text-primary)]">Agent Trace</p>
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} className="text-[#c586c0] shrink-0" />
                      <p className="text-xs font-semibold text-[color:var(--text-primary)]">Elly Chat</p>
                    </>
                  )}
                  {/* Model badge — shows active model or post-run telemetry */}
                  {(isRunning || (investigatorActivityFeed.length > 0 && !orchestratorRunning)) && (() => {
                    const telModel = resultArtifact?.telemetry?.model;
                    const telProvider = resultArtifact?.telemetry?.provider;
                    const liveModel = currentProvider?.model;
                    const liveLabel = currentProvider?.label ?? effectiveProviderId;
                    const model = telModel ?? liveModel;
                    const label = telProvider ?? liveLabel;
                    if (!model && !label) return null;
                    const isVertex = String(label).includes("vertex") || String(label).includes("Vertex") || String(model).includes("gemini-2.5");
                    return (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono font-medium shrink-0"
                        style={{
                          background: isVertex ? "rgba(78,201,176,0.12)" : "rgba(86,156,214,0.12)",
                          color: isVertex ? "#4ec9b0" : "#569cd6",
                          border: `1px solid ${isVertex ? "rgba(78,201,176,0.25)" : "rgba(86,156,214,0.25)"}`,
                        }}>
                        {isVertex ? "⚡ " : "◆ "}
                        {model ?? label}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isRunning && (
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium"
                      style={{ borderColor: "rgba(249,115,22,0.3)", color: "#ea580c", background: "rgba(249,115,22,0.1)" }}>
                      <Sparkles size={9} />
                      Agentic Mode
                    </span>
                  )}
                  {!isRunning && investigatorActivityFeed.length > 0 && (
                    <span className="text-[10px] text-[#858585]">{investigatorActivityFeed.length} steps</span>
                  )}
                </div>
              </div>

              {/* ── Main content area ── */}
              <div className="flex-1 overflow-y-auto" style={{ background: "#1e1e1e", borderRadius: "0.75rem" }}>
                {/* Live agent trace — shown while running or after run (suppressed when orchestrator queue is active) */}
                {(isRunning || (investigatorActivityFeed.length > 0 && !orchestratorRunning)) ? (
                  <div className="p-2 space-y-1">
                    {isRunning && investigatorActivityFeed.length === 0 && (
                      <div className="flex items-center gap-2 px-3 py-4 text-[#858585]">
                        <Loader2 size={13} className="animate-spin" />
                        <span className="text-[11px] font-mono">Initialising agent…</span>
                      </div>
                    )}
                    {investigatorActivityFeed.map((entry, index) => {
                      const palette =
                        entry.kind === "thinking"
                          ? { icon: <Sparkles size={13} className="text-[#c586c0]" />, chip: "Thought", color: "#c586c0", bg: "rgba(197,134,192,0.07)" }
                          : entry.kind === "tool"
                            ? { icon: <CheckCircle2 size={13} className="text-[#4ec9b0]" />, chip: "Tool", color: "#4ec9b0", bg: "rgba(78,201,176,0.07)" }
                            : entry.kind === "status"
                              ? { icon: <CircleDot size={13} className="text-[#569cd6]" />, chip: "Runtime", color: "#569cd6", bg: "rgba(86,156,214,0.07)" }
                              : { icon: <ChevronRight size={13} className="text-[#858585]" />, chip: "Output", color: "#858585", bg: "transparent" };
                      const isLast = index === investigatorActivityFeed.length - 1;
                      // Use entry.id as key so the same Supabase event maps to the
                      // same DOM element across re-renders — the browser's native
                      // <details> toggle state is preserved. defaultOpen sets the
                      // initial open state on first mount only (uncontrolled after that).
                      const stableKey = entry.id ?? `${entry.kind}-${entry.title}`;
                      const defaultOpen = entry.kind === "thinking" || entry.kind === "tool" || isLast;
                      return (
                        <details
                          key={stableKey}
                          className="group overflow-hidden rounded-lg border"
                          style={{ borderColor: isLast && isRunning ? `${palette.color}44` : "rgba(255,255,255,0.06)", background: isLast && isRunning ? palette.bg : "#1e1e1e" }}
                          ref={(el) => { if (el && el.getAttribute("data-init") !== "1") { if (defaultOpen) el.open = true; el.setAttribute("data-init", "1"); } }}
                        >
                          <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[11px] font-mono text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
                            style={{ background: isLast && isRunning ? palette.bg : "#252526" }}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="shrink-0">{palette.icon}</span>
                              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                                style={{ color: palette.color, background: `${palette.color}18` }}>
                                {palette.chip}
                              </span>
                              <span className="truncate opacity-90">{entry.title}</span>
                              {isLast && isRunning && (
                                <Loader2 size={10} className="animate-spin shrink-0 opacity-60" style={{ color: palette.color }} />
                              )}
                            </div>
                            <ChevronDown size={11} className="shrink-0 opacity-40 transition-transform group-open:rotate-180" />
                          </summary>
                          {entry.detail && (
                            <div className="border-t px-3 py-2.5 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
                              style={{ borderColor: "rgba(255,255,255,0.04)", color: "#cecece", background: "#1a1a1a" }}>
                              {entry.detail}
                            </div>
                          )}
                        </details>
                      );
                    })}
                    {/* Review findings summary */}
                    {!isRunning && reviewFindings.length > 0 && (
                      <div className="rounded-lg border px-3 py-2 mt-1" style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)" }}>
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={12} className="mt-0.5 text-[#f14c4c] shrink-0" />
                          <div>
                            <p className="text-[11px] font-semibold text-[#d4d4d4]">Review abgeschlossen</p>
                            <p className="mt-0.5 text-[11px] text-[#858585]">
                              {reviewFindings.length} Findings — siehe Diff-Tab für Details.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                ) : orchestratorRunning ? (
                  /* Orchestrator queue live progress */
                  <div className="h-full flex flex-col gap-3 p-4">
                    {/* Progress header */}
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#f97316" }} />
                        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#f97316" }} />
                      </span>
                      <p className="text-xs font-semibold" style={{ color: "#fdba74" }}>Orchestrator läuft</p>
                      {orchestratorProgress && (
                        <span className="ml-auto text-[10px] font-mono" style={{ color: "#858585" }}>
                          {orchestratorProgress.completed}/{orchestratorProgress.total} abgeschlossen
                          {orchestratorProgress.failed > 0 && (
                            <span style={{ color: "#f87171" }}> · {orchestratorProgress.failed} fehlgeschlagen</span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    {orchestratorProgress && orchestratorProgress.total > 0 && (
                      <div className="rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.round(((orchestratorProgress.completed + orchestratorProgress.failed) / orchestratorProgress.total) * 100)}%`,
                            background: orchestratorProgress.failed > 0 ? "linear-gradient(to right, #f97316, #ef4444)" : "#f97316",
                          }}
                        />
                      </div>
                    )}

                    {/* Active task card */}
                    {orchestratorProgress ? (
                      <div className="rounded-xl border p-3" style={{ borderColor: "rgba(249,115,22,0.25)", background: "rgba(249,115,22,0.06)" }}>
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {(orchestratorProgress.status === "planning" || orchestratorProgress.status === "executing") && (
                              <Loader2 size={12} className="animate-spin" style={{ color: orchestratorProgress.status === "executing" ? "#4ec9b0" : "#fdba74" }} />
                            )}
                            {orchestratorProgress.status === "done" && <CheckCircle2 size={12} style={{ color: "#4ec9b0" }} />}
                            {orchestratorProgress.status === "failed" && <AlertTriangle size={12} style={{ color: "#f14c4c" }} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider rounded px-1 py-0.5"
                                style={{
                                  color: orchestratorProgress.status === "executing" ? "#4ec9b0" : orchestratorProgress.status === "done" ? "#4ec9b0" : orchestratorProgress.status === "failed" ? "#f14c4c" : "#fdba74",
                                  background: orchestratorProgress.status === "executing" ? "rgba(78,201,176,0.12)" : orchestratorProgress.status === "done" ? "rgba(78,201,176,0.12)" : orchestratorProgress.status === "failed" ? "rgba(241,76,76,0.12)" : "rgba(249,115,22,0.12)",
                                }}
                              >
                                {orchestratorProgress.status === "planning" ? "Planung" : orchestratorProgress.status === "executing" ? "Ausführung" : orchestratorProgress.status === "done" ? "Fertig" : "Fehler"}
                              </span>
                              <span className="text-[9px] font-mono" style={{ color: "#858585" }}>
                                Task {orchestratorProgress.index}/{orchestratorProgress.total}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed" style={{ color: "#d4d4d4", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {orchestratorProgress.activeTask}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2" style={{ color: "#858585" }}>
                        <Loader2 size={13} className="animate-spin" />
                        <span className="text-xs">Queue startet…</span>
                      </div>
                    )}

                    {/* Recent orchestrator logs */}
                    <div className="flex flex-col gap-1">
                      {logs.filter((l) => l.startsWith("Orchestrator")).slice(-4).map((log, i) => (
                        <div key={i} className="rounded-lg px-3 py-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <p className="text-[10px] font-mono leading-relaxed truncate" style={{ color: "#858585" }}>
                            {log.replace(/^Orchestrator:\s*/, "◆ ").replace(/^Orchestrator error/, "✗")}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Stop button */}
                    <div className="mt-auto pt-2">
                      <button
                        type="button"
                        onClick={stopOrchestratorQueue}
                        className="w-full rounded-lg border px-3 py-2 text-xs font-semibold transition hover:opacity-80"
                        style={{ borderColor: "rgba(239,68,68,0.3)", color: "#f87171", background: "rgba(239,68,68,0.05)" }}
                      >
                        ■ Queue stoppen
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Idle: Elly Chat */
                  <div className="h-full p-3">
                    {chatMessages.length === 0 ? (
                      <div className="flex h-full min-h-[240px] items-center justify-center text-center">
                        <div>
                          <p className="text-sm font-medium text-[#d4d4d4]">Hey, ich bin Elly 👋</p>
                          <p className="mt-1 text-xs text-[#858585]">
                            Deine Coding-Partnerin für Elyra. Frag mich was, starte einen Run — ich zeige dir live was ich mache und warum.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {chatMessages.map((message) => (
                          <div key={message.id} className="flex flex-col gap-1 w-full text-sm leading-relaxed">
                            <div className="flex items-center gap-2">
                              <span className={`flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold ${message.role === "user" ? "bg-[#007acc] text-white" : "bg-[#569cd6] text-white"}`}>
                                {message.role === "user" ? "U" : "E"}
                              </span>
                              <span className="font-semibold text-[#cccccc]">
                                {message.role === "user" ? "User" : "Elly"}
                              </span>
                            </div>
                            <div className="pl-7 pr-4 text-[#d4d4d4] whitespace-pre-wrap break-words font-sans">
                              {message.content}
                            </div>
                          </div>
                        ))}
                        {chatLoading && (
                          <div className="flex flex-col gap-1 w-full text-sm leading-relaxed">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold bg-[#569cd6] text-white">E</span>
                              <span className="font-semibold text-[#cccccc]">Elly</span>
                            </div>
                            <div className="pl-7 flex items-center gap-2 text-[#858585]">
                              <Loader2 size={13} className="animate-spin" />
                              <span className="text-xs">Thinking…</span>
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Plan tab ── */}
          {centerTab === "plan" && (
            <div className="flex flex-col gap-4">
              {executionContract ? (
                <div className="rounded-xl border p-3" style={{ borderColor: "rgba(56,189,248,0.28)", background: "color-mix(in srgb, #0ea5e9 6%, var(--bg-elevated))" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Execution Contract</p>
                  <p className="mt-1 text-xs text-[color:var(--text-primary)]">{executionContract.objective}</p>
                  <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
                    Mode: {executionContract.mode === "company_launch" ? "Company Launch" : "Product Build"} ·
                    Team slots: {executionContract.team.reduce((sum, row) => sum + row.count, 0)} ·
                    ETA: ~{executionContract.estimatedMinutes} min
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border p-2" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Team</p>
                      {executionContract.team.map((slot) => (
                        <p key={`${slot.role}-${slot.focus}`} className="mt-1 text-[10px] text-[color:var(--text-secondary)]">
                          {slot.count}x {slot.role} · {slot.focus}
                        </p>
                      ))}
                    </div>
                    <div className="rounded-lg border p-2" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Deliverables</p>
                      {executionContract.deliverables.map((item) => (
                        <p key={item.id} className="mt-1 text-[10px] text-[color:var(--text-secondary)]">
                          {item.label} ({item.ownerRole})
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        queueContractTeam(executionContract);
                        setContractApproved(true);
                      }}
                      disabled={isRunning || orchestratorRunning || contractApproved}
                      className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                      style={{ borderColor: "rgba(52,211,153,0.28)", color: "#6ee7b7", background: "var(--bg-elevated)" }}
                    >
                      {contractApproved ? "Contract Approved" : "Approve Contract"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runOrchestratorQueue()}
                      disabled={!contractApproved || queuedTasks.length === 0 || isRunning || orchestratorRunning}
                      className="rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                      style={{ borderColor: "rgba(249,115,22,0.28)", color: "#fdba74", background: "var(--bg-elevated)" }}
                    >
                      Launch Contract Team
                    </button>
                  </div>
                </div>
              ) : null}

              {phase === "idle" && (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <div className="rounded-2xl bg-orange-400/10 p-5">
                    <Code2 size={32} className="text-orange-400" />
                  </div>
                  <p className="text-sm font-semibold text-[color:var(--text-primary)]">Ready to code</p>
                  <p className="text-xs text-[color:var(--text-muted)] max-w-xs">
                    {selectedSkill === "review-code"
                      ? "Choose a repo and optional folder scope. Review mode returns concrete findings and direct next steps, then you can turn any finding into a new plan."
                      : "Enter a repo URL, describe your task, choose a skill, then click Generate Plan."}
                  </p>
                </div>
              )}

              {phase === "planning" && (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <Loader2 size={28} className="animate-spin text-orange-400" />
                  <p className="text-sm font-medium text-[color:var(--text-secondary)]">Generating plan…</p>
                </div>
              )}

              {phase === "error" && (
                <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4">
                  <div className="flex items-center gap-2 text-red-400 mb-2">
                    <AlertCircle size={14} />
                    <span className="text-sm font-semibold">Error</span>
                  </div>
                  <p className="text-xs text-[color:var(--text-secondary)]">{errorMsg}</p>
                </div>
              )}

              {hasPlan && planArtifact && planArtifact.plan && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border bg-[color:var(--bg-elevated)] p-3" style={{ borderColor: "var(--os-border-soft)" }}>
                    <p className="text-xs text-[color:var(--text-secondary)]">{planArtifact.plan?.summary}</p>
                    <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
                      ~{planArtifact.plan?.estimatedMinutes} min · {planArtifact.plan?.steps?.length ?? 0} steps
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    {(planArtifact.plan?.steps ?? []).map((step) => (
                      <div
                        key={step.step}
                        className="flex gap-3 rounded-xl border p-3"
                        style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-400/15 text-xs font-bold text-orange-400">
                          {step.step}
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <p className="text-xs font-semibold text-[color:var(--text-primary)]">{step.title}</p>
                          <p className="text-[10px] font-mono text-orange-400/70">{step.tool}</p>
                          <p className="text-[11px] text-[color:var(--text-muted)]">{step.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}



          {/* ── Logs tab ── */}
          {centerTab === "logs" && (
            <div className="flex flex-col gap-1 font-mono">
              {logs.length === 0 ? (
                <p className="text-xs text-[color:var(--text-muted)]">No logs yet. Run a task to see output.</p>
              ) : (
                logs.map((line, i) => (
                  <p key={i} className="text-[11px] leading-5 text-[color:var(--text-secondary)]">
                    {line}
                  </p>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          )}

          {/* ── Diff tab ── */}
          {centerTab === "diff" && (
            <div>
              {!hasResult ? (
                <p className="text-xs text-[color:var(--text-muted)]">
                  {phase === "done"
                    ? "Keine Änderungen — Datei oder Problem wurde nicht gefunden, oder wurde bereits behoben."
                    : selectedSkill === "review-code" && suggestionsOnly
                      ? "Review-only mode does not produce a patch diff."
                      : "Diff will appear here after execution."}
                </p>
              ) : (
                reviewFindings.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {reviewFindings.map((finding, index) => {
                      const priorityColor =
                        finding.priority === "P1"
                          ? "text-red-400"
                          : finding.priority === "P2"
                            ? "text-amber-400"
                            : "text-sky-400";
                      return (
                        <div
                          key={`${finding.title}-${index}`}
                          className="rounded-xl border p-3"
                          style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[color:var(--text-primary)]">{finding.title}</p>
                              <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${priorityColor}`}>
                                {finding.priority}
                              </p>
                              {finding.file ? (
                                <button
                                  type="button"
                                  onClick={() => focusFindingFile(finding.file!)}
                                  className="mt-1 truncate text-left text-[10px] font-mono text-sky-300 transition-colors hover:text-sky-200"
                                  title={`Scope review to ${finding.file}`}
                                >
                                  {finding.file}
                                </button>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  prepareFollowUpTask(
                                    `Fix this issue${finding.file ? ` in ${finding.file}` : ""}: ${finding.title}. Problem: ${finding.issue} Recommendation: ${finding.recommendation}`,
                                    "custom",
                                  )
                                }
                                className="rounded-lg border px-2 py-1 text-[10px] font-semibold text-orange-400 transition-colors hover:bg-orange-400/10"
                                style={{ borderColor: "rgba(249,115,22,0.28)" }}
                              >
                                Plan This Fix
                              </button>
                              <button
                                type="button"
                                onClick={() => sendFindingsToBuilder([finding])}
                                className="rounded-lg border px-2 py-1 text-[10px] font-semibold text-sky-300 transition-colors hover:bg-sky-400/10"
                                style={{ borderColor: "rgba(56,189,248,0.28)" }}
                              >
                                Send to Builder
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--text-secondary)]">{finding.issue}</p>
                          <p className="mt-2 text-[11px] leading-relaxed text-emerald-300">{finding.recommendation}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <DiffViewer diff={resultArtifact?.diff ?? ""} />
                )
              )}
            </div>
          )}


        </div>
      </div>

      {/* ── Right panel: Artifacts + Approval ──────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col overflow-y-auto">
        {/* Header */}
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--os-border-soft)" }}
        >
          <Gauge size={13} className="text-[color:var(--text-muted)] shrink-0" />
          <span className="text-xs font-semibold tracking-tight text-[color:var(--text-secondary)]">Artifacts & Actions</span>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-4">
          {/* Approval actions */}
          {canApprove && (
            <div className="rounded-xl border border-orange-400/30 bg-orange-400/5 p-3">
              <p className="text-xs font-semibold text-orange-300 mb-2">Plan ready for review</p>
              <p className="text-[10px] text-[color:var(--text-muted)] mb-3">
                Review the {planArtifact?.plan?.steps?.length ?? 0} steps above, then approve execution in the real coding agent.
              </p>
              <button
                type="button"
                onClick={() => void handleExecute({ designApproved: selectedSkill === "ux-ui-design" })}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
              >
                <Play size={11} />
                Approve & Execute
              </button>
            </div>
          )}

          {phase === "executing" && (
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-3">
              <div className="flex items-center gap-2 text-sky-400 mb-1">
                <Loader2 size={12} className="animate-spin" />
                <span className="text-xs font-semibold">
                  {terminalAccess ? "Executing with local terminal access…" : "Executing with managed apply flow…"}
                </span>
              </div>
              <p className="text-[10px] text-[color:var(--text-muted)]">
                {terminalAccess ? "Local repo tools active" : "Managed repo apply active"} · No auto-merge · Max 3 iterations
              </p>
            </div>
          )}

          {investigatorActivityFeed.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                Agent Trace
              </p>
              <div
                className="rounded-xl border p-2"
                style={{
                  borderColor: "rgba(255,255,255,0.08)",
                  background: "#1e1e1e",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <div>
                      <p className="text-[11px] font-semibold text-[#d4d4d4]">Elly Streaming Thoughts</p>
                      <p className="text-[10px] text-[#858585]">Real-time execution trace simulating Elly thought blocks.</p>
                    </div>
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium"
                    style={{ borderColor: "rgba(249,115,22,0.3)", color: "#ea580c", background: "rgba(249,115,22,0.1)" }}
                  >
                    <Sparkles size={10} />
                    Agentic Mode
                  </span>
                </div>
                <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                  {investigatorActivityFeed.map((entry, index) => {
                    const palette =
                      entry.kind === "thinking"
                        ? { icon: <Sparkles size={12} className="text-[#c586c0]" />, chip: "Thought", color: "#c586c0" }
                        : entry.kind === "tool"
                          ? { icon: <CheckCircle2 size={12} className="text-[#4ec9b0]" />, chip: "Tool Call", color: "#4ec9b0" }
                          : entry.kind === "status"
                            ? { icon: <CircleDot size={12} className="text-[#569cd6]" />, chip: "Runtime", color: "#569cd6" }
                            : { icon: <ChevronRight size={12} className="text-[#858585]" />, chip: "Output", color: "#858585" };
                    const stableKey2 = entry.id ?? `${entry.kind}-${entry.title}`;
                    const defaultOpen2 = entry.kind === "thinking" || entry.kind === "tool" || index === investigatorActivityFeed.length - 1;
                    return (
                      <details
                        key={stableKey2}
                        className="group overflow-hidden rounded-md border border-[rgba(255,255,255,0.06)] bg-[#1e1e1e]"
                        ref={(el) => { if (el && el.getAttribute("data-init") !== "1") { if (defaultOpen2) el.open = true; el.setAttribute("data-init", "1"); } }}
                      >
                        <summary className="flex cursor-pointer select-none items-center justify-between bg-[#252526] px-2.5 py-1.5 text-[11px] font-mono text-[#d4d4d4] hover:bg-[#2d2d2d] transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="opacity-90">{palette.icon}</span>
                            <span className="font-semibold" style={{ color: palette.color }}>[{palette.chip}]</span>
                            <span className="truncate opacity-90">{entry.title}</span>
                          </div>
                          <ChevronDown size={12} className="opacity-50 transition-transform group-open:rotate-180" />
                        </summary>
                        {entry.detail && (
                          <div className="border-t border-[rgba(255,255,255,0.04)] bg-[#1e1e1e] p-2.5 text-[11px] font-mono leading-relaxed text-[#cecece] whitespace-pre-wrap">
                            {entry.detail}
                          </div>
                        )}
                      </details>
                    );
                  })}
                  {!isRunning && reviewFindings.length > 0 ? (
                    <div className="rounded-md border px-3 py-2 mt-2" style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)" }}>
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={12} className="mt-0.5 text-[#f14c4c]" />
                        <div>
                          <p className="text-[11px] font-semibold text-[#d4d4d4]">Review completed</p>
                          <p className="mt-1 text-[11px] leading-5 text-[#858585]">
                            {reviewFindings.length} prioritized findings extracted from the repository investigation.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Result summary */}
          {hasResult && resultArtifact && (
            <>
              {resultArtifact.missionBrief ? (
                <div className="rounded-xl border p-3" style={{ borderColor: "rgba(56,189,248,0.28)", background: "color-mix(in srgb, #0ea5e9 6%, var(--bg-elevated))" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">Mission Brief</p>
                  <p className="mt-1 text-[11px] text-[color:var(--text-primary)]">{resultArtifact.missionBrief.objective}</p>
                  <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
                    Stage {resultArtifact.missionBrief.stage.toUpperCase()} · Budget ${resultArtifact.missionBrief.budgetUsd ?? 0} · Deadline {resultArtifact.missionBrief.deadlineMinutes ?? 0}m
                  </p>
                  <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
                    Supervisor team: {resultArtifact.missionBrief.supervisorPlan.totalAgents} agents
                  </p>
                </div>
              ) : null}
              {resultArtifact.designDraft?.url ? (
                <div
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: resultArtifact.designDraft.approved ? "rgba(52,211,153,0.3)" : "rgba(251,191,36,0.35)",
                    background: resultArtifact.designDraft.approved
                      ? "color-mix(in srgb, #10b981 7%, var(--bg-elevated))"
                      : "color-mix(in srgb, #f59e0b 8%, var(--bg-elevated))",
                  }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-secondary)]">
                    Design Draft
                  </p>
                  <p className="mt-1 text-[11px] text-[color:var(--text-primary)]">
                    {resultArtifact.designDraft.provider === "google_stitch"
                      ? "Google Stitch"
                      : resultArtifact.designDraft.provider === "banana2"
                        ? "Banana"
                        : "Figma"} ·{" "}
                    {resultArtifact.designDraft.approved ? "Approved" : "Pending approval"}
                  </p>
                  <a
                    href={resultArtifact.designDraft.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-[10px] text-sky-300 underline"
                    title={resultArtifact.designDraft.url}
                  >
                    {resultArtifact.designDraft.url}
                  </a>
                </div>
              ) : null}

              <div className="rounded-xl border bg-[color:var(--bg-elevated)] p-3" style={{ borderColor: "var(--os-border-soft)" }}>
                <div className="flex items-center gap-2 mb-2">
                  {(resultArtifact.workflow?.current === "promoted" || (resultArtifact.buildReport?.success && resultArtifact.executionApplied))
                    ? <CheckCircle2 size={13} className="text-emerald-400" />
                    : <AlertTriangle size={13} className="text-amber-400" />
                  }
                  <span className="text-xs font-semibold text-[color:var(--text-primary)]">
                    {reviewFindings.length > 0
                      ? "Review complete"
                      : resultArtifact.workflow?.current === "promoted"
                        ? "Verified result"
                        : resultArtifact.workflow?.current === "rolled_back"
                          ? "Rolled back after verification"
                          : resultArtifact.buildReport?.success && resultArtifact.executionApplied
                            ? "Build passed"
                            : "Build issues"}
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[11px] text-[color:var(--text-muted)] leading-relaxed">
                  {resultArtifact.summary}
                </div>
                {ghPrUrl ? (
                  <a
                    href={ghPrUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-300 hover:bg-fuchsia-500/20 transition-colors"
                  >
                    🔀 Open Pull Request on GitHub
                  </a>
                ) : null}
              </div>

              {resultArtifact.workflow ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Execution Workflow</p>
                  <div
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[color:var(--text-primary)]">Current state</span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${
                          resultArtifact.workflow.current === "promoted"
                            ? "text-emerald-400"
                            : resultArtifact.workflow.current === "rolled_back"
                              ? "text-amber-300"
                              : resultArtifact.workflow.current === "failed"
                                ? "text-red-400"
                                : "text-[color:var(--text-secondary)]"
                        }`}
                      >
                        {resultArtifact.workflow.current.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                      {resultArtifact.workflow.history.map((entry, index) => (
                        <div
                          key={`${entry.state}-${entry.at}-${index}`}
                          className="rounded-lg border px-2.5 py-2"
                          style={{ borderColor: "var(--os-border-soft)" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-primary)]">
                              {entry.state.replaceAll("_", " ")}
                            </span>
                            <span className="text-[10px] text-[color:var(--text-muted)]">
                              {new Date(entry.at).toLocaleTimeString()}
                            </span>
                          </div>
                          {entry.note ? (
                            <p className="mt-1 text-[10px] leading-relaxed text-[color:var(--text-secondary)]">{entry.note}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {!isReviewOnlyResult && Array.isArray(resultArtifact.gates) && resultArtifact.gates.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Quality Gates</p>
                  {resultArtifact.gates.map((gate) => (
                    <div
                      key={gate.gate}
                      className="rounded-lg border px-2.5 py-2"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[color:var(--text-primary)]">{gate.gate}</span>
                        <span
                          className={`text-[10px] font-semibold ${
                            gate.status === "passed" ? "text-emerald-400" : gate.status === "failed" ? "text-red-400" : "text-amber-300"
                          }`}
                        >
                          {gate.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">Attempts: {gate.attempts}{gate.command ? ` · ${gate.command}` : ""}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {resultArtifact.telemetry ? (
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Observability</p>
                  <p className="mt-1 text-[10px] text-[color:var(--text-secondary)]">Provider: {resultArtifact.telemetry.provider} · {resultArtifact.telemetry.model}</p>
                  {typeof resultArtifact.telemetry.estimatedInputTokens === "number" ? (
                    <p className="text-[10px] text-[color:var(--text-secondary)]">
                      Input budget: {resultArtifact.telemetry.estimatedInputTokens}
                      {typeof resultArtifact.telemetry.modelInputLimit === "number" ? ` / ${resultArtifact.telemetry.modelInputLimit}` : ""} tokens
                      {resultArtifact.telemetry.contextCompressionMode ? ` · ${resultArtifact.telemetry.contextCompressionMode} context` : ""}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-[color:var(--text-secondary)]">
                    Tokens: {resultArtifact.telemetry.estimatedTokens ?? "n/a"} · Cost: $
                    {typeof resultArtifact.telemetry.estimatedCostUsd === "number"
                      ? resultArtifact.telemetry.estimatedCostUsd.toFixed(4)
                      : "n/a"}
                  </p>
                  {resultArtifact.telemetry.budgetStatus ? (
                    <p className="text-[10px] text-[color:var(--text-secondary)]">
                      Budget status: {resultArtifact.telemetry.budgetStatus}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-[color:var(--text-muted)]">Replay ID: {resultArtifact.telemetry.replayId}</p>
                </div>
              ) : null}

              {Array.isArray(resultArtifact.artifacts) && resultArtifact.artifacts.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Artifacts</p>
                  {resultArtifact.artifacts.map((artifact) => (
                    <div
                      key={artifact.id}
                      className="rounded-lg border px-2.5 py-2"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      <p className="text-[11px] font-semibold text-[color:var(--text-primary)]">{artifact.title}</p>
                      <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
                        {artifact.type} · v{artifact.version}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {reviewFindings.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Findings
                  </p>
                  {reviewFindings.map((finding, index) => (
                    <div
                      key={`${finding.title}-side-${index}`}
                      className="rounded-lg border px-2.5 py-2"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      <p className="text-[11px] font-semibold text-[color:var(--text-primary)]">{finding.title}</p>
                      <p className="mt-1 text-[10px] text-[color:var(--text-muted)]">
                        {finding.file ? `${finding.file} · ` : ""}{finding.priority}
                      </p>
                    </div>
                  ))}
                  {/* Primary action: queue findings directly as individual tasks */}
                  <button
                    type="button"
                    onClick={() => queueAllFindings(reviewFindings)}
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors hover:bg-orange-400/10"
                    style={{ borderColor: "rgba(249,115,22,0.35)", color: "#fb923c" }}
                  >
                    ▶ Queue All in Coder
                  </button>
                  {/* Secondary action: send to Builder for workflow view */}
                  <button
                    type="button"
                    onClick={() => sendFindingsToBuilder(reviewFindings)}
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-400/10"
                    style={{ borderColor: "rgba(56,189,248,0.28)" }}
                  >
                    Send All to Builder
                  </button>
                </div>
              )}

              {reviewNextSteps.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Next Steps
                  </p>
                  {reviewNextSteps.map((step, index) => (
                    <button
                      key={`${step}-${index}`}
                      type="button"
                      onClick={() => prepareFollowUpTask(step, "custom")}
                      className="rounded-lg border px-2.5 py-2 text-left text-[11px] text-[color:var(--text-secondary)] transition-colors hover:bg-white/5"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      {step}
                    </button>
                  ))}
                </div>
              )}

              {!isReviewOnlyResult && resultArtifact.previewUrl ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Live Preview
                  </p>
                  <div
                    className="rounded-lg border px-2.5 py-2 text-[10px]"
                    style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                  >
                    <p className="font-semibold text-[color:var(--text-primary)]">Preview truth</p>
                    <p className="mt-1 text-[color:var(--text-secondary)]">
                      Build: {resultArtifact.buildReport?.success ? "verified" : "failed"} · Apply:{" "}
                      {resultArtifact.executionApplied ? "kept" : resultArtifact.workflow?.current === "rolled_back" ? "discarded" : "not applied"}
                    </p>
                    <p className="mt-1 text-[color:var(--text-muted)]">
                      Preview URL points to the currently published local stage.
                    </p>
                  </div>
                  <a
                    href={resultArtifact.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/10"
                    style={{ borderColor: "rgba(52,211,153,0.28)" }}
                  >
                    Open localhost preview
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowPreviewPanel((value) => !value)}
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-400/10"
                    style={{ borderColor: "rgba(56,189,248,0.28)" }}
                  >
                    {showPreviewPanel ? "Hide embedded preview" : "Show embedded preview"}
                  </button>
                  {showPreviewPanel ? (
                    <div
                      className="overflow-hidden rounded-lg border"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      <iframe
                        src={resultArtifact.previewUrl}
                        title="Localhost preview"
                        className="h-56 w-full bg-white"
                      />
                    </div>
                  ) : null}
                  {resultArtifact.commitOutput ? (
                    <pre
                      className="rounded-lg border p-2 text-[10px] font-mono text-[color:var(--text-secondary)] overflow-x-auto"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      {resultArtifact.commitOutput}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  Promotion Pipeline
                </p>
                <div
                  className="rounded-lg border px-2.5 py-2 text-[11px]"
                  style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                >
                  <span className="font-semibold text-[color:var(--text-primary)]">Current stage:</span>{" "}
                  <span className="uppercase tracking-[0.06em] text-orange-300">{deliveryStage}</span>
                </div>
                {deliveryStage === "playground" ? (
                  <button
                    type="button"
                    onClick={() => void promoteRun("dev")}
                    disabled={!canPromoteToDev}
                    title={!canPromoteToDev ? (promoteBlockedReason ?? "Promotion is currently unavailable.") : undefined}
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                    style={{ borderColor: "rgba(56,189,248,0.28)" }}
                  >
                    Promote to Dev
                  </button>
                ) : null}
                {deliveryStage === "dev" ? (
                  <button
                    type="button"
                    onClick={() => void promoteRun("prod")}
                    disabled={!canPromoteToProd}
                    title={!canPromoteToProd ? (promoteBlockedReason ?? "Promotion is currently unavailable.") : undefined}
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                    style={{ borderColor: "rgba(52,211,153,0.28)" }}
                  >
                    Promote to Prod
                  </button>
                ) : null}
                {promoteBlockedReason ? (
                  <p className="text-[10px] text-[color:var(--text-muted)]">
                    {promoteBlockedReason}
                  </p>
                ) : null}
                {canPromoteToMain ? (
                  <button
                    type="button"
                    onClick={() => void promoteToMainBranch()}
                    disabled={promotingMain}
                    className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold text-fuchsia-300 transition-colors hover:bg-fuchsia-400/10 disabled:opacity-60"
                    style={{ borderColor: "rgba(217,70,239,0.28)" }}
                  >
                    {promotingMain ? "Pushing..." : "Promote to Main (PR)"}
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Promotion Status
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadPromotionAudit()}
                    className="rounded-md border px-2 py-1 text-[10px] font-semibold text-[color:var(--text-secondary)] transition-colors hover:bg-white/5"
                    style={{ borderColor: "var(--os-border-soft)" }}
                    disabled={auditLoading}
                  >
                    {auditLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>
                {promotionAudit.length === 0 ? (
                  <p className="text-[10px] text-[color:var(--text-muted)]">No promotion audit records yet.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5">
                    {promotionAudit.slice(0, 8).map((record) => (
                      <div
                        key={record.id}
                        className="rounded-lg border px-2 py-1.5"
                        style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold text-[color:var(--text-primary)]">
                            {record.fromStage} → {record.toStage}
                          </span>
                          <span
                            className={`text-[9px] font-semibold uppercase ${
                              record.status === "completed" ? "text-emerald-400" : record.status === "failed" ? "text-red-400" : "text-amber-300"
                            }`}
                          >
                            {record.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[9px] text-[color:var(--text-muted)]">{new Date(record.createdAt).toLocaleString()}</p>
                        {record.summary ? (
                          <p className="mt-1 line-clamp-2 text-[10px] text-[color:var(--text-secondary)]">{record.summary}</p>
                        ) : null}
                        {record.prUrl ? (
                          <a
                            href={record.prUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-[10px] font-semibold text-fuchsia-300"
                          >
                            Open PR
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {deliveryStage === "playground" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                      Playground Versions
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void snapshotPlaygroundNow()}
                        className="rounded-md border px-2 py-1 text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/10"
                        style={{ borderColor: "rgba(52,211,153,0.28)" }}
                        disabled={versionsLoading}
                      >
                        Snapshot now
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadPlaygroundVersions()}
                        className="rounded-md border px-2 py-1 text-[10px] font-semibold text-[color:var(--text-secondary)] transition-colors hover:bg-white/5"
                        style={{ borderColor: "var(--os-border-soft)" }}
                        disabled={versionsLoading}
                      >
                        {versionsLoading ? "Loading..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  {playgroundHead ? (
                    <p className="text-[10px] text-[color:var(--text-muted)]">
                      Head: <span className="font-mono text-[color:var(--text-secondary)]">{playgroundHead}</span>
                    </p>
                  ) : null}
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {playgroundVersions.length === 0 ? (
                      <p className="text-[10px] text-[color:var(--text-muted)]">No playground snapshots yet.</p>
                    ) : (
                      playgroundVersions.map((version) => (
                        <div
                          key={version.commit}
                          className="rounded-lg border px-2 py-1.5"
                          style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-[color:var(--text-secondary)]">{version.commit}</span>
                            <button
                              type="button"
                              onClick={() => void rollbackPlaygroundTo(version.commit)}
                              className="rounded-md border px-1.5 py-0.5 text-[9px] font-semibold text-amber-300 transition-colors hover:bg-amber-400/10 disabled:opacity-60"
                              style={{ borderColor: "rgba(251,191,36,0.28)" }}
                              disabled={Boolean(rollbackCommit)}
                            >
                              {rollbackCommit === version.commit ? "Rolling..." : "Rollback"}
                            </button>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[10px] text-[color:var(--text-muted)]">{version.message}</p>
                          <p className="text-[9px] text-[color:var(--text-muted)]">{new Date(version.timestamp).toLocaleString()}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {/* Files changed */}
              {has(resultArtifact.filesChanged) && resultArtifact.filesChanged.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Files changed
                  </p>
                  {resultArtifact.filesChanged.map((f) => (
                    <div
                      key={f.path}
                      className="flex items-center justify-between rounded-lg border px-2.5 py-1.5"
                      style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
                    >
                      <span className="truncate text-[11px] font-mono text-[color:var(--text-secondary)]" title={f.path}>
                        {f.path.split("/").pop()}
                      </span>
                      <span className="ml-2 shrink-0 text-[10px]">
                        <span className="text-emerald-400">+{f.linesAdded}</span>
                        {" "}
                        <span className="text-red-400">-{f.linesRemoved}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Approval actions */}
              {resultArtifact.requiresApproval && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                    Actions
                  </p>
                  {resultArtifact.approvalActions?.includes("approve-design") && (
                    <button
                      type="button"
                      onClick={() => void handleExecute({ designApproved: true })}
                      className="flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold text-violet-300 transition-colors hover:bg-violet-400/10"
                      style={{ borderColor: "rgba(167,139,250,0.35)" }}
                    >
                      <CheckCircle2 size={11} />
                      Approve Design & Execute
                    </button>
                  )}
                  {resultArtifact.approvalActions?.includes("apply-patch") && (
                    <button
                      type="button"
                      onClick={() => void copyText(resultArtifact.diff ?? "", "Diff copied to clipboard.")}
                      className="flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-400/10"
                      style={{ borderColor: "rgba(52,211,153,0.3)" }}
                      disabled={!patchActionsSupported}
                    >
                      <CheckCircle2 size={11} />
                      {patchActionsSupported ? "Copy Patch" : "Patch Unsupported"}
                    </button>
                  )}
                  {resultArtifact.approvalActions?.includes("create-pr") && (
                    <button
                      type="button"
                      onClick={() => void copyText([summaryText, fileListText, resultArtifact.diff ?? ""].filter(Boolean).join("\n\n"), "PR summary copied to clipboard.")}
                      className="flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold text-sky-400 transition-colors hover:bg-sky-400/10"
                      style={{ borderColor: "rgba(56,189,248,0.3)" }}
                    >
                      <GitPullRequest size={11} />
                      Copy PR Summary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold text-[color:var(--text-muted)] transition-colors hover:bg-white/5"
                    style={{ borderColor: "var(--os-border-soft)" }}
                  >
                    <RotateCcw size={11} />
                    Revert & Retry
                  </button>
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!hasPlan && !hasResult && phase === "idle" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <CircleDot size={24} className="text-[color:var(--text-muted)]" />
              <p className="text-xs text-[color:var(--text-muted)]">No artifacts yet</p>
            </div>
          )}

          {/* Safety pill */}
          <div className="mt-auto">
            <div
              className="rounded-lg border px-3 py-2 flex items-center gap-2"
              style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
            >
              <Shield size={11} className="text-emerald-400 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <p className="text-[10px] font-semibold text-emerald-400">
                  {terminalAccess ? "Terminal access enabled" : "Managed apply mode"}
                </p>
                <p className="text-[9px] text-[color:var(--text-muted)]">
                  {terminalAccess ? "Local tools · Git actions allowed by run settings" : "No direct terminal access"}
                </p>
              </div>
            </div>
            {actionMsg ? (
              <p className="mt-2 text-[10px] text-[color:var(--text-muted)]">{actionMsg}</p>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
