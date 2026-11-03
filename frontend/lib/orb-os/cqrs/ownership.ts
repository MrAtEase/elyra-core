import { isWorkerBackboneMode } from "@/lib/orb-os/runtime/workerProxy";

export type Plane = "control_plane" | "data_plane";

const DATA_PLANE_TABLES = new Set([
  "runs",
  "orchestration_runs",
  "tool_calls",
  "artifacts",
  "os_tool_artifacts",
  "run_events",
  "approvals",
]);

const CONTROL_PLANE_TABLES = new Set([
  "workspace_capabilities",
  "installed_apps",
  "app_manifests",
  "tool_registry_entries",
  "os_admin_audit_log",
  "integrations",
  "integration_tokens",
  "plugin_manifests",
  "workspace_plugins",
  "plugin_audit_log",
  "os_metric_samples",
  "os_metric_aggregates",
  "os_incidents",
]);

export function tablePlane(tableName: string): Plane | "unknown" {
  if (DATA_PLANE_TABLES.has(tableName)) return "data_plane";
  if (CONTROL_PLANE_TABLES.has(tableName)) return "control_plane";
  return "unknown";
}

export function assertControlPlaneWrite(tableName: string): void {
  const plane = tablePlane(tableName);
  if (plane === "data_plane") {
    throw new Error(`[cqrs] Invalid control-plane write to data-plane table '${tableName}'`);
  }
}

export function assertDataPlaneWrite(tableName: string): void {
  const plane = tablePlane(tableName);
  if (plane === "control_plane") {
    throw new Error(`[cqrs] Invalid data-plane write to control-plane table '${tableName}'`);
  }
  if (isWorkerBackboneMode()) {
    throw new Error(`[cqrs] Local data-plane writes are disabled in SSOT mode (table '${tableName}')`);
  }
}

