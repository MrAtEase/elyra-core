export type DashboardSectionState = "ready" | "empty" | "needs_auth" | "needs_scope" | "error";

export type DashboardSection<TData> = {
  state: DashboardSectionState;
  data: TData | null;
  error_code?: string;
  error_message_safe?: string;
  integration_ids?: string[];
};

export type DashboardGoal = {
  id: string;
  workspace_id: string;
  title: string;
  status: "planned" | "active" | "blocked" | "at_risk" | "completed" | "archived";
  priority: "p0" | "p1" | "p2" | "p3";
  progress_pct: number;
  confidence: number;
  due_at: string | null;
  owner_label: string;
};

export type DashboardGoalsData = {
  north_star: DashboardGoal[];
  operational: DashboardGoal[];
};

export type DashboardRun = {
  id: string;
  workspace_id: string;
  intent: string;
  status: "running" | "waiting_for_auth" | "waiting_for_approval" | "failed" | "success";
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  surface: "orb" | "assistant" | "apps";
};

export type DashboardConnectedApp = {
  app_id: string;
  app_name: string;
  icon_name: string;
  status: "connected" | "needs_auth" | "needs_scope" | "degraded" | "policy_blocked" | "disconnected";
  scopes_count: number;
  last_refresh_at: string | null;
  detail: string | null;
};

export type DashboardSuggestedAction = {
  action_id: string;
  app_id: string;
  app_name: string;
  label: string;
  tool_ref: string;
  state: "ready" | "needs_auth" | "policy_blocked" | "disabled";
  risk_level: "read_only" | "writes" | "destructive";
  requires_approval: boolean;
};

export type DashboardUpcomingItem = {
  id: string;
  kind: "event" | "task";
  title: string;
  at: string;
  priority?: "p0" | "p1" | "p2" | "p3";
  source: string;
};

export type DashboardSections = {
  goals: DashboardSection<DashboardGoalsData>;
  runs: DashboardSection<DashboardRun[]>;
  apps: DashboardSection<DashboardConnectedApp[]>;
  actions: DashboardSection<DashboardSuggestedAction[]>;
  upcoming: DashboardSection<DashboardUpcomingItem[]>;
};

export type DashboardHealth = {
  state: "ok" | "degraded";
  impacted_sections: Array<keyof DashboardSections>;
};

export type DashboardPayload = {
  workspace_id: string;
  generated_at: string;
  health: DashboardHealth;
  sections: DashboardSections;
  summary?: DashboardSummary;
};

export type DashboardGoogleConnectionState =
  | "disconnected"
  | "connected"
  | "needs_auth"
  | "needs_scope"
  | "error";

export type DashboardInboxMessage = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  at: string;
  is_read: boolean;
};

export type DashboardTask = {
  id: string;
  title: string;
  due_at: string | null;
};

export type DashboardSummary = {
  google: {
    state: DashboardGoogleConnectionState;
    reason: string | null;
    required_scopes: string[];
  };
  today: {
    date: string;
    next_event: DashboardUpcomingItem | null;
    tasks_open_count: number;
    tasks: DashboardTask[];
  };
  inbox: {
    unread_count: number;
    latest: DashboardInboxMessage[];
  };
  activity: {
    runs_count: number;
    latest_runs: DashboardRun[];
  };
};
