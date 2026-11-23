import { registerTool } from "./registry.js";
import { db } from "../db/client.js";
import { logger } from "../lib/logger.js";

/**
 * Aufgaben für Elly. Die Tabelle public.tasks existiert in zwei Varianten
 * (modern: due_at/Status "open", legacy: due_date/Status "todo"). Wir versuchen
 * zuerst das moderne Schema (wie die Tasks-App) und fallen sonst auf legacy zurück.
 * Siehe frontend/db/migrations/0012_tasks_unify.sql.
 */

const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42703" || error.code === "PGRST204" || /column .*(does not exist|could not find)/i.test(error.message ?? "") || /could not find the .* column/i.test(error.message ?? ""));

registerTool("tasks.list", async (input, workspaceId) => {
  const status = input["status"] as string | undefined;
  const modernStatus = status === "todo" ? "open" : status === "cancelled" ? "canceled" : status;

  let modern = db().from("tasks").select("id, title, description, status, due_at, created_at").eq("workspace_id", workspaceId).order("due_at", { ascending: true, nullsFirst: false }).limit(20);
  if (modernStatus) modern = modern.eq("status", modernStatus);
  const first = await modern;
  let data = first.data as Array<Record<string, unknown>> | null;
  let error = first.error;

  if (isMissingColumn(error)) {
    let legacy = db().from("tasks").select("id, title, description, status, due_date, created_at").eq("workspace_id", workspaceId).order("due_date", { ascending: true }).limit(20);
    if (status) legacy = legacy.eq("status", status === "open" ? "todo" : status);
    const second = await legacy;
    data = second.data as Array<Record<string, unknown>> | null;
    error = second.error;
  }
  if (error) {
    logger.warn({ error }, "tasks.list from DB failed, returning empty");
    return { tasks: [], text: "No tasks found" };
  }

  const tasks = (data ?? []).map((t: Record<string, unknown>) => ({
    id: t["id"],
    title: t["title"],
    description: t["description"],
    status: t["status"] === "todo" ? "open" : t["status"],
    dueDate: t["due_at"] ?? t["due_date"] ?? null,
  }));

  return { tasks, text: `Found ${tasks.length} tasks` };
});

registerTool("tasks.create", async (input, workspaceId) => {
  const title = String(input["title"] ?? "").trim();
  if (!title) return { text: "Failed to create task: title missing" };
  const description = (input["description"] as string | undefined) ?? "";
  const due = (input["dueDate"] as string | undefined) ?? null;

  let { data, error } = await db()
    .from("tasks")
    .insert({ workspace_id: workspaceId, title, description, status: "open", priority: 0, due_at: due })
    .select("id")
    .single();

  if (isMissingColumn(error)) {
    ({ data, error } = await db()
      .from("tasks")
      .insert({ workspace_id: workspaceId, title, description, status: "todo", due_date: due })
      .select("id")
      .single());
  }

  if (error) {
    return { text: `Failed to create task: ${error.message}` };
  }

  return { taskId: data?.["id"], text: `Created task: ${title}` };
});
