import http, { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { getGitStatusPorcelain, ensureCleanGitWorkingTree } from "./gitService";
import { createLogger } from "./logger";
import { runSession, SessionRunResult } from "./sessionRunner";
import { runDevTask, runSingleFileEditTask } from "./devTaskRunner";
import {
  DevTask,
  DevTaskResult,
  ApplyMode,
  WriteMode,
  SafetyLevel,
  DeployConfig,
  DeployRunResult,
  GitOptions,
  PreApplyCheckConfig,
  RepoOverview,
  PlannedSessionConfig,
  PlannedSessionDefaults,
  SingleEditTaskResult,
  DevPlanResult,
} from "./devTaskTypes";
import { runDeployConfig } from "./deployService";
import { listBackups, restoreBackup } from "./rollbackService";
import { listProjectFiles, searchInFiles, listFiles, readFileSafe } from "./fsService";
import { planDevSession } from "./llmService";
import { runDevPlan } from "./planRunner";
import { generatePlanFromDescription } from "./llmService";
import { validatePlanStructure } from "./plans/planValidator";
import { analyzeProject } from "./analyzer/analyzerService";
import { runReasoningEngine } from "./reasoning/reasoningEngine";
import { runFeature } from "./features/featureOrchestrator";
import { runDevLoop } from "./devLoop";
import { promises as fsPromises } from "node:fs";
import { runChecks } from "./commandRunner";
import { getProjectGraph, searchProjectGraph } from "./projectGraph";
import { generatePlan } from "./planner";
import { materializePlanToTasksAndSession } from "./autoTasks";

interface StatusResponse {
  ok: boolean;
  projectRoot: string;
  workerVersion: string;
  git: {
    clean: boolean;
    statusSummary: string;
    error?: string;
  };
}

interface RunSessionRequest {
  configPath: string;
  allowDirty?: boolean;
  applyMode?: ApplyMode;
  writeMode?: WriteMode;
  previewOnly?: boolean;
  safetyLevel?: SafetyLevel;
  withChecks?: boolean;
  git?: GitOptions;
  preApplyChecks?: PreApplyCheckConfig;
  maxTasks?: number;
  incidentWebhook?: import("./devTaskTypes").IncidentWebhookConfig;
}

interface RunSessionResponse {
  ok: boolean;
  sessionResult?: SessionRunResult;
  startedAt?: string;
  finishedAt?: string;
  sessionId?: string;
  results?: Array<{ id: string; status: string }>;
  logFile?: string;
  applyMode?: ApplyMode;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
  overallRiskLevel?: import("./devTaskTypes").RiskLevel;
  overallRiskReason?: string;
  blocked?: boolean;
  blockedReason?: string;
  reportFile?: string;
  error?: ApiError | string;
}

interface RunTaskRequest {
  taskConfig?: DevTask;
  taskFile?: string;
  allowDirty?: boolean;
}

interface RunTaskResponse {
  ok: boolean;
  taskResult?: DevTaskResult;
  startedAt?: string;
  finishedAt?: string;
  error?: ApiError;
}

interface RunSingleEditRequest {
  file: string;
  goal: string;
  projectRoot?: string;
  mode?: import("./devTaskTypes").DevTaskMode;
  writeMode?: import("./devTaskTypes").EditRunMode;
  safetyLevel?: import("./devTaskTypes").EditSafetyLevel;
  allowDirty?: boolean;
}

interface RunSingleEditResponse {
  ok: boolean;
  result?: import("./devTaskTypes").SingleEditTaskResult;
  error?: ApiError | { message: string };
}

interface ApiError {
  message: string;
  code: string;
  stack?: string;
  details?: unknown;
}

interface DeployRunRequest {
  config: DeployConfig;
  dryRun?: boolean;
}

interface DeployRunResponse {
  ok: boolean;
  dryRun: boolean;
  result?: DeployRunResult;
  error?: ApiError | { message: string };
}

interface BackupListResponse {
  ok: boolean;
  backups?: Awaited<ReturnType<typeof listBackups>>;
  error?: ApiError | { message: string };
}

interface BackupRestoreRequest {
  backupId: string;
  dryRun?: boolean;
}

interface BackupRestoreResponse {
  ok: boolean;
  backupId?: string;
  restoredFiles?: string[];
  dryRun?: boolean;
  error?: ApiError | { message: string };
}

interface ProjectTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: ProjectTreeNode[];
}

interface ProjectTreeResponse {
  ok: boolean;
  tree?: ProjectTreeNode[];
  error?: ApiError | { message: string };
}

interface ProjectSearchRequest {
  pattern: string;
  roots?: string[];
  caseSensitive?: boolean;
}

interface ProjectSearchResponse {
  ok: boolean;
  hits?: import("./fsService").SearchMatch[];
  total?: number;
  error?: ApiError | { message: string };
}

interface DraftSessionRequest {
  goal: string;
  projectRoot?: string;
  defaults?: PlannedSessionDefaults;
}

interface DraftSessionResponse {
  ok: boolean;
  session?: PlannedSessionConfig;
  meta?: { usedFiles: string[]; generatedAt: string };
  error?: ApiError | { message: string };
}

interface FsListResponse {
  ok: boolean;
  files?: string[];
  error?: ApiError | { message: string };
}

interface FsReadResponse {
  ok: boolean;
  file?: string;
  content?: string;
  error?: ApiError | { message: string };
}

interface FsSearchResponse {
  ok: boolean;
  hits?: import("./fsService").SearchMatch[];
  total?: number;
  error?: ApiError | { message: string };
}

interface RunChecksRequest {
  checks: string[];
}

interface RunChecksResponse {
  ok: boolean;
  checks?: Array<import("./commandRunner").CommandResult & { name?: string }>;
  error?: ApiError | { message: string };
}

interface RunPlanRequest {
  planConfigPath: string;
  writeMode?: ApplyMode;
  safetyLevel?: SafetyLevel;
  git?: GitOptions;
}

interface RunPlanResponse {
  ok: boolean;
  planResult?: DevPlanResult;
  error?: ApiError | { message: string };
}

interface PlanListItem {
  id: string;
  label?: string;
  steps?: Array<{ type: string; id?: string; label?: string }>;
  configPath: string;
}

interface PlanListResponse {
  ok: boolean;
  plans?: PlanListItem[];
  error?: ApiError | { message: string };
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const log = createLogger("ElyraAgent");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 5050;
const PORT = Number(process.env.ELYRA_AGENT_PORT || DEFAULT_PORT);
const AUTH_TOKEN = process.env.ELYRA_AGENT_TOKEN;
const WORKER_VERSION = "0.1.0";
const SESSION_CONFIG_MAP: Record<string, string> = {};
const SESSION_LOG_DIR = path.resolve(REPO_ROOT, "worker", "logs", "sessions");
let isSessionRunning = false;
const recentSessions: Array<{
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  status?: string;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
}> = [];

if (Number.isNaN(PORT) || PORT <= 0) {
  throw new Error("Invalid ELYRA_AGENT_PORT");
}

if (AUTH_TOKEN) {
  log.info("Agent authentication enabled (ELYRA_AGENT_TOKEN set)");
} else {
  log.warn("Agent läuft ohne Authentifizierung (ELYRA_AGENT_TOKEN nicht gesetzt)");
}

log.info("Project endpoints enabled: GET /project/tree, POST /project/search");

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-elyra-agent-token, x-elyra-token"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res: ServerResponse, statusCode: number, payload: object): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, { ok: false, error: "unauthorized" });
}

