"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AdminTabId, WorkspaceAdminPayload } from "@/lib/orb-os/admin/types";
import type { CapabilityLevel } from "@/lib/orb-os/admin/store";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

type WorkspaceAdminSurfaceProps = {
  workspaceId: string;
  workspaceRole: string | null;
};

type AdminState = {
  loading: boolean;
  error: string | null;
  payload: WorkspaceAdminPayload | null;
};

const TABS: Array<{ id: AdminTabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "capabilities", label: "Capabilities" },
  { id: "integrations", label: "Integrations" },
  { id: "ai_control_center", label: "AI Control Center" },
  { id: "policies_approvals", label: "Policies & Approvals" },
  { id: "audit_log", label: "Audit Log" },
  { id: "usage_budget", label: "Usage & Budget" },
  { id: "system_health", label: "System Health" },
  { id: "incidents", label: "Incidents" },
];

function TabLoading() {
  return (
    <div className="animate-pulse rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <div className="h-3 w-24 rounded bg-[var(--border)]" />
      <div className="mt-2 h-3 w-2/3 rounded bg-[var(--border)]" />
      <div className="mt-3 h-10 rounded bg-[var(--border-subtle)]" />
    </div>
  );
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <p className="text-[13px] font-medium text-[color:var(--text-primary)]">Could not load tab data</p>
      <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)]">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function TabEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
      <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{label}</p>
      <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">No data in this workspace yet.</p>
    </div>
  );
}

