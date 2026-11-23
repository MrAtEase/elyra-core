import { googleApiFetch } from "@/lib/google/http";

type GoogleTaskListResponse = {
  items?: Array<{ id?: string; title?: string }>;
};

type GoogleTasksResponse = {
  items?: Array<{
    id?: string;
    title?: string;
    due?: string;
    updated?: string;
    status?: "needsAction" | "completed";
    notes?: string;
  }>;
};

export type GoogleTaskItem = {
  id: string;
  title: string;
  due_at: string | null;
  updated_at: string | null;
  status: "open" | "completed";
  notes: string | null;
};

export async function listGoogleOpenTasks(input: {
  accessToken: string;
  maxLists?: number;
  maxTasksPerList?: number;
}): Promise<GoogleTaskItem[]> {
  const maxLists = Math.max(1, Math.min(10, Math.round(input.maxLists ?? 3)));
  const maxTasksPerList = Math.max(1, Math.min(20, Math.round(input.maxTasksPerList ?? 10)));

  const listsUrl = new URL("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
  listsUrl.searchParams.set("maxResults", String(maxLists));
  const lists = await googleApiFetch<GoogleTaskListResponse>(listsUrl, input.accessToken);
  const listIds = (lists.items ?? [])
    .map((item) => item.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (listIds.length === 0) return [];

  const byList = await Promise.all(
    listIds.map(async (listId) => {
      const tasksUrl = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`);
      tasksUrl.searchParams.set("showCompleted", "false");
      tasksUrl.searchParams.set("showHidden", "false");
      tasksUrl.searchParams.set("maxResults", String(maxTasksPerList));
      const payload = await googleApiFetch<GoogleTasksResponse>(tasksUrl, input.accessToken);
      return (payload.items ?? []).map((task) => ({
        id: task.id?.trim() || crypto.randomUUID(),
        title: task.title?.trim() || "(Untitled task)",
        due_at: task.due ? new Date(task.due).toISOString() : null,
        updated_at: task.updated ? new Date(task.updated).toISOString() : null,
        status: (task.status === "completed" ? "completed" : "open") as "completed" | "open",
        notes: task.notes?.trim() || null,
      }));
    })
  );

  return byList
    .flat()
    .filter((task) => task.status === "open")
    .sort((a, b) => {
      const left = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
      const right = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
      return left - right;
    });
}
