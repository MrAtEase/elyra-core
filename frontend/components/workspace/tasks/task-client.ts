import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeTask, type Task, type TaskRecord, type TaskStatus } from "./task-model";

const TASK_SELECT_COLUMNS = [
  "id",
  "title",
  "status",
  "priority",
  "due_at",
  "assigned_to",
  "workspace_id",
  "created_by",
  "created_at",
  "updated_at",
].join(",");

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

const applyDate = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const isTaskRecordShape = (value: unknown): value is TaskRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as TaskRecord).id === "string" &&
  typeof (value as TaskRecord).title === "string" &&
  typeof (value as TaskRecord).status === "string";

export async function createTask(
  workspaceId: string,
  userId: string | null | undefined,
  payload: NewTaskPayload
): Promise<Task> {
  if (!workspaceId) {
    throw new Error("Workspace is required to create a task");
  }
  const title = payload.title?.trim();
  if (!title) {
    throw new Error("Tasks require a title");
  }

  const insertPayload: Record<string, unknown> = {
    title,
    status: payload.status ?? "open",
    workspace_id: workspaceId,
    priority:
      typeof payload.priority === "number" && Number.isFinite(payload.priority)
        ? payload.priority
        : null,
    due_at: applyDate(payload.dueAt),
  };

  const trimmedAssigned = payload.assignedTo?.trim() ?? "";
  insertPayload.assigned_to = trimmedAssigned.length > 0 ? trimmedAssigned : null;
  if (userId) {
    insertPayload.created_by = userId;
  }

  const { data, error } = await supabaseBrowserClient
    .from("tasks")
    .insert(insertPayload)
    .select(TASK_SELECT_COLUMNS)
    .single();

  if (error || !data || !isTaskRecordShape(data)) {
    throw error ?? new Error("Failed to create task");
  }

  return normalizeTask(data);
}

export async function updateTask(
  workspaceId: string,
  taskId: string,
  patch: TaskUpdatePayload
): Promise<Task> {
  if (!workspaceId) {
    throw new Error("Workspace is required to update a task");
  }
  if (!taskId) {
    throw new Error("Task id is required");
  }

  const updatePayload: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    updatePayload.title = patch.title.trim();
  }
  if (patch.status !== undefined) {
    updatePayload.status = patch.status;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "priority")) {
    updatePayload.priority =
      patch.priority === null || patch.priority === undefined
        ? null
        : Number.isFinite(patch.priority)
        ? patch.priority
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "dueAt")) {
    updatePayload.due_at = applyDate(patch.dueAt ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "assignedTo")) {
    const trimmed = patch.assignedTo?.trim() ?? "";
    updatePayload.assigned_to = trimmed.length > 0 ? trimmed : null;
  }

  if (Object.keys(updatePayload).length === 0) {
    throw new Error("No changes were provided for the task update");
  }

  const { data, error } = await supabaseBrowserClient
    .from("tasks")
    .update(updatePayload)
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .select(TASK_SELECT_COLUMNS)
    .single();

  if (error || !data || !isTaskRecordShape(data)) {
    throw error ?? new Error("Failed to update task");
  }

  return normalizeTask(data);
}

export async function deleteTask(workspaceId: string, taskId: string): Promise<void> {
  if (!workspaceId || !taskId) {
    throw new Error("Workspace and task id are required to delete a task");
  }

  const { error } = await supabaseBrowserClient
    .from("tasks")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", taskId);

  if (error) {
    throw error;
  }
}