export default function WorkspaceAdminSurface({ workspaceId, workspaceRole }: WorkspaceAdminSurfaceProps) {
  const [state, setState] = useState<AdminState>({ loading: true, error: null, payload: null });
  const [activeTab, setActiveTab] = useState<AdminTabId>("general");
  const [integrationDiagnosisById, setIntegrationDiagnosisById] = useState<Record<string, string>>({});

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/os/workspace-admin", {
        credentials: "include",
        cache: "no-store",
        headers: await withSupabaseAuthorization(),
      });
      const payload = (await response.json()) as { ok: boolean; admin?: WorkspaceAdminPayload; error?: string };
      if (!response.ok || !payload.ok || !payload.admin) throw new Error(payload.error ?? "Unable to load workspace admin surface");
      if (payload.admin.workspace_id !== workspaceId) throw new Error("Workspace mismatch while loading admin surface");
      setState({ loading: false, error: null, payload: payload.admin });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "Admin request failed", payload: null });
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId]);

  const section = useMemo(() => state.payload?.sections[activeTab], [activeTab, state.payload]);
  const role = (workspaceRole ?? "member").toLowerCase();
  const canUseAdmin = role === "owner" || role === "admin" || role === "manager";
  const isOwner = role === "owner";

  const patchCapability = async (kind: "surface" | "capability", id: string, status: CapabilityLevel) => {
    if (!isOwner) return;
    const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
    await fetch("/api/os/workspace-admin/capabilities", {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify({ kind, id, status }),
    });
    await load();
  };

  const patchApp = async (appId: string, action: "install" | "enable" | "disable" | "uninstall") => {
    if (!isOwner) return;
    const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
    await fetch("/api/os/workspace-admin/apps", {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify({ app_id: appId, action }),
    });
    await load();
  };

  const capabilityOptions: CapabilityLevel[] = ["enabled", "read_only", "admin_only", "hidden"];

  const runDiagnose = async (integrationId: string) => {
    const headers = await withSupabaseAuthorization();
    const response = await fetch(`/api/os/integrations/diagnose?integration_id=${encodeURIComponent(integrationId)}`, {
      credentials: "include",
      cache: "no-store",
      headers,
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok: true; diagnosis: { suggested_next_action: string; safe_error_details: string | null; error_code: string | null } }
      | { ok: false; error?: string }
      | null;
    if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
      setIntegrationDiagnosisById((previous) => ({ ...previous, [integrationId]: "Diagnose unavailable" }));
      return;
    }
    const message = payload.diagnosis.safe_error_details
      ? `${payload.diagnosis.suggested_next_action} · ${payload.diagnosis.safe_error_details}`
      : payload.diagnosis.suggested_next_action;
    setIntegrationDiagnosisById((previous) => ({ ...previous, [integrationId]: message }));
  };

  const startIntegrationConnect = async (connectUrl: string | null) => {
    if (!connectUrl) return;
    if (connectUrl.startsWith("/api/workspaces/") && connectUrl.includes("/integrations/") && connectUrl.endsWith("/connect")) {
      try {
        const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });
        const response = await fetch(connectUrl, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({}),
        });
        const payload = (await response.json().catch(() => null)) as
          | { connectUrl?: string; hint?: string; error?: string }
          | null;
        if (!response.ok || !payload?.connectUrl) {
          throw new Error(payload?.hint || payload?.error || "Unable to start integration connect.");
        }
        window.location.href = payload.connectUrl;
        return;
      } catch {
        // fallback to direct open
      }
    }
    window.location.href = connectUrl;
  };

  return (
    <section className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/90 p-4 backdrop-blur-xl">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Workspace Admin</p>
          <h3 className="text-[16px] font-semibold text-[color:var(--text-primary)]">Premium Control Center</h3>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[11px] text-[color:var(--text-secondary)]">
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      {!canUseAdmin ? (
        <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4 text-[12px] text-[color:var(--text-muted)]">
          Admin controls are available for owner/admin/manager roles.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] ${
                  activeTab === tab.id
                    ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                    : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {state.loading ? <TabLoading /> : null}
          {state.error ? <TabError message={state.error} onRetry={() => void load()} /> : null}
          {!state.loading && !state.error && section?.state === "error" ? <TabError message={section.error_message_safe ?? "Temporarily unavailable"} onRetry={() => void load()} /> : null}
          {!state.loading && !state.error && section?.state === "empty" ? <TabEmpty label={TABS.find((entry) => entry.id === activeTab)?.label ?? "Tab"} /> : null}

          {!state.loading && !state.error && section?.state === "ready" && section.data ? (
            <>
              {activeTab === "capabilities" ? (
                <div className="space-y-4">
                  <article className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                    <h4 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Surface Access</h4>
                    <div className="space-y-2">
                      {Object.entries(state.payload?.sections.capabilities.data?.surfaces ?? {}).map(([surfaceId, status]) => (
                        <div key={surfaceId} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 py-2">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[12px] text-[color:var(--text-secondary)]">{surfaceId}</span>
                            <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">{status}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {capabilityOptions.map((option) => (
                              <button
                                key={`${surfaceId}-${option}`}
                                type="button"
                                disabled={!isOwner}
                                onClick={() => void patchCapability("surface", surfaceId, option)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                                  status === option
                                    ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                                    : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"
                                } disabled:opacity-50`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                    <h4 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Capability Flags</h4>
                    <div className="space-y-2">
                      {(state.payload?.sections.capabilities.data?.feature_flags ?? []).map((feature) => (
                        <div key={feature.id} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 py-2">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[12px] text-[color:var(--text-secondary)]">{feature.label}</span>
                            <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">{feature.status}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {capabilityOptions.map((option) => (
                              <button
                                key={`${feature.id}-${option}`}
                                type="button"
                                disabled={!isOwner}
                                onClick={() => void patchCapability("capability", feature.id, option)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                                  feature.status === option
                                    ? "border-[color:var(--os-border-strong)] bg-[color:var(--bg-surface-soft)] text-[color:var(--text-primary)]"
                                    : "border-[color:var(--os-border-soft)] text-[color:var(--text-muted)]"
                                } disabled:opacity-50`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                    <h4 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Manifest Pack: Install & Enable</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(state.payload?.sections.capabilities.data?.apps_manifest_pack ?? []).map((app) => (
                        <div key={app.app_id} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{app.name}</p>
                            <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                              {app.installed ? (app.enabled ? "enabled" : "disabled") : "not installed"}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{app.category}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {app.risk_badges.map((badge) => (
                              <span key={`${app.app_id}-${badge}`} className="rounded-full border border-amber-300/45 bg-amber-500/12 px-2 py-0.5 text-[10px] text-amber-900">
                                {badge}
                              </span>
                            ))}
                            {app.policy_badges.map((badge) => (
                              <span key={`${app.app_id}-${badge}`} className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">
                                {badge}
                              </span>
                            ))}
                          </div>
                          {app.blocked_reason ? (
                            <p className="mt-2 rounded-md border border-rose-300/45 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700">
                              Blocked: {app.blocked_reason}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {!app.installed ? (
                              <button type="button" disabled={!isOwner} onClick={() => void patchApp(app.app_id, "install")} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)] disabled:opacity-50">
                                Install
                              </button>
                            ) : (
                              <>
                                {app.enabled ? (
                                  <button type="button" disabled={!isOwner} onClick={() => void patchApp(app.app_id, "disable")} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)] disabled:opacity-50">
                                    Disable
                                  </button>
                                ) : (
                                  <button type="button" disabled={!isOwner} onClick={() => void patchApp(app.app_id, "enable")} className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)] disabled:opacity-50">
                                    Enable
                                  </button>
                                )}
                                <button type="button" disabled={!isOwner} onClick={() => void patchApp(app.app_id, "uninstall")} className="rounded-full border border-rose-300/45 bg-rose-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-rose-700 disabled:opacity-50">
                                  Uninstall
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {!isOwner ? (
                      <p className="mt-3 text-[11px] text-[color:var(--text-muted)]">Guardrail: only workspace owner can modify capabilities or app install/enable state.</p>
                    ) : null}
                  </article>
                </div>
              ) : activeTab === "integrations" ? (
                <div className="space-y-4">
                  <article className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                    <h4 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Integrations Center</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(state.payload?.sections.integrations.data?.entries ?? []).map((integration) => (
                        <div key={integration.integration_id} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{integration.integration_id}</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                              integration.state === "connected"
                                ? "border-emerald-300/35 bg-emerald-500/12 text-emerald-800"
                                : integration.state === "degraded" || integration.state === "needs_auth"
                                  ? "border-amber-300/45 bg-amber-500/15 text-amber-900"
                                  : "border-[var(--border-strong)] bg-[var(--panel2)] text-[var(--text-secondary)]"
                            }`}>
                              {integration.state}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">Last refresh: {integration.last_refresh_at ? new Date(integration.last_refresh_at).toLocaleString() : "never"}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {integration.scopes.length === 0 ? (
                              <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">No scopes</span>
                            ) : (
                              integration.scopes.map((scope) => (
                                <span key={`${integration.integration_id}-${scope}`} className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">
                                  {scope}
                                </span>
                              ))
                            )}
                          </div>
                          {integration.safe_error_details ? (
                            <p className="mt-2 rounded-md border border-rose-300/45 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700">
                              {integration.safe_error_details}
                            </p>
                          ) : null}
                          {integration.blocked_reason ? (
                            <p className="mt-2 rounded-md border border-amber-300/45 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-900">
                              Blocked: {integration.blocked_reason}
                            </p>
                          ) : null}
                          {integrationDiagnosisById[integration.integration_id] ? (
                            <p className="mt-2 rounded-md border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2 py-1 text-[11px] text-[color:var(--text-secondary)]">
                              Diagnose: {integrationDiagnosisById[integration.integration_id]}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={!integration.can_connect || !integration.connect_url}
                              onClick={() => {
                                void startIntegrationConnect(integration.connect_url);
                              }}
                              className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)] disabled:opacity-50"
                            >
                              {integration.state === "connected" ? "Reconnect" : "Connect"}
                            </button>
                            <button
                              type="button"
                              disabled={!integration.can_diagnose}
                              onClick={() => void runDiagnose(integration.integration_id)}
                              className="rounded-full border border-[color:var(--os-border-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)] disabled:opacity-50"
                            >
                              Diagnose
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              ) : activeTab === "system_health" ? (
                <div className="space-y-4">
                  <article className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                    <h4 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">System Health</h4>
                    <div className="space-y-2">
                      {(state.payload?.sections.system_health.data?.metrics ?? []).map((metric) => (
                        <div key={metric.bucket_start} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3 text-[11px] text-[color:var(--text-secondary)]">
                          <div className="mb-1 text-[12px] font-medium text-[color:var(--text-primary)]">
                            {new Date(metric.bucket_start).toLocaleString()}
                          </div>
                          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                            <div>Run success: {metric.run_success_rate ?? 0}</div>
                            <div>Queue lag: {metric.queue_lag ?? 0}s</div>
                            <div>P95 tool latency: {metric.p95_tool_latency ?? 0}ms</div>
                            <div>Approval time: {metric.approval_time ?? 0}</div>
                            <div>Auth failures: {metric.auth_failure_rate ?? 0}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              ) : activeTab === "incidents" ? (
                <div className="space-y-4">
                  <article className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                    <h4 className="mb-2 text-[13px] font-semibold text-[color:var(--text-primary)]">Incidents</h4>
                    <div className="space-y-2">
                      {(state.payload?.sections.incidents.data?.entries ?? []).map((incident) => (
                        <div key={incident.id} className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[12px] font-medium text-[color:var(--text-primary)]">{incident.summary}</p>
                            <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                              {incident.severity} · {incident.status}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                            {incident.incident_type} · {new Date(incident.opened_at).toLocaleString()}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {incident.affected_runs.length === 0 ? (
                              <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">No affected runs recorded</span>
                            ) : (
                              incident.affected_runs.map((runId) => (
                                <span key={`${incident.id}-${runId}`} className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">
                                  run:{runId}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              ) : (
                <div className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
                  <pre className="whitespace-pre-wrap text-[12px] text-[color:var(--text-secondary)]">
                    {JSON.stringify(section.data, null, 2)}
                  </pre>
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
