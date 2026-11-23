import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Serverseitiger Aufgaben-Speicher (Supabase-Tabelle public.tasks).
 *
 * Im Repo existieren zwei Tabellen-Varianten:
 *  - "modern" (frontend/db): due_at, priority, assigned_to, created_by, Status open|in_progress|done|canceled
 *  - "legacy" (ai-service 0009): due_date, description, Status todo|in_progress|done|cancelled
 * Welche live ist, hängt davon ab, welche Migration zuerst lief. Dieser Speicher erkennt das
 * beim ersten Zugriff und übersetzt beide Varianten auf ein einheitliches Format.
 * Langfristig: Migration frontend/db/migrations/0002_tasks_unify.sql ausführen.
 */

export type TaskStatus = "open" | "in_progress" | "done" | "canceled";

export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number | null;
  due_at: string | null;
  assigned_to: string | null;
  workspace_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

type Variant = "modern" | "legacy";
let detected: Variant | null = null;

const MODERN_COLUMNS = "id,title,status,priority,due_at,assigned_to,workspace_id,created_by,created_at,updated_at";
const LEGACY_COLUMNS = "id,title,status,due_date,workspace_id,created_at,updated_at";

function db(): SupabaseClient {
  // Untypisiert: die generierten Typen kennen die Tabelle "tasks" nicht.
  return getSupabaseAdminClient() as unknown as SupabaseClient;
}

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42703" || error.code === "PGRST204" || (msg.includes("column") && (msg.includes("does not exist") || msg.includes("could not find")));
}

const toLegacyStatus = (s: TaskStatus): string => (s === "open" ? "todo" : s === "canceled" ? "cancelled" : s);
const fromLegacyStatus = (s: string): TaskStatus => (s === "todo" ? "open" : s === "cancelled" ? "canceled" : (s as TaskStatus));

function fromLegacy(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row["id"]),
    title: String(row["title"] ?? ""),
    status: fromLegacyStatus(String(row["status"] ?? "todo")),
    priority: null,
    due_at: (row["due_date"] as string | null) ?? null,
    assigned_to: null,
    workspace_id: String(row["workspace_id"]),
    created_by: null,
    created_at: String(row["created_at"] ?? new Date().toISOString()),
    updated_at: (row["updated_at"] as string | null) ?? null,
  };
}

async function variant(): Promise<Variant> {
  if (detected) return detected;
  const { error } = await db().from("tasks").select("due_at,priority").limit(1);
  if (!error) detected = "modern";
  else if (isMissingColumn(error)) detected = "legacy";
  else throw new Error(error.message);
  return detected;
}

export async function listTasks(workspaceId: string): Promise<TaskRecord[]> {
  if ((await variant()) === "modern") {
    const { data, error } = await db().from("tasks").select(MODERN_COLUMNS).eq("workspace_id", workspaceId).order("updated_at", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as TaskRecord[];
  }
  const { data, error } = await db().from("tasks").select(LEGACY_COLUMNS).eq("workspace_id", workspaceId).order("updated_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(fromLegacy);
}

export type NewTask = { title: string; status?: TaskStatus; priority?: number | null; dueAt?: string | null; assignedTo?: string | null };
export type TaskPatch = Partial<NewTask>;

const isoOrNull = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export async function createTask(workspaceId: string, userId: string | null, input: NewTask): Promise<TaskRecord> {
  const title = input.title.trim();
  if (!title) throw new Error("Aufgaben brauchen einen Titel");
  if ((await variant()) === "modern") {
    const row: Record<string, unknown> = {
      workspace_id: workspaceId,
      title,
      status: input.status ?? "open",
      priority: typeof input.priority === "number" && Number.isFinite(input.priority) ? input.priority : 0,
      due_at: isoOrNull(input.dueAt),
      assigned_to: input.assignedTo?.trim() || null,
    };
    if (userId) row["created_by"] = userId;
    const { data, error } = await db().from("tasks").insert(row).select(MODERN_COLUMNS).single();
    if (error) throw new Error(error.message);
    return data as TaskRecord;
  }
  const { data, error } = await db()
    .from("tasks")
    .insert({ workspace_id: workspaceId, title, description: "", status: toLegacyStatus(input.status ?? "open"), due_date: isoOrNull(input.dueAt) })
    .select(LEGACY_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return fromLegacy(data as Record<string, unknown>);
}

export async function updateTask(workspaceId: string, taskId: string, patch: TaskPatch): Promise<TaskRecord> {
  const modern = (await variant()) === "modern";
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row["title"] = patch.title.trim();
  if (patch.status !== undefined) row["status"] = modern ? patch.status : toLegacyStatus(patch.status);
  if ("dueAt" in patch) row[modern ? "due_at" : "due_date"] = isoOrNull(patch.dueAt);
  if (modern && "priority" in patch) row["priority"] = typeof patch.priority === "number" && Number.isFinite(patch.priority) ? patch.priority : 0;
  if (modern && "assignedTo" in patch) row["assigned_to"] = patch.assignedTo?.trim() || null;
  if (Object.keys(row).length === 1) throw new Error("Keine Änderungen angegeben");
  const { data, error } = await db()
    .from("tasks")
    .update(row)
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .select(modern ? MODERN_COLUMNS : LEGACY_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return modern ? (data as unknown as TaskRecord) : fromLegacy(data as unknown as Record<string, unknown>);
}

export async function deleteTask(workspaceId: string, taskId: string): Promise<void> {
  const { error } = await db().from("tasks").delete().eq("workspace_id", workspaceId).eq("id", taskId);
  if (error) throw new Error(error.message);
}
