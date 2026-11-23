export type PokerLifePolicy = {
  protect_evenings?: boolean;
  min_hobby_hours_per_week?: string | null;
  max_focus_blocks_per_day?: number | null;
};

export type PendingActionStatus = 'proposed' | 'confirmed' | 'executed' | 'failed';

export type PendingAction = {
  type:
    | 'calendar_create'
    | 'calendar_update'
    | 'calendar_delete'
    | 'task_create'
    | 'task_update'
    | 'mail_send';
  payload: Record<string, any>;
  status: PendingActionStatus;
  reason?: string;
  result?: Record<string, any> | null;
  createdAt: number;
  updatedAt: number;
} | null;

export type PokerState = {
  primary_focus: string;
  energy_state: string;
  time_horizon: string;
  life_policy: PokerLifePolicy | null;
  last_intent: string;
  pending_action?: PendingAction;
  updatedAt: number;
};
