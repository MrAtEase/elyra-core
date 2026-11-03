import { registerTool } from "./registry.js";
import { db } from "../db/client.js";
import { logger } from "../lib/logger.js";

registerTool("tasks.list", async (input, workspaceId) => {
  const status = input["status"] as string | undefined;

  let query = db()
    .from("tasks")
    .select("id, title, description, status, due_date, created_at")
    .eq("workspace_id", workspaceId)
    .order("due_date", { ascending: true })
    .limit(20);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    logger.warn({ error }, "tasks.list from DB failed, returning empty");
    return { tasks: [], text: "No tasks found" };
  }

  const tasks = (data ?? []).map((t: Record<string, unknown>) => ({
    id: t["id"],
    title: t["title"],
    description: t["description"],
    status: t["status"],
    dueDate: t["due_date"],
  }));

  return { tasks, text: `Found ${tasks.length} tasks` };
});

registerTool("tasks.create", async (input, workspaceId) => {
  const { data, error } = await db()
    .from("tasks")
    .insert({
      workspace_id: workspaceId,
      title: input["title"],
      description: input["description"] ?? "",
      status: "todo",
      due_date: input["dueDate"] ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return { text: `Failed to create task: ${error.message}` };
  }

  return { taskId: data?.["id"], text: `Created task: ${input["title"]}` };
});