function resolveFromRepoRoot(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(REPO_ROOT, targetPath);
}

function resolveProjectRoot(projectRoot?: string): string {
  if (!projectRoot || typeof projectRoot !== "string" || projectRoot.trim().length === 0) {
    return REPO_ROOT;
  }
  return path.resolve(projectRoot);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer | string) => {
      data += chunk.toString();
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readRequestBody(req);
  try {
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON body: ${message}`);
  }
}

function normalizeApplyMode(value: unknown): ApplyMode | undefined {
  if (value === "apply" || value === "preview") {
    return value;
  }
  return undefined;
}

function normalizeWriteMode(value: unknown): WriteMode | undefined {
  if (value === "apply" || value === "preview") {
    return value;
  }
  return undefined;
}

function normalizeSafetyLevel(value: unknown): SafetyLevel | undefined {
  if (value === "none" || value === "basic" || value === "strict") {
    return value;
  }
  return undefined;
}

function normalizeGitOptions(value: unknown): GitOptions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as any;
  if (obj.enabled !== true) return { enabled: false, branchStrategy: "current", autoCommit: false };
  const strategy: GitOptions["branchStrategy"] =
    obj.branchStrategy === "explicit" || obj.branchStrategy === "new-from-main" || obj.branchStrategy === "current"
      ? obj.branchStrategy
      : "current";
  return {
    enabled: true,
    branchStrategy: strategy,
    targetBranch: typeof obj.targetBranch === "string" ? obj.targetBranch : undefined,
    baseBranch: typeof obj.baseBranch === "string" ? obj.baseBranch : undefined,
    autoCommit: obj.autoCommit === true,
    commitMessageTemplate: typeof obj.commitMessageTemplate === "string" ? obj.commitMessageTemplate : undefined,
  };
}

function normalizePreApplyChecks(value: unknown): PreApplyCheckConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as PreApplyCheckConfig;
  const normalized: PreApplyCheckConfig = {};
  if (obj.build !== undefined) normalized.build = !!obj.build;
  if (obj.types !== undefined) normalized.types = !!obj.types;
  if (obj.tests !== undefined) normalized.tests = !!obj.tests;
  return normalized;
}

function toTree(paths: string[]): ProjectTreeNode[] {
  const root: ProjectTreeNode = { name: "", path: "", type: "dir", children: [] };

  for (const p of paths) {
    const segments = p.split(path.sep).filter(Boolean);
    let cursor = root;
    let currentPath = "";
    segments.forEach((seg, idx) => {
      currentPath = currentPath ? path.join(currentPath, seg) : seg;
      if (!cursor.children) cursor.children = [];
      let child = cursor.children.find((c) => c.name === seg);
      if (!child) {
        child = {
          name: seg,
          path: currentPath,
          type: idx === segments.length - 1 ? "file" : "dir",
        };
        if (child.type === "dir") child.children = [];
        cursor.children.push(child);
      }
      cursor = child;
    });
  }

  return root.children || [];
}

async function buildRepoOverview(projectRoot: string): Promise<RepoOverview> {
  const files = await listProjectFiles(projectRoot, {
    includeGlobs: ["**/*.ts", "**/*.tsx"],
  });
  return {
    projectRoot,
    files: files.map((f) => path.relative(projectRoot, f)),
    snippets: [],
  };
}

type SessionLogEntry = {
  sessionId: string;
  input: unknown;
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: ApiError | { message: string; code?: string; stack?: string; details?: unknown };
};

async function ensureSessionLogDir(): Promise<void> {
  await fs.mkdir(SESSION_LOG_DIR, { recursive: true });
}

function formatLogFileName(sessionId: string): string {
  const safeId = sessionId || "session";
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  return `session-${timestamp}-${safeId}.json`;
}

async function writeSessionLog(entry: SessionLogEntry): Promise<string> {
  await ensureSessionLogDir();
  const fileName = formatLogFileName(entry.sessionId);
  const absolutePath = path.join(SESSION_LOG_DIR, fileName);
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2), "utf8");
  return path.relative(REPO_ROOT, absolutePath);
}

function extractToken(req: IncomingMessage): string | undefined {
  const bearer = req.headers.authorization;
  if (typeof bearer === "string" && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }

  const agentHeader = req.headers["x-elyra-agent-token"];
  if (typeof agentHeader === "string") return agentHeader;
  if (Array.isArray(agentHeader)) return agentHeader[0];

  const legacyHeader = req.headers["x-elyra-token"];
  if (typeof legacyHeader === "string") return legacyHeader;
  if (Array.isArray(legacyHeader)) return legacyHeader[0];

  return undefined;
}

function validateAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!AUTH_TOKEN) return true;
  const provided = extractToken(req);
  if (provided !== AUTH_TOKEN) {
    unauthorized(res);
    return false;
  }
  return true;
}

async function handleStatus(_: IncomingMessage, res: ServerResponse): Promise<void> {
  let statusSummary = "";
  let gitError: string | undefined;

  try {
    statusSummary = await getGitStatusPorcelain(REPO_ROOT);
  } catch (error) {
    gitError = error instanceof Error ? error.message : String(error);
  }

  const payload: StatusResponse = {
    ok: true,
    projectRoot: REPO_ROOT,
    workerVersion: WORKER_VERSION,
    git: {
      clean: statusSummary === "" && !gitError,
      statusSummary,
      error: gitError,
    },
  };

  sendJson(res, 200, payload);
}

async function loadTaskFromFile(taskFile: string): Promise<DevTask> {
  const absolutePath = resolveFromRepoRoot(taskFile);
  const json = await fs.readFile(absolutePath, "utf8");
  try {
    return JSON.parse(json) as DevTask;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse task JSON at ${absolutePath}: ${message}`);
  }
}

function assertDevTask(task: DevTask | undefined): DevTask {
  if (
    !task ||
    typeof task.id !== "string" ||
    typeof task.goal !== "string" ||
    typeof task.mode !== "string" ||
    typeof task.projectRoot !== "string" ||
    !task.target ||
    typeof task.target.file !== "string"
  ) {
    throw new Error("Invalid task config");
  }
  return task;
}

function withAbsoluteProjectRoot(task: DevTask): DevTask {
  const absoluteRoot = path.isAbsolute(task.projectRoot)
    ? task.projectRoot
    : resolveFromRepoRoot(task.projectRoot);
  return { ...task, projectRoot: absoluteRoot };
}

