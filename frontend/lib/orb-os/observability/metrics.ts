export type MetricName =
  | "run_success_rate"
  | "queue_lag"
  | "p95_tool_latency"
  | "approval_time"
  | "auth_failure_rate";

export type MetricPoint = {
  metric: MetricName;
  value: number;
  workspace_id: string;
  correlation_id?: string;
  tags?: Record<string, string>;
  observed_at: string;
};

const inMemoryBuffer: MetricPoint[] = [];

export function emitMetric(point: Omit<MetricPoint, "observed_at">) {
  inMemoryBuffer.push({ ...point, observed_at: new Date().toISOString() });
  if (inMemoryBuffer.length > 2000) {
    inMemoryBuffer.splice(0, inMemoryBuffer.length - 2000);
  }
}

export function readRecentMetrics(limit = 200): MetricPoint[] {
  const safe = Math.min(2000, Math.max(1, limit));
  return inMemoryBuffer.slice(-safe);
}

export function shouldTriggerIncident(input: {
  runSuccessRate: number;
  queueLagSeconds: number;
  authFailureRate: number;
  p95ToolLatencyMs: number;
}): { trigger: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.runSuccessRate < 0.8) reasons.push("run_success_rate_below_threshold");
  if (input.queueLagSeconds > 120) reasons.push("queue_lag_critical");
  if (input.authFailureRate > 0.25) reasons.push("auth_failure_rate_high");
  if (input.p95ToolLatencyMs > 20_000) reasons.push("p95_tool_latency_high");
  return { trigger: reasons.length > 0, reasons };
}
