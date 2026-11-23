import { type CodingSkill } from "@/types/taskContract";

export type RunPhase = "idle" | "planning" | "executing" | "done" | "error";

export type PlanStep = {
  step: number;
  title: string;
  tool: string;
  description: string;
};

export type PlanArtifact = {
  runId: string;
  skill: CodingSkill;
  task: string;
  repoUrl: string;
  branch: string;
  status: string;
  plan: {
    summary: string;
    steps: PlanStep[];
    estimatedMinutes: number;
    toolsRequired: string[];
    allowedCommands: string[];
  };
  safetyPolicy: {
    networkDisabled: boolean;
    noAutoMerge: boolean;
    requiresApprovalBefore: string[];
    maxIterations: number;
  };
};

export type FileChanged = { path: string; linesAdded: number; linesRemoved: number };
export type ReviewFinding = {
  title: string;
  priority: "P1" | "P2" | "P3";
  file?: string;
  issue: string;
  recommendation: string;
};

export type InvestigatorLogEntry = {
  kind: "thinking" | "tool" | "status" | "plain";
  title: string;
  detail?: string;
  /** Stable ID used as React key — prevents uncontrolled <details> from being
   *  re-mounted on every liveRunEvents update, which would reset open state. */
  id?: string;
};

export type ResultArtifact = {
  status: string;
  skill: CodingSkill;
  task: string;
  summary: string;
  executionApplied?: boolean;
  findings?: ReviewFinding[];
  nextSteps?: string[];
  executionLog?: string[];
  previewUrl?: string;
  commitOutput?: string;
  filesChanged: FileChanged[];
  diff: string;
  testReport: {
    passed: number;
    failed: number;
    skipped: number;
    duration: string;
    output: string;
  };
  buildReport: { success: boolean; warnings: number; output: string };
  gates?: Array<{
    gate: "lint" | "typecheck" | "tests" | "build" | "perf" | "a11y" | "visual";
    status: "passed" | "failed" | "skipped";
    command?: string;
    output: string;
    attempts: number;
    required: boolean;
  }>;
  workflow?: {
    current: string;
    history: Array<{ state: string; at: string; note?: string }>;
  };
  telemetry?: {
    provider: string;
    model: string;
    estimatedTokens: number;
    estimatedInputTokens?: number;
    modelInputLimit?: number;
    contextCompressionMode?: "full" | "reduced" | "minimal";
    budgetStatus?: "ok" | "warning" | "over";
    estimatedCostUsd: number;
    fallbackUsed: boolean;
    replayId: string;
  };
  designDraft?: {
    url?: string;
    provider?: "figma" | "google_stitch" | "banana2" | null;
    detected?: boolean;
    detectedFrom?: "field" | "task" | "none";
    approved?: boolean;
  };
  missionBrief?: {
    objective: string;
    stage: PromotionStage;
    budgetUsd: number | null;
    deadlineMinutes: number | null;
    supervisorPlan: {
      totalAgents: number;
      plan: Array<{ role: AgentRole; count: number; focus: string }>;
    };
    compliance: {
      requiresHumanApproval: boolean;
      issues: string[];
    };
  };
  artifacts?: Array<{
    id: string;
    type: string;
    title: string;
    version: number;
    provenance?: { provider?: string; agentRole?: string; createdAt?: string; source?: string };
  }>;
  requiresApproval: boolean;
  approvalActions: string[];
};

export type ProviderStatus = {
  label: string;
  configured: boolean;
  model: string;
  issues?: string[];
  capabilities?: {
    supportsReasoning?: boolean;
    supportsToolCalls?: boolean;
    supportsImages?: boolean;
    supportsCodePatch?: boolean;
    supportsLongContext?: boolean;
  };
};

export type LiveRunEvent = {
  id: string;
  type: string;
  at?: string;
  summary: string;
  detail?: string;
};

export type ProviderStatusMap = Record<string, ProviderStatus>;
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type SkillInfo = {
  id: CodingSkill;
  name: string;
  description: string;
};

export type RepoOption = {
  id: string;
  label: string;
  value: string;
  source: "local" | "github";
};

export type FolderOption = {
  label: string;
  value: string;
};

export type FileOption = {
  label: string;
  value: string;
};

export type SuggestedScope = {
  reason: string;
  files: string[];
};

export type AttachmentDraft = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};



export type CenterTab = "chat" | "plan" | "logs" | "diff";
export type PromotionStage = "playground" | "dev" | "prod";
export type AgentRole = "general" | "frontend" | "backend" | "ui" | "infra" | "qa";
export type ExecutionMode = "strict" | "adaptive";
export type TeamMode = "auto" | "manual";
export type TeamConfig = Record<AgentRole, number>;
export type LocalRunStatus = "planning" | "running" | "failed" | "completed";
export type LocalAgentRunRecord = {
  id: string;
  app: "code" | "orchestrator";
  agent: string;
  task: string;
  repoUrl: string;
  branch: string;
  workspaceId: string;
  stage: PromotionStage;
  status: LocalRunStatus;
  startedAt: number;
  updatedAt: number;
  folderPath?: string;
  selectedFiles?: string[];
  skill?: CodingSkill;
  summary?: string;
  previewUrl?: string;
  filesChanged?: number;
  estimatedCostUsd?: number;
  replayId?: string;
  gateFailures?: number;
};
export type QueuedAgentTask = {
  id: string;
  role: AgentRole;
  skill: CodingSkill;
  task: string;
  repoUrl: string;
  branch: string;
  folderPath: string;
  selectedFiles: string[];
  stage: PromotionStage;
  terminalAccess: boolean;
  useReasoning: boolean;
  branchPerAgent: boolean;
  executionMode: ExecutionMode;
  vibeCoding: boolean;
  teamMode: TeamMode;
  teamConfig: TeamConfig;
  budgetUsd: number;
  deadlineMinutes: number;
  createdAt: number;
};
export type PlaygroundVersion = {
  commit: string;
  timestamp: number;
  message: string;
};
export type PromotionAuditRecord = {
  id: string;
  workspaceId: string;
  runId?: string;
  fromStage: PromotionStage;
  toStage: PromotionStage | "main";
  status: "started" | "completed" | "failed";
  summary?: string;
  filesChanged?: number;
  replayId?: string;
  branch?: string;
  repoUrl?: string;
  prUrl?: string;
  createdAt: string;
};

export type ContractDeliverable = {
  id: string;
  label: string;
  ownerRole: AgentRole;
};

export type ExecutionContract = {
  id: string;
  objective: string;
  mode: "product_build" | "company_launch";
  assumptions: string[];
  team: Array<{ role: AgentRole; count: number; focus: string }>;
  deliverables: ContractDeliverable[];
  risks: string[];
  gates: string[];
  estimatedMinutes: number;
};

/** Tool names available to the autonomous agentic loop in code/run/route.ts. */
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "run_command"
  | "search_files"
  | "task_complete";