async function handleRunTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: RunTaskRequest;
  try {
    body = await parseJsonBody<RunTaskRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, {
      ok: false,
      error: { message, code: "BAD_REQUEST" },
    });
    return;
  }

  if (body.taskConfig && body.taskFile) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Provide either taskConfig or taskFile, not both", code: "BAD_REQUEST" },
    });
    return;
  }

  if (!body.taskConfig && !body.taskFile) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "taskConfig or taskFile is required", code: "BAD_REQUEST" },
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const allowDirty = body.allowDirty === true;

  try {
    const loadedTask = body.taskFile
      ? await loadTaskFromFile(body.taskFile)
      : assertDevTask(body.taskConfig);

    const task = withAbsoluteProjectRoot(assertDevTask(loadedTask));

    await ensureCleanGitWorkingTree(task.projectRoot, { allowDirty });

    const taskResult = await runDevTask(task);
    const finishedAt = new Date().toISOString();

    const response: RunTaskResponse = {
      ok: true,
      taskResult,
      startedAt,
      finishedAt,
    };

    log.info(`Run-task ${task.id} completed with status ${taskResult.status}`);
    sendJson(res, 200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error("Run-task failed:", error);
    sendJson(res, 500, {
      ok: false,
      error: { message, code: "TASK_RUN_FAILED", stack },
    });
  }
}

async function handleRunSingleEdit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: RunSingleEditRequest;
  try {
    body = await parseJsonBody<RunSingleEditRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } });
    return;
  }

  if (!body.file || !body.goal) {
    sendJson(res, 400, { ok: false, error: { message: "file and goal are required", code: "BAD_REQUEST" } });
    return;
  }

  const writeMode = body.writeMode === "apply" ? "apply" : "preview";
  const safetyLevel = body.safetyLevel === "strict" ? "strict" : "basic";
  const projectRoot = resolveProjectRoot(body.projectRoot);
  const allowDirty = body.allowDirty === true || writeMode === "preview";
  const devTask: DevTask = {
    id: `single-${Date.now()}`,
    goal: body.goal,
    mode: body.mode || "refactor",
    projectRoot,
    target: { file: body.file },
    writeMode,
    safetyLevel,
  };

  try {
    await ensureCleanGitWorkingTree(projectRoot, { allowDirty });
    const result = await runSingleFileEditTask(projectRoot, devTask, {
      writeMode,
      safetyLevel,
    }) as SingleEditTaskResult;
    sendJson(res, 200, { ok: true, result } as RunSingleEditResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] run-single failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "TASK_SINGLE_FAILED" } } as RunSingleEditResponse);
  }
}

async function handleRunDeploy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: DeployRunRequest;
  try {
    body = await parseJsonBody<DeployRunRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, {
      ok: false,
      error: { message, code: "BAD_REQUEST" },
      dryRun: true,
    });
    return;
  }

  if (!body?.config || typeof body.config.projectRoot !== "string") {
    sendJson(res, 400, {
      ok: false,
      dryRun: !!body?.dryRun,
      error: { message: "Invalid deploy config", code: "BAD_REQUEST" },
    });
    return;
  }

  if (!Array.isArray(body.config.preDeployCommands) || !Array.isArray(body.config.deployCommands)) {
    sendJson(res, 400, {
      ok: false,
      dryRun: !!body?.dryRun,
      error: { message: "preDeployCommands and deployCommands must be arrays", code: "BAD_REQUEST" },
    });
    return;
  }

  const dryRun = body.dryRun === true;
  log.info(
    "[Deploy] Starting deploy run",
    body.config.id,
    `(dryRun=${dryRun}, pre=${body.config.preDeployCommands.length}, deploy=${body.config.deployCommands.length})`
  );

  try {
    const result = await runDeployConfig(body.config, { dryRun });
    sendJson(res, 200, {
      ok: true,
      dryRun,
      result,
    } as DeployRunResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[Deploy] Failed:", error);
    sendJson(res, 500, {
      ok: false,
      dryRun,
      error: { message, code: "DEPLOY_RUN_FAILED" },
    } as DeployRunResponse);
  }
}

async function handleListBackups(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const backups = await listBackups(REPO_ROOT);
    const payload: BackupListResponse = { ok: true, backups };
    sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[Rollback] Failed to list backups:", error);
    const payload: BackupListResponse = { ok: false, error: { message, code: "BACKUP_LIST_FAILED" } };
    sendJson(res, 500, payload);
  }
}

async function handleRestoreBackup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: BackupRestoreRequest;
  try {
    body = await parseJsonBody<BackupRestoreRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } } as BackupRestoreResponse);
    return;
  }

  if (!body?.backupId || typeof body.backupId !== "string") {
    sendJson(res, 400, { ok: false, error: { message: "backupId is required", code: "BAD_REQUEST" } });
    return;
  }

  const dryRun = body.dryRun === true;
  try {
    const result = await restoreBackup(REPO_ROOT, body.backupId, { dryRun });
    const payload: BackupRestoreResponse = {
      ok: true,
      backupId: result.backupId,
      restoredFiles: result.restoredFiles,
      dryRun,
    };
    sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[Rollback] Failed to restore backup:", error);
    const payload: BackupRestoreResponse = {
      ok: false,
      error: { message, code: "BACKUP_RESTORE_FAILED" },
      dryRun,
    };
    sendJson(res, 500, payload);
  }
}

async function handleProjectTree(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const files = await listProjectFiles(REPO_ROOT, {
      includeGlobs: ["**/*.ts", "**/*.tsx"],
    });
    const relative = files.map((f) => path.relative(REPO_ROOT, f));
    const tree = toTree(relative);
    const payload: ProjectTreeResponse = { ok: true, tree };
    sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /project/tree failed:", error);
    const payload: ProjectTreeResponse = { ok: false, error: { message, code: "PROJECT_TREE_FAILED" } };
    sendJson(res, 500, payload);
  }
}

async function handleProjectSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: ProjectSearchRequest;
  try {
    body = await parseJsonBody<ProjectSearchRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } });
    return;
  }

  if (!body.pattern || typeof body.pattern !== "string") {
    sendJson(res, 400, { ok: false, error: { message: "pattern is required", code: "BAD_REQUEST" } });
    return;
  }

  try {
    const hits = await searchInFiles(REPO_ROOT, body.pattern, {
      roots: body.roots?.map((r) => resolveFromRepoRoot(r)),
      caseSensitive: body.caseSensitive !== false,
    });
    const payload: ProjectSearchResponse = { ok: true, hits, total: hits.length };
    sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /project/search failed:", error);
    const payload: ProjectSearchResponse = { ok: false, error: { message, code: "PROJECT_SEARCH_FAILED" } };
    sendJson(res, 500, payload);
  }
}

