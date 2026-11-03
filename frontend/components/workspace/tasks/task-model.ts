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

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number | null;
  dueAt: string | null;
  assignedTo: string | null;
  workspaceId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export const timestampFrom = (value: string | null) => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeTask = (record: TaskRecord): Task => ({
  id: record.id,
  title: record.title,
  status: record.status,
  priority: record.priority,
  dueAt: record.due_at,
  assignedTo: record.assigned_to,
  workspaceId: record.workspace_id,
  createdBy: record.created_by,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

export const sortTasks = (tasks: Task[]): Task[] =>
  [...tasks].sort((a, b) => {
    const aStamp = timestampFrom(a.updatedAt ?? a.createdAt);
    const bStamp = timestampFrom(b.updatedAt ?? b.createdAt);
    return bStamp - aStamp;
  });
