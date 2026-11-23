/**
 * Coding agent – Shared types for the coding agent.
 * Extracted from app/api/os/code/run/route.ts (behaviour unchanged).
 */
import type { AgentRole } from "@/types/agent";
import type { getProviderStatuses, ProviderId } from "@/lib/orb-os/providers/providerRouter";

// ── Types ──────────────────────────────────────────────────────────────────────

// AgentRole and TeamMode are imported from @/types/agent (shared contract).
export type TeamConfig = Partial<Record<AgentRole, number>>;

export type ToolAllowlistEntry = { cmd: string; description: string };
export type JsonRecord = Record<string, unknown>;
export type CodeProviderStatusMap = ReturnType<typeof getProviderStatuses>;
export type CodeProviderStatus = CodeProviderStatusMap[ProviderId];
type GeminiPart = { text: string };
type GeminiInlinePart = { inlineData: { mimeType: string; data: string } };
export type GeminiInputPart = GeminiPart | GeminiInlinePart;
type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
export type GeminiResponse = {
  candidates?: GeminiCandidate[];
  error?: { message?: string; code?: number };
};
export type RepoSampleFile = { path: string; excerpt: string };
export type RunAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string;
  sizeBytes?: number;
};
export type ReviewFinding = {
  title: string;
  priority: "P1" | "P2" | "P3";
  file?: string;
  issue: string;
  recommendation: string;
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
export type RepoSnapshot = {
  repoRoot: string;
  scanRoot: string;
  fileCount: number;
  files: string[];
  sampledFiles: RepoSampleFile[];
  truncated: boolean;
  source?: "local" | "github";
};

export type ExecutionOutcome = {
  applied: boolean;
  applyOutput: string;
  workflow?: {
    current: "planned" | "approved" | "running" | "gated" | "rolled_back" | "promoted" | "failed";
    history: Array<{ state: string; at: string; note?: string }>;
  } | undefined;
  gates?: GateReport[] | undefined;
  testReport: { passed: number; failed: number; skipped: number; duration: string; output: string };
  buildReport: { success: boolean; warnings: number; output: string };
  executionLog: string[];
  previewUrl?: string | undefined;
  commitOutput?: string | undefined;
  appliedDiff?: string | undefined;
  appliedFiles?: string[] | undefined;
};

export type DirectEditPlan = {
  file: string;
  before: string;
  after: string;
  summary?: string;
  diagnosis?: string;
  relatedFilesChecked?: string[];
};
export type ScopedFileSnapshot = {
  file: string;
  content: string;
};
export type WorkspaceBrainProfile = Record<string, unknown>;
export type WorkspaceMemoryEntry = {
  id?: string;
  type?: string;
  content?: string;
  confidence?: number;
  created_at?: number;
  updated_at?: number;
};
export type LocalAgentRequestMode = "fix" | "feature" | "refactor" | "tests";
export type GateReport = {
  gate: "lint" | "typecheck" | "tests" | "build" | "perf" | "a11y" | "visual";
  status: "passed" | "failed" | "skipped";
  command?: string;
  output: string;
  attempts: number;
  required: boolean;
};