async function handleProjectGraph(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Stub endpoint so Project Map UI does not 404. Replace with real project graph later.
  try {
    const placeholder = {
      ok: true,
      source: "stub",
      nodes: [] as unknown[],
      edges: [] as unknown[],
      note:
        "Project graph endpoint is not implemented yet. This is a placeholder so the Project Map UI can render without errors.",
    };
    sendJson(res, 200, placeholder);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /project/graph failed:", { error: message });
    sendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: "Failed to serve project graph stub" });
  }
}

async function handleProjectGraphSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : undefined;
  const query = url?.searchParams.get("q") || "";
  if (!query) {
    sendJson(res, 400, { ok: false, error: { message: "q is required", code: "BAD_REQUEST" } });
    return;
  }
  try {
    const graph = await getProjectGraph(REPO_ROOT);
    const results = searchProjectGraph(graph, query);
    sendJson(res, 200, { ok: true, query, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /project/search (graph) failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "PROJECT_GRAPH_SEARCH_FAILED" } });
  }
}

async function handleFeaturePlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseJsonBody<{ featureId?: string; description?: string; scope?: import("./devTaskTypes").PlanScope }>(req);
    if (!body.description || typeof body.description !== "string") {
      sendJson(res, 400, { ok: false, error: "Invalid body" });
      return;
    }
    const featureId = body.featureId || `feature-${Date.now()}`;
    const plan = await generatePlan(REPO_ROOT, {
      featureId,
      description: body.description,
      scope: body.scope,
    });
    log.info("[Planner] feature plan generated", {
      featureId: plan.featureId,
      steps: plan.steps.length,
      tasks: plan.tasks.length,
      matched: plan.graphSummary?.matchedFiles,
    });
    sendJson(res, 200, { ok: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[Planner] feature plan failed:", error);
    sendJson(res, 500, { ok: false, error: `Planner failed: ${message}` });
  }
}

async function handleFeaturePlanMaterialize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseJsonBody<{
      plan?: import("./devTaskTypes").PlanResult;
      baseDir?: string;
      writeMode?: import("./devTaskTypes").WriteMode;
    }>(req);
    if (!body?.plan || !body.plan.featureId || !Array.isArray(body.plan.tasks) || !Array.isArray(body.plan.steps)) {
      sendJson(res, 400, { ok: false, error: "Invalid body: plan is required" });
      return;
    }
    const writeMode = body.writeMode === "apply" ? "apply" : "preview";
    const result = await materializePlanToTasksAndSession({
      projectRoot: REPO_ROOT,
      plan: body.plan,
      baseDir: body.baseDir,
      writeMode,
    });
    log.info("[Planner] Materialized plan", {
      featureId: body.plan.featureId,
      writeMode,
      tasks: result.preview.tasks.length,
      written: result.writtenTaskFiles.length,
    });
    sendJson(res, 200, { ok: true, writeMode, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[Planner] materialize failed:", error);
    sendJson(res, 500, { ok: false, error: `Materialization failed: ${message}` });
  }
}

async function handleFeatureRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseJsonBody<{
      featureId?: string;
      description?: string;
      apply?: boolean;
      baseDir?: string;
      planOptions?: { scope?: import("./devTaskTypes").PlanScope };
      sessionOptions?: {
        safetyLevel?: SafetyLevel;
        maxTasks?: number;
        git?: {
          autoCommit?: boolean;
          branchMode?: "none" | "feature" | "custom" | "feature-branch";
          customBranchName?: string;
          tagPattern?: string | null;
        };
        incidentWebhook?: import("./devTaskTypes").IncidentWebhookConfig;
      };
    }>(req);
    if (!body?.description || typeof body.description !== "string") {
      sendJson(res, 400, { ok: false, error: "description required" });
      return;
    }
    const featureId = body.featureId || `feature-${Date.now()}`;
    log.info("[FeatureRun] Planning feature", { featureId });
    let plan: import("./devTaskTypes").PlanResult;
    try {
      plan = await generatePlan(REPO_ROOT, {
        featureId,
        description: body.description,
        scope: body.planOptions?.scope,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, stage: "plan", error: `Plan failed: ${message}`, featureId, description: body.description });
      return;
    }

    let materialization: Awaited<ReturnType<typeof materializePlanToTasksAndSession>>;
    try {
      log.info("[FeatureRun] Materializing plan", { featureId, baseDir: body.baseDir || "autoplan" });
      materialization = await materializePlanToTasksAndSession({
        projectRoot: REPO_ROOT,
        plan,
        baseDir: body.baseDir || "autoplan",
        writeMode: "apply",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, {
        ok: false,
        stage: "materialize",
        featureId,
        error: `Materialization failed: ${message}`,
        plan: { featureId: plan.featureId, steps: plan.steps?.length || 0, tasks: plan.tasks?.length || 0 },
      });
      return;
    }

    const sessionFileRel = materialization.writtenSessionFile?.filePath;
    const sessionPath = sessionFileRel ? path.resolve(REPO_ROOT, "worker", sessionFileRel) : null;
    if (!sessionPath) {
      sendJson(res, 500, {
        ok: false,
        stage: "materialize",
        featureId,
        error: "No session file generated",
      });
      return;
    }

    const safety = body.sessionOptions?.safetyLevel || "strict";
    const gitFromSession = body.sessionOptions?.git;
    const incidentWebhook = body.sessionOptions?.incidentWebhook;
    if (incidentWebhook && (!incidentWebhook.url || !incidentWebhook.url.startsWith("http"))) {
      sendJson(res, 400, { ok: false, error: "Invalid incident webhook url" });
      return;
    }
    let previewResult: SessionRunResult | null = null;
    try {
      log.info("[FeatureRun] Running preview session", { sessionPath });
      previewResult = await runSession(sessionPath, {
        writeMode: "preview",
        safetyLevel: safety,
        git: { ...(gitFromSession as any), autoCommit: false, enabled: false },
        incidentWebhook,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 200, {
        ok: false,
        stage: "preview",
        featureId,
        planSummary: { steps: plan.steps.length, tasks: plan.tasks.length },
        materialization: {
          baseDir: body.baseDir || "autoplan",
          sessionFile: sessionFileRel,
          taskFiles: materialization.writtenTaskFiles,
        },
        preview: { status: "failed", error: message, sessionResult: previewResult },
      });
      return;
    }

    if (!body.apply) {
      sendJson(res, 200, {
        ok: true,
        featureId,
        description: body.description,
        plan,
        materialization: {
          baseDir: body.baseDir || "autoplan",
          sessionFile: sessionFileRel,
          taskFiles: materialization.writtenTaskFiles,
        },
        preview: { status: "ok", writeMode: "preview", sessionResult: previewResult },
        apply: { status: "skipped" },
      });
      return;
    }

    let applyResult: SessionRunResult | null = null;
    try {
      log.info("[FeatureRun] Running apply session", { sessionPath });
      applyResult = await runSession(sessionPath, {
        writeMode: "apply",
        safetyLevel: safety,
        git: {
          enabled: gitFromSession?.autoCommit ?? true,
          autoCommit: gitFromSession?.autoCommit ?? true,
          branchMode: (gitFromSession as any)?.branchMode || "feature",
          targetBranch: (gitFromSession as any)?.customBranchName,
          commitMessageTemplate: undefined,
        } as any,
        incidentWebhook,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 200, {
        ok: false,
        stage: "apply",
        featureId,
        plan,
        materialization: {
          baseDir: body.baseDir || "autoplan",
          sessionFile: sessionFileRel,
          taskFiles: materialization.writtenTaskFiles,
        },
        preview: { status: "ok", sessionResult: previewResult },
        apply: { status: "failed", error: message, sessionResult: applyResult },
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      featureId,
      description: body.description,
      plan,
      materialization: {
        baseDir: body.baseDir || "autoplan",
        sessionFile: sessionFileRel,
        taskFiles: materialization.writtenTaskFiles,
      },
      preview: { status: "ok", writeMode: "preview", sessionResult: previewResult },
      apply: { status: "ok", writeMode: "apply", sessionResult: applyResult },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[FeatureRun] failed:", error);
    sendJson(res, 500, { ok: false, stage: "unknown", error: message });
  }
}

async function handleRecentSessions(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { ok: true, sessions: recentSessions });
}

async function handleFsList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : undefined;
  const rootParam = url?.searchParams.get("root") || ".";
  const pattern = url?.searchParams.get("pattern") || undefined;
  const resolvedRoot = resolveFromRepoRoot(rootParam);

  try {
    const files = await listFiles(resolvedRoot, pattern);
    const rel = files.map((f) => path.relative(REPO_ROOT, f));
    sendJson(res, 200, { ok: true, files: rel } as FsListResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /fs/list failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "FS_LIST_FAILED" } } as FsListResponse);
  }
}

