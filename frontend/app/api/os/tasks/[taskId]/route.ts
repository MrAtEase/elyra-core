import { NextRequest, NextResponse } from "next/server";
import { authorizeTasks } from "@/lib/tasks/authorize";
import { deleteTask, updateTask, type TaskPatch, type TaskStatus } from "@/lib/tasks/taskStore";

export const runtime = "nodejs";

const STATUSES: TaskStatus[] = ["open", "in_progress", "done", "canceled"];

/** PATCH /api/os/tasks/:taskId – { workspaceId, title?, status?, priority?, dueAt?, assignedTo? } */
export async function PATCH(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = typeof body["workspaceId"] === "string" ? body["workspaceId"].trim() : "";
  const auth = await authorizeTasks(request, workspaceId);
  if (auth instanceof NextResponse) return auth;
  const patch: TaskPatch = {};
  if (typeof body["title"] === "string") patch.title = body["title"].slice(0, 500);
  if (STATUSES.includes(body["status"] as TaskStatus)) patch.status = body["status"] as TaskStatus;
  if ("priority" in body) patch.priority = typeof body["priority"] === "number" ? body["priority"] : null;
  if ("dueAt" in body) patch.dueAt = typeof body["dueAt"] === "string" ? body["dueAt"] : null;
  if ("assignedTo" in body) patch.assignedTo = typeof body["assignedTo"] === "string" ? body["assignedTo"] : null;
  try {
    return NextResponse.json({ ok: true, task: await updateTask(auth.workspaceId, taskId, patch) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}

/** DELETE /api/os/tasks/:taskId?workspaceId=… */
export async function DELETE(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const workspaceId = (request.nextUrl.searchParams.get("workspaceId") ?? "").trim();
  const auth = await authorizeTasks(request, workspaceId);
  if (auth instanceof NextResponse) return auth;
  try {
    await deleteTask(auth.workspaceId, taskId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
