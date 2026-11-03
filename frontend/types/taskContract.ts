export type CodingSkill =
  | "fix-build"
  | "implement-feature"
  | "refactor-module"
  | "write-tests"
  | "review-code"
  | "add-types"
  | "ux-ui-design"
  // ── Extended skills — provider-agnostic, route via resolveVibeProvider ──
  | "security-scan"   // Security audit: auth, injection, secrets — Claude preferred
  | "tdd-guide"       // Test-first development (RED→GREEN→REFACTOR) — Claude preferred
  | "db-review"       // Database/Supabase schema, indexes, RLS, N+1 — Gemini preferred
  | "perf-audit"      // Bundle size, Core Web Vitals, React renders — Gemini preferred
  | "api-design"      // REST/OpenAPI contract design, versioning — Claude preferred
  | "code-explain"    // Explain code without changes (educational) — any provider
  | "custom";

export const CODING_SKILLS: Array<{ id: CodingSkill; name: string; description: string }> = [
  { id: "fix-build", name: "Fix Build", description: "Find and fix build/compile errors." },
  { id: "implement-feature", name: "Implement Feature", description: "Add a feature based on a task description." },
  { id: "refactor-module", name: "Refactor Module", description: "Improve code quality without changing behaviour." },
  { id: "write-tests", name: "Write Tests", description: "Generate unit/integration tests." },
  { id: "review-code", name: "Review Code", description: "Scan the repo and suggest improvements only." },
  { id: "add-types", name: "Add Types", description: "Add TypeScript types and fix any/unknown." },
  { id: "ux-ui-design", name: "UX/UI Design", description: "Implement high-quality UI redesign tasks with design-tool context." },
  { id: "security-scan", name: "Security Scan", description: "Security audit: auth, injection, secrets." },
  { id: "tdd-guide", name: "TDD Guide", description: "Test-first development (RED→GREEN→REFACTOR)." },
  { id: "db-review", name: "DB Review", description: "Database/Supabase schema, indexes, RLS, N+1." },
  { id: "perf-audit", name: "Perf Audit", description: "Bundle size, Core Web Vitals, React renders." },
  { id: "api-design", name: "API Design", description: "REST/OpenAPI contract design, versioning." },
  { id: "code-explain", name: "Explain Code", description: "Explain code without changes (educational)." },
  { id: "custom", name: "Custom Task", description: "Any coding task described in natural language." },
];

export type ExecutorType = "code" | "mail" | "calendar" | "tasks" | "workflow";

export type TaskContractScope = {
  workspaceId?: string;
  repoUrl?: string;
  branch?: string;
  folderPath?: string;
  selectedFiles?: string[];
};

export type TaskContractConstraints = {
  stage?: "playground" | "dev" | "prod";
  terminalAccess?: boolean;
  useReasoning?: boolean;
  autoCommit?: boolean;
  executionMode?: "strict" | "adaptive";
  provider?: string;
  agentRole?: "general" | "frontend" | "backend" | "ui" | "infra" | "qa";
  branchPerAgent?: boolean;
  agentBranchName?: string;
  budgetUsd?: number;
  deadlineMinutes?: number;
};

export type TaskContract = {
  id: string;
  executorType: ExecutorType;
  title: string;
  goal: string;
  summary?: string;
  scope: TaskContractScope;
  constraints: TaskContractConstraints;
  definitionOfDone: string[];
  verification: string[];
  source: "chief_orchestrator" | "manual";
  createdAt: string;
};

export type CodeTaskContract = TaskContract & {
  executorType: "code";
};

export type ToolTaskContract = TaskContract & {
  executorType: "mail" | "calendar" | "tasks" | "workflow";
  action: {
    actionId: string;
    actionLabel: string;
    toolName: string;
    args: Record<string, unknown>;
  };
};

export type AnyTaskContract = CodeTaskContract | ToolTaskContract;
