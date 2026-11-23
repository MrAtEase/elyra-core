import { ensureSupabaseToken, supabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeTask, type Task, type TaskRecord } from "@/components/workspace/tasks/task-model";
import type { MailThread } from "./mail-model";

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

const FALLBACK_USER_ID = "00000000-0000-0000-0000-000000000000";

export type CreateTaskFromThreadParams = {
  workspaceId: string;
  thread: MailThread;
  createdBy?: string | null;
};

export async function createTaskFromThread({
  workspaceId,
  thread,
  createdBy,
}: CreateTaskFromThreadParams): Promise<Task> {
  if (!workspaceId) {
    throw new Error("Workspace is required to create a task");
  }
  if (!thread || !thread.id) {
    throw new Error("A thread must be provided to create a task");
  }
  await ensureSupabaseToken();
  const title = (thread.subject ?? "").trim() || "Follow up";
  if (!thread.externalId) {
    throw new Error("Thread external id is required to link a task");
  }

  const createdByValue = createdBy?.trim() || FALLBACK_USER_ID;

  const { data, error } = await supabaseBrowserClient
    .from("tasks")
    .insert({
      workspace_id: workspaceId,
      title,
      source: "gmail",
      external_ref: thread.externalId,
      created_by: createdByValue,
    })
    .select(TASK_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to create task from mail thread");
  }

  const createdTask = normalizeTask(data as unknown as TaskRecord);

  const { error: linkError } = await supabaseBrowserClient.from("entity_links").insert({
    workspace_id: workspaceId,
    kind: "task_to_mail_thread",
    task_id: createdTask.id,
    mail_thread_id: thread.id,
  });

  if (linkError) {
    throw linkError;
  }

  return createdTask;
}
