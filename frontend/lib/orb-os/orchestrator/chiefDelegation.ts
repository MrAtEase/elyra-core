import { randomUUID } from "crypto";
import type { ExecutorType, TaskContract, ToolTaskContract } from "@/types/taskContract";
import type { OrchestratorStep } from "@/components/orchestrator/OrchestratorPanel";
import { isCodeIntent } from "@/lib/orb-os/orchestrator/chiefCode";

export type ChiefExecutorType = ExecutorType | "unknown";

const MAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function trimIntentPrefix(intent: string): string {
  return intent.trim().replace(/^\/(email|mail|calendar|task|tasks|build)\s+/i, "").trim();
}

function deriveTitle(intent: string, fallback: string): string {
  const normalized = trimIntentPrefix(intent).replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.slice(0, 120);
}

function extractEmails(intent: string): string[] {
  return Array.from(new Set(intent.match(MAIL_RE) ?? []));
}

function isTaskListIntent(normalized: string): boolean {
  return ["show task", "show tasks", "list task", "list tasks", "open tasks", "offene aufgaben", "my tasks", "meine tasks", "meine aufgaben"].some((token) => normalized.includes(token));
}

export function detectChiefExecutorType(intent: string): ChiefExecutorType {
  const normalized = intent.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (isCodeIntent(intent)) return "code";
  if (normalized.startsWith("/email") || normalized.startsWith("/mail") || normalized.includes("e-mail") || normalized.includes("email") || normalized.includes("mail")) return "mail";
  if (normalized.startsWith("/calendar") || normalized.includes("calendar") || normalized.includes("kalender") || normalized.includes("meeting") || normalized.includes("woche") || normalized.includes("schedule")) return "calendar";
  if (normalized.startsWith("/task") || normalized.startsWith("/tasks") || normalized.includes("task") || normalized.includes("aufgabe") || normalized.includes("todo")) return "tasks";
  if (normalized.includes("workflow") || normalized.includes("automation") || normalized.includes("automatis")) return "workflow";
  return "unknown";
}

export function buildToolTaskContract(input: {
  workspaceId: string;
  executorType: Exclude<ExecutorType, "code">;
  intent: string;
  workspaceBrainProfile?: Record<string, unknown> | null;
}): ToolTaskContract {
  const mission = typeof input.workspaceBrainProfile?.mission === "string" ? input.workspaceBrainProfile.mission.trim() : "";
  const goal = typeof input.workspaceBrainProfile?.goal === "string" ? input.workspaceBrainProfile.goal.trim() : "";
  const summaryParts = [mission, goal].filter(Boolean);
  const normalized = trimIntentPrefix(input.intent).toLowerCase();

  if (input.executorType === "mail") {
    const to = extractEmails(input.intent);
    const subject = deriveTitle(input.intent, "Draft from Elly");
    return {
      id: `contract-${randomUUID()}`,
      executorType: "mail",
      title: `Draft mail: ${subject}`,
      goal: input.intent,
      ...(summaryParts.length > 0 ? { summary: `Workspace context: ${summaryParts.join(" | ")}` } : {}),
      scope: { workspaceId: input.workspaceId },
      constraints: {},
      definitionOfDone: [
        "Create a reusable email draft from the current intent.",
        "Do not send the email automatically.",
        "Return a draft result or an explicit auth/approval requirement.",
      ],
      verification: [
        "Keep the action in draft mode.",
        "Report auth or approval requirements instead of pretending success.",
      ],
      source: "chief_orchestrator",
      createdAt: new Date().toISOString(),
      action: {
        actionId: "mail-draft",
        actionLabel: "Draft Mail",
        toolName: "google_mail.draft_reply",
        args: {
          subject,
          to,
          instruction: trimIntentPrefix(input.intent),
        },
      },
    };
  }

  if (input.executorType === "calendar") {
    const title = deriveTitle(input.intent, "Planned with Elly");
    return {
      id: `contract-${randomUUID()}`,
      executorType: "calendar",
      title: `Calendar action: ${title}`,
      goal: input.intent,
      ...(summaryParts.length > 0 ? { summary: `Workspace context: ${summaryParts.join(" | ")}` } : {}),
      scope: { workspaceId: input.workspaceId },
      constraints: {},
      definitionOfDone: [
        "Create a concrete calendar event proposal from the current intent.",
        "Keep the event metadata readable and explicit.",
        "Return success, auth, or approval status honestly.",
      ],
      verification: [
        "Create an event artifact or show why creation is blocked.",
        "Do not hide missing auth or approval requirements.",
      ],
      source: "chief_orchestrator",
      createdAt: new Date().toISOString(),
      action: {
        actionId: "calendar-create-event",
        actionLabel: "Create Event",
        toolName: "google_calendar.create_event",
        args: {
          title,
          description: trimIntentPrefix(input.intent),
        },
      },
    };
  }

  if (input.executorType === "tasks") {
    const listMode = isTaskListIntent(normalized);
    return {
      id: `contract-${randomUUID()}`,
      executorType: "tasks",
      title: listMode ? "Review open tasks" : `Create task: ${deriveTitle(input.intent, "New task")}`,
      goal: input.intent,
      ...(summaryParts.length > 0 ? { summary: `Workspace context: ${summaryParts.join(" | ")}` } : {}),
      scope: { workspaceId: input.workspaceId },
      constraints: {},
      definitionOfDone: listMode
        ? [
            "Return the relevant open tasks for the current workspace context.",
            "Keep the result scoped to task review.",
          ]
        : [
            "Create a task derived from the current intent.",
            "Keep priority explicit and default to moderate urgency unless specified.",
          ],
      verification: ["Return the task result or an explicit execution failure."],
      source: "chief_orchestrator",
      createdAt: new Date().toISOString(),
      action: listMode
        ? {
            actionId: "tasks-list",
            actionLabel: "List Tasks",
            toolName: "tasks.list",
            args: { status: "open" },
          }
        : {
            actionId: "tasks-create",
            actionLabel: "Create Task",
            toolName: "tasks.create",
            args: {
              title: deriveTitle(input.intent, "New task"),
              priority: "p2",
            },
          },
    };
  }

  return {
    id: `contract-${randomUUID()}`,
    executorType: "workflow",
    title: `Workflow request: ${deriveTitle(input.intent, "Workflow")}`,
    goal: input.intent,
    ...(summaryParts.length > 0 ? { summary: `Workspace context: ${summaryParts.join(" | ")}` } : {}),
    scope: { workspaceId: input.workspaceId },
    constraints: {},
    definitionOfDone: ["Convert the workflow intent into an actionable next step."],
    verification: ["Report unsupported workflow operations explicitly."],
    source: "chief_orchestrator",
    createdAt: new Date().toISOString(),
    action: {
      actionId: "workflow-next-step",
      actionLabel: "Prepare Workflow",
      toolName: "tasks.create",
      args: {
        title: `Workflow follow-up: ${deriveTitle(input.intent, "Workflow")}`,
        priority: "p2",
      },
    },
  };
}