async function handleFsRead(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : undefined;
  const fileParam = url?.searchParams.get("file");
  if (!fileParam) {
    sendJson(res, 400, { ok: false, error: { message: "file is required", code: "BAD_REQUEST" } } as FsReadResponse);
    return;
  }

  const resolved = resolveFromRepoRoot(fileParam);
  try {
    const content = await readFileSafe(REPO_ROOT, resolved);
    sendJson(res, 200, { ok: true, file: path.relative(REPO_ROOT, resolved), content } as FsReadResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /fs/read failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "FS_READ_FAILED" } } as FsReadResponse);
  }
}

async function handleFsSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : undefined;
  const q = url?.searchParams.get("q");
  const glob = url?.searchParams.get("glob") || undefined;
  const maxResultsParam = url?.searchParams.get("maxResults");
  if (!q) {
    sendJson(res, 400, { ok: false, error: { message: "q is required", code: "BAD_REQUEST" } } as FsSearchResponse);
    return;
  }
  const maxResults = maxResultsParam ? Number(maxResultsParam) : undefined;

  try {
    const hits = await searchInFiles(REPO_ROOT, q, {
      glob,
      maxResults: Number.isFinite(maxResults) ? maxResults : undefined,
    });
    sendJson(res, 200, { ok: true, hits, total: hits.length } as FsSearchResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /fs/search failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "FS_SEARCH_FAILED" } } as FsSearchResponse);
  }
}

async function handleRunChecks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: RunChecksRequest;
  try {
    body = await parseJsonBody<RunChecksRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } } as RunChecksResponse);
    return;
  }

  if (!body.checks || !Array.isArray(body.checks) || body.checks.some((c) => typeof c !== "string")) {
    sendJson(res, 400, { ok: false, error: { message: "checks must be string array", code: "BAD_REQUEST" } });
    return;
  }

  try {
    const results = await runChecks(REPO_ROOT, body.checks);
    sendJson(res, 200, { ok: true, checks: results } as RunChecksResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /checks/run failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "CHECKS_RUN_FAILED" } } as RunChecksResponse);
  }
}

async function handleRunPlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: RunPlanRequest;
  try {
    body = await parseJsonBody<RunPlanRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } } as RunPlanResponse);
    return;
  }

  if (!body.planConfigPath || typeof body.planConfigPath !== "string") {
    sendJson(res, 400, { ok: false, error: { message: "planConfigPath is required", code: "BAD_REQUEST" } });
    return;
  }

  log.info("[ElyraAgent] Running plan", body.planConfigPath);

  try {
    const planResult = await runDevPlan(resolveFromRepoRoot(body.planConfigPath));
    sendJson(res, 200, { ok: true, planResult } as RunPlanResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] Plan run failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "PLAN_RUN_FAILED" } } as RunPlanResponse);
  }
}

async function handleGeneratePlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { description?: string; writeMode?: ApplyMode; safetyLevel?: SafetyLevel };
  try {
    body = await parseJsonBody<{ description?: string; writeMode?: ApplyMode; safetyLevel?: SafetyLevel }>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } });
    return;
  }

  if (!body.description || typeof body.description !== "string") {
    sendJson(res, 400, { ok: false, error: { message: "description is required", code: "BAD_REQUEST" } });
    return;
  }

  const writeMode = body.writeMode === "apply" ? "apply" : "preview";
  const safetyLevel = body.safetyLevel === "basic" || body.safetyLevel === "strict" ? body.safetyLevel : "strict";

  try {
    const plan = await generatePlanFromDescription(body.description);
    const validation = validatePlanStructure(plan);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, error: { message: "Invalid plan", code: "INVALID_PLAN", details: validation.errors } });
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const slug = plan.id || `plan-${timestamp}`;
    let planPath: string | null = null;

    if (writeMode === "apply") {
      const plansDir = path.resolve(REPO_ROOT, "worker", "plans");
      await fs.mkdir(plansDir, { recursive: true });
      planPath = path.join(plansDir, `${slug}.json`);
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
    }

    sendJson(res, 200, {
      ok: true,
      writeMode,
      planPath: planPath ? path.relative(REPO_ROOT, planPath) : null,
      plan,
      llmPromptUsed: "generatePlanFromDescription",
      warnings: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] Plan generation failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "PLAN_GENERATE_FAILED" } });
  }
}
async function handleListPlans(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const plansDir = path.resolve(REPO_ROOT, "worker", "plans");
  try {
    const entries = await fsPromises.readdir(plansDir, { withFileTypes: true });
    const plans: PlanListItem[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const fullPath = path.join(plansDir, entry.name);
      try {
        const json = await fs.readFile(fullPath, "utf8");
        const data = JSON.parse(json) as { id?: string; label?: string; steps?: Array<{ type: string; id?: string; label?: string }> };
        if (!data.id) continue;
        plans.push({
          id: data.id,
          label: data.label,
          steps: Array.isArray(data.steps)
            ? data.steps.map((s) => ({ type: (s as any).type, id: (s as any).id, label: (s as any).label }))
            : [],
          configPath: path.relative(REPO_ROOT, fullPath),
        });
      } catch (err) {
        log.warn("[ElyraAgent] Failed to parse plan file", entry.name, err);
      }
    }
    sendJson(res, 200, { ok: true, plans } as PlanListResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /plans/list failed:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "PLAN_LIST_FAILED" } } as PlanListResponse);
  }
}

