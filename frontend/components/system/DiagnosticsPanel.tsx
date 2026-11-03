"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

type EmailIoHealth = {
  ok: boolean;
  status: number | null;
  detail: string;
  url: string | null;
  timestamp: number;
};

export default function DiagnosticsPanel() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace ?? null;
  const userEmail = data?.user?.email ?? "not signed in";
  const [health, setHealth] = useState<EmailIoHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchHealth = useCallback(async (force?: boolean) => {
    try {
      const response = await fetch(`/api/dev/email-io-health${force ? "?force=1" : ""}`, {
        headers: { "x-diagnostics": "1" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(response.statusText || "Health check failed");
      }
      const payload = (await response.json()) as EmailIoHealth;
      setHealth(payload);
      setHealthError(null);
    } catch (error) {
      setHealth(null);
      setHealthError(error instanceof Error ? error.message : "Unable to reach health endpoint");
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const workspaceLabel =
    workspace?.name || workspace?.slug ? `${workspace?.name ?? workspace?.slug} (${workspace?.slug})` : "None";
  const providerRows = [
    {
      label: "Mail provider",
      value: "iCloud IMAP",
    },
    {
      label: "Calendar provider",
      value: "iCloud CalDAV",
    },
  ];
  const healthLabel = health?.ok ? "reachable" : "unreachable";
  const healthTimestamp =
    health?.timestamp && Number.isFinite(health.timestamp)
      ? new Date(health.timestamp).toLocaleTimeString()
      : null;

  return (
    <div className="workspace-main-panel__status-card diagnostics-panel">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">Diagnostics</p>
        <p className="workspace-main-panel__desc">Automatic status, provider, and health telemetry.</p>
      </div>
      <div className="diagnostics-panel__grid">
        <div className="diagnostics-panel__row">
          <span className="diagnostics-panel__label">Workspace</span>
          <span className="diagnostics-panel__value">{workspaceLabel}</span>
        </div>
        <div className="diagnostics-panel__row">
          <span className="diagnostics-panel__label">Workspace ID</span>
          <span className="diagnostics-panel__value">{workspace?.id ?? "none"}</span>
        </div>
        <div className="diagnostics-panel__row">
          <span className="diagnostics-panel__label">User email</span>
          <span className="diagnostics-panel__value">{userEmail}</span>
        </div>
        {providerRows.map((row) => (
          <div key={row.label} className="diagnostics-panel__row">
            <span className="diagnostics-panel__label">{row.label}</span>
            <span className="diagnostics-panel__value">{row.value}</span>
          </div>
        ))}
        <div className="diagnostics-panel__row diagnostics-panel__health">
          <span className="diagnostics-panel__label">API gateway health</span>
          <span className="diagnostics-panel__value">
            {health ? (
              <>
                <strong>{healthLabel}</strong>
                <span>
                  {health.status ?? "?"} · {health.detail || "no detail"}
                </span>
                <span>{health.url ?? "no url"}</span>
                {healthTimestamp && <span>{healthTimestamp}</span>}
              </>
            ) : (
              <strong>{healthError ?? "pending"}</strong>
            )}
          </span>
        </div>
        <div className="diagnostics-panel__row diagnostics-panel__health-actions">
          <button
            type="button"
            className="workspace-main-panel__button"
            onClick={() => void fetchHealth(true)}
          >
            Refresh health
          </button>
        </div>
        <div className="diagnostics-panel__row">
          <span className="diagnostics-panel__label">Last error</span>
          <span className="diagnostics-panel__value">
{"None recorded"}
          </span>
        </div>
      </div>
    </div>
  );
}
