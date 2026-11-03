export type DevTaskMode = "refactor" | "fix" | "feature" | "tests" | "docs" | "mini" | "fast";
export type ApplyMode = "apply" | "preview";
export type WriteMode = "apply" | "preview";
export type SafetyLevel = "none" | "basic" | "strict";
export type CheckKind = "lint" | "test" | "build" | "typecheck" | "custom";
export type RiskLevel = "low" | "medium" | "high" | "unknown";
export type FeatureWriteMode = WriteMode | "none";

export interface DevTaskTarget {
  file: string; // relativer Pfad ab Projekt-Root, z.B. "frontend/lib/utils/error.ts"
  startLine?: number; // optional, 1-basiert
  endLine?: number; // optional, 1-basiert
}

export interface CheckDefinition {
  kind: CheckKind;
  name: string;
  command: string;
  cwd: string;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface CheckResult {
  kind: CheckKind;
  name: string;
  command: string;
  cwd: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped" | "error";
  exitCode: number | null;
  durationMs: number | null;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  errorMessage?: string;
}

export interface DevTaskConfig {
  id: string;
  goal: string; // kurze Beschreibung, was getan werden soll
  mode: DevTaskMode;
  projectRoot: string; // absoluter Pfad zum Projekt-Root
  target: DevTaskTarget;
  applyMode?: ApplyMode;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
}

export type DevTaskInput = DevTaskConfig;
export type DevTask = DevTaskConfig;

export type DevTaskStatus = "pending" | "running" | "done" | "failed";

export interface FeaturePlanInput {
  id: string;
  featureName: string;
  description: string;
  projectRoot: string;
  defaultMode?: DevTaskMode;
  writeMode?: FeatureWriteMode;
  safetyLevel?: SafetyLevel;
}

export interface FeaturePlanStep {
  id: string;
  title?: string;
  description?: string;
  targetFile?: string;
  mode?: DevTaskMode;
  estimatedRisk?: RiskLevel;
  // Extended fields for Feature Builder
  label?: string;
  kind?: FeaturePlanStepKind;
  targetFiles?: string[];
  sessionConfig?: FeaturePlanStepSessionConfig;
  status?: "pending" | "running" | "done" | "failed";
  error?: string;
}

export interface FeaturePlanResult {
  featureId: string;
  featureName: string;
  description: string;
  steps: FeaturePlanStep[];
  createdAt: string;
}

export interface PreviewChange {
  file: string;
  before: string;
  after: string;
}

export interface DevTaskBackupInfo {
  id: string;
  rootDir: string;
  files: string[];
}

export interface DevTaskResult {
  id: string;
  status: DevTaskStatus;
  errorMessage?: string;
  appliedMode?: ApplyMode;
  previewChanges?: PreviewChange[];
  file?: string;
  mode?: DevTaskMode;
  writeMode?: WriteMode;
  applied?: boolean;
  originalCode?: string;
  updatedCode?: string;
  safetyLevel?: SafetyLevel;
  diff?: string;
  diffSummary?: string;
  summary?: string;
  blocked?: boolean;
  blockedReason?: string;
  checks?: CheckResult[];
  riskLevel?: RiskLevel;
  riskReason?: string;
  changedLines?: number;
  changeRatio?: number;
  backup?: DevTaskBackupInfo | null;
}

export type DeployCommand = {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  critical?: boolean;
};

export type DeployConfig = {
  id: string;
  projectRoot: string;
  preDeployCommands: DeployCommand[];
  deployCommands: DeployCommand[];
};

export type DeployStepResult = {
  id: string;
  label: string;
  command: string;
  cwd: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
};

export type DeployRunResult = {
  configId: string;
  projectRoot: string;
  preDeploy: DeployStepResult[];
  deploy: DeployStepResult[];
  ok: boolean;
  blockedBy?: string;
};

export type BranchingOptions = {
  autoBranch?: boolean;
  prDraft?: boolean;
  baseBranch?: string;
};

export type SessionGitMode = "none" | "branch";

export interface SessionGitConfig {
  mode?: SessionGitMode;
  baseBranch?: string;
  branchPrefix?: string;
  branchName?: string;
  autoCommit?: boolean;
  commitMessageTemplate?: string;
}

export interface SessionGitInfo {
  baseBranch: string;
  featureBranch?: string;
  commitHash?: string;
}

export type GitBranchStrategy = "current" | "new-from-main" | "explicit";
export type GitBranchMode = "none" | "feature-branch" | "feature" | "custom";
export type GitCommitMode = "none" | "single" | "per-step";

export interface GitOptions {
  enabled?: boolean;
  branchStrategy?: GitBranchStrategy;
  targetBranch?: string;
  baseBranch?: string;
  autoCommit?: boolean;
  commitMessageTemplate?: string;
  branchMode?: GitBranchMode;
  commitMode?: GitCommitMode;
  branchPrefix?: string;
  push?: boolean;
}

export type GitBranchModeV2 = "none" | "feature" | "custom";

export interface GitAutoCommitOptions {
  enable: boolean;
  branchMode?: GitBranchModeV2;
  featureId?: string;
  customBranchName?: string;
  commitMessage?: string;
  tagName?: string | null;
  tagMessage?: string | null;
  baseBranch?: string;
}

export interface GitRunContext {
  repoRoot: string;
  branch?: string | null;
  commitSha?: string | null;
  commitCreated?: boolean;
  tag?: string | null;
  branchBefore?: string | null;
  branchAfter?: string | null;
  createdBranch?: boolean;
  autoCommit?: boolean;
}

export interface GitResult {
  usedBranch?: string;
  createdBranch?: boolean;
  commitCreated?: boolean;
  commitHash?: string | null;
  commitMessage?: string | null;
  error?: string | null;
  branchBefore?: string | null;
  branchAfter?: string | null;
  autoCommit?: boolean;
  autoCommitEnabled?: boolean;
  tag?: string | null;
}

export type FeatureRunGitContext = {
  featureId: string;
  branchName?: string;
  baseBranch: string;
  commits: Array<{
    stepId: string;
    commitSha?: string;
    message: string;
    files: string[];
  }>;
};

export interface SessionBackupInfo {
  backups: DevTaskBackupInfo[];
}

export type FailureReason =
  | "ts-error"
  | "test-failed"
  | "safety-violation"
  | "runtime-check-failed"
  | "unknown";

export interface RollbackInfo {
  attempted: boolean;
  succeeded: boolean;
  reason?: FailureReason;
  details?: string;
}

// Feature builder types
export interface FeatureSpec {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  risks?: string[];
  dependencies?: string[];
  notes?: string[];
}

export type FeaturePlanStepKind = "analysis" | "plan" | "code" | "test" | "docs" | "cleanup";

export interface FeaturePlanStepSessionConfig {
  id: string;
  projectRoot: string;
  mode: DevTaskMode;
  target: { file?: string; glob?: string };
  goal: string;
}

export interface FeaturePlan {
  featureId: string;
  spec: FeatureSpec;
  steps: FeaturePlanStep[];
}

// Planner / Autoplan types
export type PlanScope = "frontend" | "backend" | "worker" | "fullstack";

export interface PlanInput {
  featureId: string;
  description: string;
  scope?: PlanScope;
}

export interface PlanFileImpact {
  filePath: string;
  reason: string;
  kind: "create" | "update" | "inspect";
  confidence: "low" | "medium" | "high";
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  files: PlanFileImpact[];
  dependsOn: string[];
}

export interface DevTaskSuggestion {
  id: string;
  title: string;
  mode: DevTaskMode | "docs" | "tests";
  targetFiles: string[];
  goal: string;
  suggestedSessionId?: string;
}

export interface PlanResult {
  featureId: string;
  createdAt: string;
  scope: PlanScope;
  steps: PlanStep[];
  tasks: DevTaskSuggestion[];
  relatedFiles: string[];
  graphSummary: {
    inspectedFiles: number;
    matchedFiles: number;
    matchedSymbols: number;
  };
}

export interface AutoplanMaterializeInput {
  projectRoot: string;
  plan: PlanResult;
  baseDir?: string;
  writeMode?: WriteMode;
}

export interface GeneratedTaskFile {
  taskId: string;
  filePath: string;
}

export interface GeneratedSessionFile {
  sessionId: string;
  filePath: string;
}

export interface MaterializedSessionTask {
  id: string;
  goal: string;
  mode: DevTaskMode;
  target: DevTaskTarget;
}

export interface MaterializedSessionConfig {
  id: string;
  projectRoot: string;
  tasks: MaterializedSessionTask[];
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
  label?: string;
}

export interface MaterializePreview {
  tasks: DevTaskConfig[];
  session: MaterializedSessionConfig;
}

export interface MaterializeResult {
  writeMode: WriteMode;
  preview: MaterializePreview;
  writtenTaskFiles: GeneratedTaskFile[];
  writtenSessionFile?: GeneratedSessionFile;
}

export interface FeatureExecutionResult {
  featureId: string;
  plan: FeaturePlan;
  stepResults: Array<{
    stepId: string;
    status: "done" | "failed" | "skipped";
    sessionId?: string;
    sessionResult?: unknown;
  }>;
  tests?: {
    run: boolean;
    commands: string[];
    passed: boolean;
    errors: string[];
  };
  overallStatus: "success" | "partial" | "failed";
  summary: string;
  git?: FeatureRunGitContext;
}

export interface PreApplyCheckConfig {
  build?: boolean;
  types?: boolean;
  tests?: boolean;
}

export interface PreApplyCheckResult {
  ok: boolean;
  buildOutput?: string;
  typeOutput?: string;
  testOutput?: string;
}

export interface SessionReportMeta {
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  projectRoot: string;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
}

export interface TaskReportItem {
  id: string;
  mode: DevTaskMode;
  file: string;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
  status: DevTaskStatus;
  summary?: string;
  diffSummary?: string;
  testsBefore?: TestCommandResult[];
  testsAfter?: TestCommandResult[];
  testsBlockedApply?: boolean;
  blockedReason?: string;
}

export interface SessionReport {
  meta: SessionReportMeta;
  tasks: TaskReportItem[];
  testsBeforeAll?: TestCommandResult[];
  testsAfterAll?: TestCommandResult[];
  overallSummary?: string;
}

export interface TestCommandResult {
  id?: string;
  kind?: CheckKind | string;
  command?: string;
  cwd?: string;
  status?: "passed" | "failed" | "skipped" | "error" | "running" | "pending";
  exitCode?: number | null;
  durationMs?: number | null;
  stdoutSnippet?: string;
  stderrSnippet?: string;
}

export interface RepoOverview {
  projectRoot: string;
  files: string[];
  snippets?: Array<{ file: string; content: string }>;
}

export interface SessionTaskResult {
  id: string;
  file: string;
  mode: string;
  status: "done" | "skipped" | "failed";
  summary?: string;
  diffStat?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  errorMessage?: string | null;
}

export interface IncidentWebhookConfig {
  url: string;
  secretHeaderName?: string;
  secretHeaderValue?: string;
  onlyOnFailure?: boolean;
}

export interface PlannedTask {
  id: string;
  file: string;
  goal: string;
  mode: DevTaskMode;
}

export interface PlannedSessionDefaults {
  mode?: DevTaskMode;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
}

export interface PlannedSessionConfig {
  sessionId: string;
  projectRoot: string;
  defaults?: PlannedSessionDefaults;
  tasks: PlannedTask[];
}

export type EditRunMode = "preview" | "apply";
export type EditSafetyLevel = SafetyLevel | "basic" | "strict";

export interface SingleEditRunOptions {
  writeMode?: EditRunMode;
  safetyLevel?: EditSafetyLevel;
  allowDirty?: boolean;
}

export interface SingleEditTaskResult extends DevTaskResult {
  originalContentHash?: string;
  newContentHash?: string;
  diffSummary?: string;
}

export interface CommandResult {
  name?: string;
  cmd: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export type ShellCheckConfig = {
  id: string;
  label?: string;
  cwd?: string;
  command: string;
  continueOnFail?: boolean;
};

export type PlanStepType = "session" | "check";

export type SessionStepConfig = {
  type: "session";
  id: string;
  label?: string;
  sessionConfigPath: string;
};

export type CheckStepConfig = {
  type: "check";
  id: string;
  label?: string;
  check: ShellCheckConfig;
};

export type PlanStepConfig = SessionStepConfig | CheckStepConfig;

export type DevPlanConfig = {
  id: string;
  label?: string;
  projectRoot?: string;
  git?: GitOptions;
  writeMode?: WriteMode;
  safetyLevel?: SafetyLevel;
  steps: PlanStepConfig[];
};

export type ShellCheckResult = {
  id: string;
  label?: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
};

export type PlanStepResult =
  | {
      type: "session";
      id: string;
      label?: string;
      sessionConfigPath: string;
      sessionResult: import("./sessionRunner").SessionRunResult;
    }
  | {
      type: "check";
      id: string;
      label?: string;
      checkResult: ShellCheckResult;
    };

export type DevPlanResult = {
  id: string;
  label?: string;
  projectRoot: string;
  steps: PlanStepResult[];
  git?: import("./sessionRunner").SessionRunResult["git"];
  startedAt: string;
  finishedAt: string;
  success: boolean;
  rollback?: RollbackInfo;
};
