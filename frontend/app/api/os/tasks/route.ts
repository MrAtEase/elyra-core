import { NextRequest, NextResponse } from "next/server";
import { authorizeTasks } from "@/lib/tasks/authorize";
import { createTask, listTasks, type TaskStatus } from "@/lib/tasks/taskStore";

export const runtime = "nodejs";

const STATUSES: TaskStatus[] = ["open", "in_progress", "done", "canceled"];

/** GET /api/os/tasks?workspaceId=… – Aufgaben des Workspaces */
export async function GET(request: NextRequest) {
  const workspaceId = (request.nextUrl.searchParams.get("workspaceId") ?? "").trim();
  const auth = await authorizeTasks(request, workspaceId);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ ok: true, tasks: await listTasks(auth.workspaceId) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}

/** POST /api/os/tasks – neue Aufgabe { workspaceId, title, status?, priority?, dueAt?, assignedTo? } */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = typeof body["workspaceId"] === "string" ? body["workspaceId"].trim() : "";
  const auth = await authorizeTasks(request, workspaceId);
  if (auth instanceof NextResponse) return auth;
  const title = typeof body["title"] === "string" ? body["title"].trim().slice(0, 500) : "";
  if (!title) return NextResponse.json({ ok: false, error: "Titel fehlt." }, { status: 400 });
  const status = STATUSES.includes(body["status"] as TaskStatus) ? (body["status"] as TaskStatus) : "open";
  try {
    const task = await createTask(auth.workspaceId, auth.userId, {
      title,
      status,
      priority: typeof body["priority"] === "number" ? body["priority"] : null,
      dueAt: typeof body["dueAt"] === "string" ? body["dueAt"] : null,
      assignedTo: typeof body["assignedTo"] === "string" ? body["assignedTo"] : null,
    });
    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
