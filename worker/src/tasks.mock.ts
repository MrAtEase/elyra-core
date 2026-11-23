// worker/src/tasks.mock.ts
type TaskStatus = "backlog" | "planned" | "done";
type TaskPriority = "low" | "normal" | "high";

export type Task = {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedDurationMin?: number;
  deadline?: string | null;
  preferredTime?: "morning" | "afternoon" | "evening" | "any";
  scheduled?: {
    calendarProvider?: "google";
    eventId?: string | null;
    start?: string | null;
    end?: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

type Store = Record<string, Task[]>; // by workspaceId

const nowIso = () => new Date().toISOString();
const uid = () => `tsk_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

const store: Store = {};

export function listTasks(workspaceId: string) {
  if (!store[workspaceId]) {
    store[workspaceId] = [
      {
        id: uid(),
        workspaceId,
        title: "Call prep: Google",
        status: "backlog",
        priority: "high",
        estimatedDurationMin: 30,
        deadline: null,
        preferredTime: "morning",
        scheduled: { eventId: null, start: null, end: null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: uid(),
        workspaceId,
        title: "Write follow-up mail",
        status: "planned",
        priority: "normal",
        estimatedDurationMin: 20,
        deadline: null,
        preferredTime: "any",
        scheduled: { eventId: null, start: null, end: null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ];
  }
  return store[workspaceId];
}

export function createTask(workspaceId: string, body: any): Task {
  if (!body?.title || typeof body.title !== "string" || body.title.trim().length < 3) {
    throw new Error("title required (min 3 chars)");
  }
  const t: Task = {
    id: uid(),
    workspaceId,
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    status: (body.status as TaskStatus) ?? "backlog",
    priority: (body.priority as TaskPriority) ?? "normal",
    estimatedDurationMin: typeof body.estimatedDurationMin === "number" ? body.estimatedDurationMin : undefined,
    deadline: typeof body.deadline === "string" ? body.deadline : null,
    preferredTime: body.preferredTime ?? "any",
    scheduled: { eventId: null, start: null, end: null },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const items = listTasks(workspaceId);
  items.unshift(t);
  return t;
}

export function patchTask(workspaceId: string, taskId: string, body: any): Task {
  const items = listTasks(workspaceId);
  const idx = items.findIndex((x) => x.id === taskId);
  if (idx < 0) throw new Error("task not found");

  const t = items[idx];

  const next: Task = {
    ...t,
    title: typeof body.title === "string" ? body.title : t.title,
    description: typeof body.description === "string" ? body.description : t.description,
    status: body.status ?? t.status,
    priority: body.priority ?? t.priority,
    estimatedDurationMin: typeof body.estimatedDurationMin === "number" ? body.estimatedDurationMin : t.estimatedDurationMin,
    deadline: typeof body.deadline === "string" ? body.deadline : t.deadline,
    preferredTime: body.preferredTime ?? t.preferredTime,
    scheduled: body.scheduled
      ? {
          ...t.scheduled,
          ...body.scheduled,
        }
      : t.scheduled,
    updatedAt: nowIso(),
  };

  items[idx] = next;
  return next;
}

export function scheduleTaskMock(workspaceId: string, taskId: string, body: any) {
  const items = listTasks(workspaceId);
  const t = items.find((x) => x.id === taskId);
  if (!t) throw new Error("task not found");

  const from = new Date();
  from.setMinutes(0, 0, 0);

  const slot1 = new Date(from.getTime() + 60 * 60 * 1000);
  const slot2 = new Date(from.getTime() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);

  const durationMin =
    typeof body?.durationMin === "number" ? body.durationMin : t.estimatedDurationMin ?? 30;

  const toIso = (d: Date) => d.toISOString();
  const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60 * 1000);

  return {
    task: t,
    scheduled: null,
    proposal: {
      type: "calendar_schedule",
      status: "proposed",
      payload: {
        taskId: t.id,
        workspaceId,
        durationMin,
        options: [
          { start: toIso(slot1), end: toIso(addMin(slot1, durationMin)) },
          { start: toIso(slot2), end: toIso(addMin(slot2, durationMin)) },
        ],
        reason: "Mock: Bitte Slot bestätigen.",
      },
    },
  };
}

export function deleteTask(workspaceId: string, taskId: string): { ok: true } {
  const items = listTasks(workspaceId);
  const idx = items.findIndex((x) => x.id === taskId);
  if (idx < 0) throw new Error("task not found");
  items.splice(idx, 1);
  return { ok: true };
}
