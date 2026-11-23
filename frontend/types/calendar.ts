import type { PendingAction } from "@/types/poker";

export type CalendarPendingActionType = "calendar_create" | "calendar_update" | "calendar_delete";

type PendingActionBase = Exclude<PendingAction, null>;

export type CalendarPendingAction = PendingActionBase & {
  type: CalendarPendingActionType;
};

export type CalendarEventRecord = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  source: string;
  workspaceId: string | null;
  isEditable: boolean;
  isOptimistic?: boolean;
};

export type CalendarEventInput = {
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
};

export type CalendarEventUpdateInput = {
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
};
