export type ChiefRunTimelineEntry = {
  id: string;
  at: string;
  type: string;
  summary: string;
};

export type ChiefRunReadModel = {
  status: "queued" | "running" | "waiting_for_approval" | "waiting_for_auth" | "succeeded" | "failed" | "cancelled";
  timeline: ChiefRunTimelineEntry[];
  requiresApproval: boolean;
  requiresAuth: boolean;
};

export function buildChiefRunReadModel(events: Array<Record<string, unknown>>): ChiefRunReadModel {
  let status: ChiefRunReadModel["status"] = "queued";
  const timeline = events.map((event) => {
    const payload = event.payload_json && typeof event.payload_json === "object"
      ? (event.payload_json as Record<string, unknown>)
      : null;
    const summary = typeof payload?.summary === "string"
      ? payload.summary
      : String(event.event_type ?? "UNKNOWN").replaceAll("_", " ").toLowerCase();
    const type = String(event.event_type ?? "UNKNOWN");

    if (type === "TOOL_STARTED") status = "running";
    if (type === "APPROVAL_REQUIRED") status = "waiting_for_approval";
    if (type === "AUTH_REQUIRED") status = "waiting_for_auth";
    if (type === "RUN_SUCCEEDED") status = "succeeded";
    if (type === "RUN_FAILED") status = "failed";
    if (type === "RUN_CANCELLED") status = "cancelled";

    return {
      id: String(event.id ?? `${type}:${event.created_at ?? "unknown"}`),
      at: String(event.created_at ?? new Date().toISOString()),
      type,
      summary,
    };
  });

  return {
    status,
    timeline,
    requiresApproval: timeline.some((entry) => entry.type === "APPROVAL_REQUIRED"),
    requiresAuth: timeline.some((entry) => entry.type === "AUTH_REQUIRED"),
  };
}

export function summarizeChiefRunRow(row: {
  id: string;
  status: string;
  intent: string;
  updated_at: string;
  error?: string | null;
  plan_json?: Record<string, unknown> | null;
}) {
  const plan = row.plan_json && typeof row.plan_json === "object" ? row.plan_json : {};
  const contract = (plan.contract && typeof plan.contract === "object" ? plan.contract : {}) as Record<string, unknown>;
  const result = (plan.result && typeof plan.result === "object" ? plan.result : {}) as Record<string, unknown>;
  const executor = typeof plan.executor === "string" ? plan.executor : null;
  return {
    id: row.id,
    status: row.status,
    intent: row.intent,
    updatedAt: row.updated_at,
    executorType: executor,
    contractTitle: typeof contract.title === "string" ? contract.title : null,
    summary: typeof result.summary === "string" ? result.summary : typeof row.error === "string" ? row.error : null,
  };
}
