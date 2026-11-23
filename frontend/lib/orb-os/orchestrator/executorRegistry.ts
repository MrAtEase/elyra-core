import type { ExecutorType, TaskContract } from "@/types/taskContract";

export type ExecutorRegistryEntry = {
  executorType: ExecutorType;
  label: string;
  dispatchPath: string;
};

const EXECUTOR_REGISTRY: Record<ExecutorType, ExecutorRegistryEntry> = {
  code: {
    executorType: "code",
    label: "Code (nicht verfügbar)",
    dispatchPath: "",
  },
  mail: {
    executorType: "mail",
    label: "Mail Agent",
    dispatchPath: "/api/os/runs/quick-action",
  },
  calendar: {
    executorType: "calendar",
    label: "Calendar Agent",
    dispatchPath: "/api/os/runs/quick-action",
  },
  tasks: {
    executorType: "tasks",
    label: "Tasks Agent",
    dispatchPath: "/api/os/runs/quick-action",
  },
  workflow: {
    executorType: "workflow",
    label: "Workflow Agent",
    dispatchPath: "/api/os/runs/quick-action",
  },
};

export function resolveExecutorForContract(contract: TaskContract): ExecutorRegistryEntry {
  return EXECUTOR_REGISTRY[contract.executorType];
}

/** Executors that can actually be dispatched (code changes are not delegated). */
export type AvailableExecutorType = Exclude<ExecutorType, "code">;

export function listExecutorRegistry(): Array<ExecutorRegistryEntry & { executorType: AvailableExecutorType }> {
  return Object.values(EXECUTOR_REGISTRY).filter(
    (entry): entry is ExecutorRegistryEntry & { executorType: AvailableExecutorType } => entry.executorType !== "code",
  );
}