export function mapChiefSteps(input: {
  contract: TaskContract | null;
  phase: "idle" | "planning" | "plan_ready" | "executing" | "done" | "failed";
  executorLabel?: string | null;
  error?: string | null;
}): OrchestratorStep[] {
  const detail = input.contract?.summary?.trim() || "Workspace brain and current intent analyzed for delegation.";
  const scopeLabel = input.contract?.executorType === "code"
    ? input.contract.scope.selectedFiles?.length
      ? `${input.contract.scope.selectedFiles.length} selected file(s) scoped.`
      : input.contract.scope.folderPath?.trim()
        ? `Folder scope: ${input.contract.scope.folderPath.trim()}`
        : "Repository-level scope."
    : `${input.executorLabel ?? "Executor"} contract prepared.`;

  const kind: OrchestratorStep["kind"] =
    input.contract?.executorType === "mail"
      ? "email"
      : input.contract?.executorType === "calendar"
        ? "calendar"
        : input.contract?.executorType === "tasks" || input.contract?.executorType === "workflow"
          ? "task"
          : "code";

  return [
    {
      id: "understand",
      kind: "context",
      title: "Understand workspace context",
      status: input.phase === "idle" || input.phase === "planning" ? "running" : "done",
      detail,
    },
    {
      id: "contract",
      kind,
      title: "Create executor contract",
      status:
        input.phase === "idle" || input.phase === "planning"
          ? "running"
          : input.phase === "failed"
            ? "failed"
            : "done",
      detail: input.error && input.phase === "failed" ? input.error : scopeLabel,
    },
    {
      id: "dispatch",
      kind,
      title: `Dispatch to ${input.executorLabel ?? "executor"}`,
      status:
        input.phase === "plan_ready"
          ? "ready"
          : input.phase === "executing"
            ? "running"
            : input.phase === "done"
              ? "done"
              : input.phase === "failed"
                ? "failed"
                : "ready",
      detail:
        input.phase === "failed"
          ? input.error?.trim() || "Execution failed."
          : input.phase === "done"
            ? `${input.executorLabel ?? "Executor"} finished the delegated task.`
            : `Ready to delegate to ${input.executorLabel ?? "executor"}.`,
    },
  ];
}
