import type { ExecutorType, TaskContract } from "@/types/taskContract";

export type ExecutorRegistryEntry = {
  executorType: ExecutorType;
  label: string;
  dispatchPath: string;
};

const EXECUTOR_REGISTRY: Record<ExecutorType, ExecutorRegistryEntry> = {
  code: {
    executorType: "code",
    label: "Coding Agent",
    dispatchPath: "/api/os/code/run",
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

export function listExecutorRegistry(): ExecutorRegistryEntry[] {
  return Object.values(EXECUTOR_REGISTRY);
}