async function handleDraftSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: DraftSessionRequest;
  try {
    body = await parseJsonBody<DraftSessionRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { message, code: "BAD_REQUEST" } });
    return;
  }

  if (!body.goal || typeof body.goal !== "string") {
    sendJson(res, 400, { ok: false, error: { message: "goal is required", code: "BAD_REQUEST" } });
    return;
  }

  const projectRoot =
    (body.projectRoot && (path.isAbsolute(body.projectRoot) ? body.projectRoot : resolveFromRepoRoot(body.projectRoot))) ||
    REPO_ROOT;

  try {
    const overview = await buildRepoOverview(projectRoot);
    const session = await planDevSession(body.goal, overview, body.defaults);
    const payload: DraftSessionResponse = {
      ok: true,
      session,
      meta: { usedFiles: overview.files.slice(0, 20), generatedAt: new Date().toISOString() },
    };
    sendJson(res, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[ElyraAgent] /planning/draft-session failed:", error);
    const payload: DraftSessionResponse = { ok: false, error: { message, code: "PLANNING_FAILED" } };
    sendJson(res, 500, payload);
  }
}

async function handleRunSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: RunSessionRequest;
  try {
    body = await parseJsonBody<RunSessionRequest>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, {
      ok: false,
      error: { message, code: "BAD_REQUEST" },
    });
    return;
  }

  if (!body.configPath) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "configPath is required", code: "BAD_REQUEST" },
    });
    return;
  }

  const requestedApplyMode = normalizeApplyMode(body.applyMode);
  const requestedWriteMode = normalizeWriteMode(body.writeMode);
  const requestedSafety = normalizeSafetyLevel(body.safetyLevel);
  const gitOptions = normalizeGitOptions(body.git);
  const preApplyChecks = normalizePreApplyChecks(body.preApplyChecks);
  if (body.git?.branchMode) {
    const validBranchMode = body.git.branchMode === "none" || body.git.branchMode === "feature" || body.git.branchMode === "custom" || body.git.branchMode === "feature-branch";
    if (!validBranchMode) {
      sendJson(res, 400, { ok: false, error: { message: "Invalid git.branchMode", code: "BAD_REQUEST" } });
      return;
    }
    if ((body.git.branchMode === "feature" || body.git.branchMode === "feature-branch") && !(body.git as any).featureId) {
      sendJson(res, 400, { ok: false, error: { message: "featureId required for feature branch mode", code: "BAD_REQUEST" } });
      return;
    }
    if (body.git.branchMode === "custom" && !(body.git as any).customBranchName) {
      sendJson(res, 400, { ok: false, error: { message: "customBranchName required for custom branch mode", code: "BAD_REQUEST" } });
      return;
    }
  }
  if (body.git?.enabled === true) {
    const strat = body.git.branchStrategy;
    const validStrat = strat === "current" || strat === "new-from-main" || strat === "explicit";
    if (!validStrat) {
      sendJson(res, 400, { ok: false, error: { message: "Invalid git.branchStrategy", code: "BAD_REQUEST" } });
      return;
    }
    if (strat === "explicit" && !body.git.targetBranch) {
      sendJson(res, 400, { ok: false, error: { message: "targetBranch required for explicit strategy", code: "BAD_REQUEST" } });
      return;
    }
    if (strat === "new-from-main" && !body.git.targetBranch) {
      sendJson(res, 400, { ok: false, error: { message: "targetBranch required for new-from-main strategy", code: "BAD_REQUEST" } });
      return;
    }
  }

  if (body.applyMode !== undefined && !requestedApplyMode) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Invalid applyMode; expected 'apply' or 'preview'", code: "BAD_REQUEST" },
    });
    return;
  }
  if (body.writeMode !== undefined && !requestedWriteMode) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Invalid writeMode; expected 'apply' or 'preview'", code: "BAD_REQUEST" },
    });
    return;
  }
  if (body.incidentWebhook) {
    if (!body.incidentWebhook.url || typeof body.incidentWebhook.url !== "string") {
      sendJson(res, 400, { ok: false, error: { message: "incidentWebhook.url required", code: "BAD_REQUEST" } });
      return;
    }
    if (!body.incidentWebhook.url.startsWith("http")) {
      sendJson(res, 400, { ok: false, error: { message: "incidentWebhook.url must be http(s)", code: "BAD_REQUEST" } });
      return;
    }
  }
  if (body.safetyLevel !== undefined && !requestedSafety) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Invalid safetyLevel; expected 'none' | 'basic' | 'strict'", code: "BAD_REQUEST" },
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const allowDirty = body.allowDirty === true;
  const absoluteConfigPath = resolveFromRepoRoot(body.configPath);
  const effectiveWriteMode: WriteMode =
    body.previewOnly === true
      ? "preview"
      : requestedWriteMode ??
        (requestedApplyMode as WriteMode | undefined) ??
        "apply";
  const effectiveApplyMode: ApplyMode =
    requestedApplyMode ?? (effectiveWriteMode as ApplyMode) ?? "apply";
  const safetyForRun = requestedSafety;
  const safetyLabel = safetyForRun ?? "config/default";
  const withChecks = body.withChecks !== false;
  const gitLabel =
    gitOptions && gitOptions.enabled
      ? `git (strategy=${gitOptions.branchStrategy || "current"}, target=${gitOptions.targetBranch || "-"})`
      : "git disabled";

  log.info(
    "Starting session from config:",
    absoluteConfigPath,
    "(allowDirty:",
    allowDirty,
    ", applyMode:",
    effectiveApplyMode,
    ", writeMode:",
    effectiveWriteMode,
    ", safetyLevel:",
    safetyLabel,
    ", checks:",
    withChecks ? "on" : "off",
    ",",
    gitLabel,
    ")"
  );

  try {
    const sessionResult = await runSession(absoluteConfigPath, {
      allowDirty,
      repoRoot: REPO_ROOT,
      applyMode: effectiveApplyMode,
      writeMode: effectiveWriteMode,
      safetyLevel: safetyForRun,
      withChecks,
      git: gitOptions,
      preApplyChecks,
      maxTasks: body.maxTasks,
      incidentWebhook: body.incidentWebhook,
    });
    const finishedAt = new Date().toISOString();
    recentSessions.unshift({
      sessionId: sessionResult.sessionId,
      startedAt,
      finishedAt,
      status: sessionResult.status,
      writeMode: sessionResult.writeMode,
      safetyLevel: sessionResult.safetyLevel as SafetyLevel,
    });
    if (recentSessions.length > 20) recentSessions.length = 20;

    const response: RunSessionResponse = {
      ok: true,
      sessionResult,
      applyMode: sessionResult.applyMode ?? effectiveApplyMode,
      writeMode: sessionResult.writeMode ?? effectiveWriteMode,
      safetyLevel: sessionResult.safetyLevel ?? safetyForRun ?? "none",
      overallRiskLevel: sessionResult.overallRiskLevel,
      overallRiskReason: sessionResult.overallRiskReason,
      blocked: sessionResult.blocked,
      blockedReason: sessionResult.blockedReason,
      startedAt,
      finishedAt,
      reportFile: sessionResult.reportFilePath,
    };

    sendJson(res, 200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error("Run-session failed:", error);
    sendJson(res, 500, {
      ok: false,
      error: { message, code: "SESSION_RUN_FAILED", stack },
    });
  }
}

