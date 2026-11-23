import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { normalizeTask, type Task, type TaskRecord, type TaskStatus } from "./task-model";

/**
 * Aufgaben-Client: spricht ausschließlich mit /api/os/tasks (serverseitig geprüft, schema-tolerant).
 * Früher griff der Browser direkt auf Supabase zu – das scheiterte an RLS und an abweichenden Tabellen-Spalten.
 */

export type NewTaskPayload = {
  title: string;
  status?: TaskStatus;
  priority?: number | null;
  dueAt?: string | null;
  assignedTo?: string | null;
};

export type TaskUpdatePayload = {
  title?: string;
  status?: TaskStatus;
  priority?: number | null;
  dueAt?: string | null;
  assignedTo?: string | null;
};

type ApiResult = { ok: boolean; error?: string; task?: TaskRecord; tasks?: TaskRecord[] };

async function request(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const data = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as ApiResult;
  if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function fetchTasks(workspaceId: string): Promise<Task[]> {
  const data = await request(`/api/os/tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
  return (data.tasks ?? []).map(normalizeTask);
}

export async function createTask(workspaceId: string, _userId: string | null | undefined, payload: NewTaskPayload): Promise<Task> {
  if (!workspaceId) throw new Error("Workspace is required to create a task");
  if (!payload.title?.trim()) throw new Error("Tasks require a title");
  const data = await request("/api/os/tasks", { method: "POST", body: JSON.stringify({ workspaceId, ...payload }) });
  if (!data.task) throw new Error("Failed to create task");
  return normalizeTask(data.task);
}

export async function updateTask(workspaceId: string, taskId: string, patch: TaskUpdatePayload): Promise<Task> {
  if (!workspaceId || !taskId) throw new Error("Workspace and task id are required");
  const data = await request(`/api/os/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ workspaceId, ...patch }) });
  if (!data.task) throw new Error("Failed to update task");
  return normalizeTask(data.task);
}

export async function deleteTask(workspaceId: string, taskId: string): Promise<void> {
  if (!workspaceId || !taskId) throw new Error("Workspace and task id are required to delete a task");
  await request(`/api/os/tasks/${encodeURIComponent(taskId)}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
}
