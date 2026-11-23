import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertControlPlaneWrite } from "@/lib/orb-os/cqrs/ownership";

type MetricName = "run_success_rate" | "queue_lag" | "p95_tool_latency" | "approval_time" | "auth_failure_rate";

const INCIDENT_TYPES = {
  auth_failure_spike: "auth_failure_spike",
  queue_lag_spike: "queue_lag_spike",
  tool_error_spike: "tool_error_spike",
} as const;

export type IncidentCandidate = {
  incident_type: string;
  severity: "high" | "critical";
  summary: string;
  payload: Record<string, unknown>;
};

export function deriveIncidentCandidatesFromAggregate(aggregate: {
  auth_failure_rate?: number | null;
  queue_lag?: number | null;
  run_success_rate?: number | null;
  p95_tool_latency?: number | null;
}): IncidentCandidate[] {
  const incidents: IncidentCandidate[] = [];

  if (Number(aggregate.auth_failure_rate ?? 0) > 0.25) {
    incidents.push({
      incident_type: INCIDENT_TYPES.auth_failure_spike,
      severity: "high",
      summary: "Auth failure rate spike detected",
      payload: { auth_failure_rate: aggregate.auth_failure_rate },
    });
  }

  if (Number(aggregate.queue_lag ?? 0) > 120) {
    incidents.push({
      incident_type: INCIDENT_TYPES.queue_lag_spike,
      severity: "critical",
      summary: "Queue lag exceeds critical threshold",
      payload: { queue_lag: aggregate.queue_lag },
    });
  }

  if (Number(aggregate.run_success_rate ?? 1) < 0.8 || Number(aggregate.p95_tool_latency ?? 0) > 20000) {
    incidents.push({
      incident_type: INCIDENT_TYPES.tool_error_spike,
      severity: "high",
      summary: "Tool execution reliability degraded",
      payload: {
        run_success_rate: aggregate.run_success_rate,
        p95_tool_latency: aggregate.p95_tool_latency,
      },
    });
  }

  return incidents;
}

export async function emitMetricSample(input: {
  workspaceId: string;
  metricName: MetricName;
  value: number;
  tags?: Record<string, unknown>;
  correlationId?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  assertControlPlaneWrite("os_metric_samples");
  await supabase.from("os_metric_samples").insert({
    workspace_id: input.workspaceId,
    metric_name: input.metricName,
    metric_value: input.value,
    tags_json: input.tags ?? {},
    correlation_id: input.correlationId ?? null,
  });
}

export async function refreshHourlyAggregates(workspaceId: string) {
  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const sampleRes = await supabase
    .from("os_metric_samples")
    .select("metric_name,metric_value")
    .eq("workspace_id", workspaceId)
    .gte("observed_at", since);

  if (sampleRes.error) {
    throw new Error(`Failed to read metric samples: ${sampleRes.error.message}`);
  }

  const grouped = new Map<string, number[]>();
  for (const row of sampleRes.data ?? []) {
    const list = grouped.get(String(row.metric_name)) ?? [];
    list.push(Number(row.metric_value ?? 0));
    grouped.set(String(row.metric_name), list);
  }

  const avg = (name: string) => {
    const values = grouped.get(name) ?? [];
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const bucketStart = new Date();
  bucketStart.setMinutes(0, 0, 0);

  assertControlPlaneWrite("os_metric_aggregates");
  const { error } = await supabase.from("os_metric_aggregates").upsert(
    {
      workspace_id: workspaceId,
      bucket_start: bucketStart.toISOString(),
      bucket_granularity: "hourly",
      run_success_rate: avg("run_success_rate"),
      queue_lag: avg("queue_lag"),
      p95_tool_latency: avg("p95_tool_latency"),
      approval_time: avg("approval_time"),
      auth_failure_rate: avg("auth_failure_rate"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,bucket_start,bucket_granularity" },
  );

  if (error) {
    throw new Error(`Failed to update metric aggregate: ${error.message}`);
  }
}

export async function evaluateAndCreateIncidents(workspaceId: string) {
  const supabase = getSupabaseAdminClient();
  const aggregate = await supabase
    .from("os_metric_aggregates")
    .select("run_success_rate,queue_lag,p95_tool_latency,approval_time,auth_failure_rate,bucket_start")
    .eq("workspace_id", workspaceId)
    .eq("bucket_granularity", "hourly")
    .order("bucket_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aggregate.error || !aggregate.data) return [];

  const incidents = deriveIncidentCandidatesFromAggregate({
    ...(aggregate.data.auth_failure_rate == null
      ? {}
      : { auth_failure_rate: Number(aggregate.data.auth_failure_rate) }),
    ...(aggregate.data.queue_lag == null
      ? {}
      : { queue_lag: Number(aggregate.data.queue_lag) }),
    ...(aggregate.data.run_success_rate == null
      ? {}
      : { run_success_rate: Number(aggregate.data.run_success_rate) }),
    ...(aggregate.data.p95_tool_latency == null
      ? {}
      : { p95_tool_latency: Number(aggregate.data.p95_tool_latency) }),
  });

  for (const incident of incidents) {
    const exists = await supabase
      .from("os_incidents")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("incident_type", incident.incident_type)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();

    if (exists.data?.id) continue;

    assertControlPlaneWrite("os_incidents");
    await supabase.from("os_incidents").insert({
      workspace_id: workspaceId,
      incident_type: incident.incident_type,
      severity: incident.severity,
      status: "open",
      summary: incident.summary,
      trigger_payload_json: incident.payload,
      affected_runs: [],
    });
  }

  return incidents;
}

export async function listSystemHealth(workspaceId: string) {
  const supabase = getSupabaseAdminClient();
  const [aggregateRes, incidentsRes] = await Promise.all([
    supabase
      .from("os_metric_aggregates")
      .select("bucket_start,run_success_rate,queue_lag,p95_tool_latency,approval_time,auth_failure_rate")
      .eq("workspace_id", workspaceId)
      .eq("bucket_granularity", "hourly")
      .order("bucket_start", { ascending: false })
      .limit(24),
    supabase
      .from("os_incidents")
      .select("id,incident_type,severity,status,summary,trigger_payload_json,affected_runs,opened_at")
      .eq("workspace_id", workspaceId)
      .order("opened_at", { ascending: false })
      .limit(50),
  ]);

  if (aggregateRes.error) throw new Error(`Failed to read aggregates: ${aggregateRes.error.message}`);
  if (incidentsRes.error) throw new Error(`Failed to read incidents: ${incidentsRes.error.message}`);

  return {
    aggregates: aggregateRes.data ?? [],
    incidents: incidentsRes.data ?? [],
  };
}