async function handleRunSessionById(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: {
    id?: string;
    allowDirty?: boolean;
    applyMode?: ApplyMode;
    writeMode?: WriteMode;
    previewOnly?: boolean;
    safetyLevel?: SafetyLevel;
    withChecks?: boolean;
    git?: GitOptions;
    preApplyChecks?: PreApplyCheckConfig;
  };
  try {
    body = await parseJsonBody<{
      id?: string;
      allowDirty?: boolean;
      applyMode?: ApplyMode;
      writeMode?: WriteMode;
      previewOnly?: boolean;
      safetyLevel?: SafetyLevel;
      withChecks?: boolean;
      git?: GitOptions;
      preApplyChecks?: PreApplyCheckConfig;
    }>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, {
      ok: false,
      error: { message, code: "BAD_REQUEST" },
    });
    return;
  }

  if (!body.id) {
    sendJson(res, 400, { ok: false, error: "session_id_required" });
    return;
  }

  const configPathRelative = SESSION_CONFIG_MAP[body.id];
  if (!configPathRelative) {
    sendJson(res, 400, { ok: false, error: "unknown_session_id" });
    return;
  }

  if (isSessionRunning) {
    sendJson(res, 409, { ok: false, error: "session_already_running" });
    return;
  }

  const allowDirty = body.allowDirty === true;
  const requestedApplyMode = normalizeApplyMode(body.applyMode);
  if (body.applyMode !== undefined && !requestedApplyMode) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Invalid applyMode; expected 'apply' or 'preview'", code: "BAD_REQUEST" },
    });
    return;
  }
  const requestedWriteMode = normalizeWriteMode(body.writeMode);
  if (body.writeMode !== undefined && !requestedWriteMode) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Invalid writeMode; expected 'apply' or 'preview'", code: "BAD_REQUEST" },
    });
    return;
  }
  const requestedSafety = normalizeSafetyLevel(body.safetyLevel);
  if (body.safetyLevel !== undefined && !requestedSafety) {
    sendJson(res, 400, {
      ok: false,
      error: { message: "Invalid safetyLevel; expected 'none' | 'basic' | 'strict'", code: "BAD_REQUEST" },
    });
    return;
  }
  const gitOptions = normalizeGitOptions(body.git);
  const preApplyChecks = normalizePreApplyChecks(body.preApplyChecks);
  const effectiveWriteMode: WriteMode =
    body.previewOnly === true
      ? "preview"
      : requestedWriteMode ??
        (requestedApplyMode as WriteMode | undefined) ??
        "apply";
  const effectiveApplyMode: ApplyMode =
    requestedApplyMode ?? (effectiveWriteMode as ApplyMode) ?? "apply";
  const safetyForRun = requestedSafety;
  const safetyLabel = safetyForRun ?? "config/default";
  const withChecks = body.withChecks !== false;
  const autoBranch = false;
  const startedAt = new Date().toISOString();
  const sessionId = body.id;
  const gitLabel =
    gitOptions && gitOptions.enabled
      ? `git (strategy=${gitOptions.branchStrategy || "current"}, target=${gitOptions.targetBranch || "-"})`
      : "git disabled";

  isSessionRunning = true;
  try {
    const absoluteConfigPath = resolveFromRepoRoot(configPathRelative);
    log.info(
      "Starting mapped session:",
      sessionId,
      "(allowDirty:",
      allowDirty,
      ", applyMode:",
      effectiveApplyMode,
      ", writeMode:",
      effectiveWriteMode,
      ", safetyLevel:",
      safetyLabel,
      ", checks:",
      withChecks ? "on" : "off",
      ",",
      gitLabel,
      ")"
    );
    const sessionResult = await runSession(absoluteConfigPath, {
      allowDirty,
      repoRoot: REPO_ROOT,
      applyMode: effectiveApplyMode,
      writeMode: effectiveWriteMode,
      safetyLevel: safetyForRun,
      withChecks,
      git: gitOptions,
      preApplyChecks,
    });
    const finishedAt = new Date().toISOString();
    const summarizedResults =
      sessionResult.results?.map((r) => ({ id: r.id, status: r.status })) || [];

    const logFile = await writeSessionLog({
      sessionId: sessionResult.sessionId || sessionId,
      input: body,
      startedAt: sessionResult.startedAt || startedAt,
      finishedAt: sessionResult.finishedAt || finishedAt,
      result: sessionResult,
    });

    const response: RunSessionResponse = {
      ok: true,
      sessionId: sessionResult.sessionId || sessionId,
      results: summarizedResults,
      startedAt: sessionResult.startedAt || startedAt,
      finishedAt: sessionResult.finishedAt || finishedAt,
      sessionResult,
      applyMode: sessionResult.applyMode ?? effectiveApplyMode,
      writeMode: sessionResult.writeMode ?? effectiveWriteMode,
      overallRiskLevel: sessionResult.overallRiskLevel,
      overallRiskReason: sessionResult.overallRiskReason,
      blocked: sessionResult.blocked,
      blockedReason: sessionResult.blockedReason,
      safetyLevel: sessionResult.safetyLevel ?? safetyForRun ?? "none",
      logFile,
      reportFile: sessionResult.reportFilePath,
    };

    sendJson(res, 200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error("Run-session by id failed:", error);

    const apiError: ApiError = { message, code: "SESSION_RUN_FAILED", stack };
    let logFile: string | undefined;
    try {
      logFile = await writeSessionLog({
        sessionId,
        input: body,
        startedAt,
        error: apiError,
      });
    } catch (logErr) {
      log.error("Failed to write session log:", logErr);
    }

    sendJson(res, 500, {
      ok: false,
      error: apiError,
      logFile,
    });
  } finally {
    isSessionRunning = false;
  }
}

