import type { AppId } from "./kernel.js";

export type RunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type Run = {
  id: string;
  workspaceId: string;
  userId: string;
  prompt: string;
  status: RunStatus;
  planSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunStep = {
  id: string;
  runId: string;
  index: number;
  toolName: string;
  label: string;
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  requiresApproval: boolean;
  createdAt: string;
  completedAt: string | null;
};

export type ToolCall = {
  id: string;
  stepId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  createdAt: string;
};

export type UsageDaily = {
  workspaceId: string;
  date: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type ActionCard = {
  id: string;
  title: string;
  detail: string;
  openApp?: AppId;
};