function routeRequest(req: IncomingMessage): RouteHandler | undefined {
  const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : undefined;
  const pathname = url?.pathname || "/";

  if (req.method === "GET" && pathname === "/status") {
    return handleStatus;
  }
  if (req.method === "POST" && pathname === "/plan/feature") {
    return handleFeaturePlan;
  }
  if (req.method === "POST" && pathname === "/plan/materialize") {
    return handleFeaturePlanMaterialize;
  }
  if (req.method === "POST" && pathname === "/feature/run") {
    return handleFeatureRun;
  }
  if (req.method === "GET" && pathname === "/sessions/recent") {
    return handleRecentSessions;
  }
  if (req.method === "GET" && pathname === "/project/graph") {
    return handleProjectGraph;
  }
  if (req.method === "GET" && pathname === "/project/search") {
    return handleProjectGraphSearch;
  }
  if (req.method === "GET" && pathname === "/project/tree") {
    return handleProjectTree;
  }
  if (req.method === "POST" && pathname === "/project/search") {
    return handleProjectSearch;
  }
  if (req.method === "GET" && pathname === "/project/analysis") {
    return async (_req, res) => {
      try {
        const analysis = await analyzeProject(REPO_ROOT);
        sendJson(res, 200, { ok: true, analysis });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { ok: false, error: { message, code: "ANALYSIS_FAILED" } });
      }
    };
  }
  if (req.method === "GET" && pathname === "/fs/list") {
    return handleFsList;
  }
  if (req.method === "GET" && pathname === "/fs/read") {
    return handleFsRead;
  }
  if (req.method === "GET" && pathname === "/fs/search") {
    return handleFsSearch;
  }
  if (req.method === "POST" && pathname === "/checks/run") {
    return handleRunChecks;
  }
  if (req.method === "POST" && pathname === "/planning/draft-session") {
    return handleDraftSession;
  }

  if (req.method === "POST" && pathname === "/sessions/run") {
    return handleRunSessionById;
  }

  if (req.method === "POST" && pathname === "/run-session") {
    return handleRunSession;
  }

  if (req.method === "POST" && pathname === "/run-task") {
    return handleRunTask;
  }
  if (req.method === "POST" && pathname === "/tasks/run-single") {
    return handleRunSingleEdit;
  }

  if (req.method === "POST" && pathname === "/deploy/run") {
    return handleRunDeploy;
  }
  if (req.method === "POST" && pathname === "/plans/run") {
    return handleRunPlan;
  }
  if (req.method === "POST" && pathname === "/plans/generate") {
    return handleGeneratePlan;
  }
  if (req.method === "GET" && pathname === "/plans/list") {
    return handleListPlans;
  }
  if (req.method === "POST" && pathname === "/reason/run") {
    return async (reqInner, resInner) => {
      try {
        const body = await parseJsonBody<{
          taskDescription?: string;
          projectRoot?: string;
          writeMode?: ApplyMode;
          safetyLevel?: SafetyLevel;
        }>(
          reqInner
        );
        if (!body.taskDescription) {
          sendJson(resInner, 400, { ok: false, error: { message: "taskDescription required", code: "BAD_REQUEST" } });
          return;
        }
        const projectRoot = resolveProjectRoot(body.projectRoot);
        const reasoning = await runReasoningEngine(projectRoot, body.taskDescription, {
          apply: body.writeMode === "apply",
          safetyLevel: body.safetyLevel,
        });
        sendJson(resInner, 200, { ok: true, reasoning });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(resInner, 500, { ok: false, error: { message, code: "REASON_RUN_FAILED" } });
      }
    };
  }
  if (req.method === "POST" && pathname === "/features/run") {
    return async (reqInner, resInner) => {
      try {
        const body = await parseJsonBody<{
          description?: string;
          projectRoot?: string;
          writeMode?: ApplyMode;
          safetyLevel?: SafetyLevel;
          allowDirty?: boolean;
          git?: import("./devTaskTypes").GitOptions;
        }>(reqInner);
        if (!body.description || typeof body.description !== "string") {
          sendJson(resInner, 400, { ok: false, error: { message: "description is required", code: "BAD_REQUEST" } });
          return;
        }
        const writeMode: ApplyMode = body.writeMode === "apply" ? "apply" : "preview";
        const safety: SafetyLevel = body.safetyLevel === "strict" ? "strict" : "basic";
        const projectRoot = resolveProjectRoot(body.projectRoot);
        const allowDirty = body.allowDirty === true || writeMode === "preview";
        const git = body.git
          ? {
              enabled: body.git.enabled === true,
              branchStrategy: body.git.branchStrategy || "current",
              targetBranch: body.git.targetBranch,
              autoCommit: body.git.autoCommit === true,
              commitMessageTemplate: body.git.commitMessageTemplate,
              branchMode: body.git.branchMode || "none",
              commitMode: body.git.commitMode || "none",
              baseBranch: body.git.baseBranch || "main",
              branchPrefix: body.git.branchPrefix || "feature/",
              push: body.git.push === true,
            }
          : undefined;
        await ensureCleanGitWorkingTree(projectRoot, { allowDirty });
        const feature = await runFeature({
          description: body.description,
          projectRoot,
          writeMode,
          safetyLevel: safety,
          git,
        });
        sendJson(resInner, 200, {
          ok: true,
          writeMode,
          safetyLevel: safety,
          feature,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error("[ElyraAgent] Feature run failed:", error);
        sendJson(resInner, 500, { ok: false, error: { message, code: "FEATURE_RUN_FAILED" } });
      }
    };
  }
  if (req.method === "POST" && pathname === "/dev-loop/run") {
    return async (reqInner, resInner) => {
      try {
        const body = await parseJsonBody<{
          requestText?: string;
          projectRoot?: string;
          previewOnly?: boolean;
          safetyLevel?: SafetyLevel;
        }>(reqInner);
        if (!body.requestText || typeof body.requestText !== "string") {
          sendJson(resInner, 400, { ok: false, error: { message: "requestText is required", code: "BAD_REQUEST" } });
          return;
        }
        const projectRoot = resolveProjectRoot(body.projectRoot);
        const result = await runDevLoop({
          requestText: body.requestText,
          projectRoot,
          previewOnly: body.previewOnly,
          safetyLevel: body.safetyLevel,
        });
        sendJson(resInner, 200, { ok: true, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(resInner, 500, { ok: false, error: { message, code: "DEV_LOOP_FAILED" } });
      }
    };
  }

  if (req.method === "GET" && pathname === "/backups") {
    return handleListBackups;
  }

  if (req.method === "POST" && pathname === "/backups/restore") {
    return handleRestoreBackup;
  }

  return undefined;
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { ok: false, error: { message: "Invalid request", code: "BAD_REQUEST" } });
    return;
  }

  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  log.info("Incoming request:", req.method, req.url);

  if (!validateAuth(req, res)) return;

  const handler = routeRequest(req);
  if (!handler) {
    sendJson(res, 404, { ok: false, error: { message: "Not found", code: "NOT_FOUND" } });
    return;
  }

  try {
    await handler(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error("Unhandled error:", error);
    sendJson(res, 500, { ok: false, error: { message, code: "INTERNAL_ERROR", stack } });
  }
});

server.listen(PORT, HOST, () => {
  log.info(
    `Elyra agent listening on http://${HOST}:${PORT} (projectRoot=${REPO_ROOT})`
  );
});
