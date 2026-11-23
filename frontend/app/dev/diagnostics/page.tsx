"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import type { EmailIoHealthStatus } from "@/lib/emailIoHealth";

const formatTimestamp = (value?: number) => {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(value));
};

const mailProviderLabel = (key: string) =>
  key === "icloud_imap" ? "iCloud IMAP" : key;
const calendarProviderLabel = (key: string) =>
  key === "icloud_caldav" ? "iCloud CalDAV" : key;

export default function DiagnosticsPage() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace ?? null;
  const [health, setHealth] = useState<EmailIoHealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const fetchHealth = useCallback(
    async (force = false) => {
      setCheckingHealth(true);
      setHealthError(null);
      try {
        const endpoint = `/api/dev/email-io-health${force ? "?force=1" : ""}`;
        const response = await fetch(endpoint, {
          credentials: "include",
        });
        const payload = (await response.json()) as EmailIoHealthStatus;
        setHealth(payload);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to query email-io health";
        setHealthError(message);
      } finally {
        setCheckingHealth(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const providerSummary = useMemo(() => {
    return "iCloud (mail/calendar)";
  }, []);

  return (
    <main
      style={{
        padding: "2.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      <header>
        <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>Diagnostics</h1>
        <p style={{ margin: 0, color: "var(--text-subtle)" }}>
          Workspace policy &amp; API health snapshot.
        </p>
        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            onClick={() => void fetchHealth(true)}
            disabled={checkingHealth}
            style={{
              borderRadius: "999px",
              border: "1px solid rgba(59, 130, 246, 0.4)",
              background: "rgba(59, 130, 246, 0.12)",
              padding: "0.4rem 1.2rem",
              cursor: checkingHealth ? "not-allowed" : "pointer",
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            {checkingHealth ? "Refreshing…" : "Refresh health"}
          </button>
        </div>
      </header>

      <section
        style={{
          border: "1px solid rgba(148, 163, 184, 0.4)",
          borderRadius: "1.25rem",
          padding: "1.25rem",
          background: "rgba(15, 23, 42, 0.4)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", textTransform: "uppercase" }}>Workspace</h2>
        <dl style={{ marginTop: "0.85rem", display: "grid", gap: "0.4rem" }}>
          <div>
            <dt style={{ fontSize: "0.75rem", color: "#94a3b8" }}>ID</dt>
            <dd style={{ margin: 0 }}>{workspace?.id ?? "—"}</dd>
          </div>
          <div>
            <dt style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Slug</dt>
            <dd style={{ margin: 0 }}>{workspace?.slug ?? "—"}</dd>
          </div>
          <div>
            <dt style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Name</dt>
            <dd style={{ margin: 0 }}>{workspace?.name ?? "—"}</dd>
          </div>
          <div>
            <dt style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Whoami email</dt>
            <dd style={{ margin: 0 }}>{data?.user?.email ?? "anonymous"}</dd>
          </div>
          <div>
            <dt style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Connected provider</dt>
            <dd style={{ margin: 0 }}>{providerSummary}</dd>
          </div>
        </dl>
      </section>

      <section
        style={{
          border: "1px solid rgba(14, 165, 233, 0.4)",
          borderRadius: "1.25rem",
          padding: "1.25rem",
          background: "rgba(2, 132, 199, 0.08)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", textTransform: "uppercase" }}>API gateway health</h2>
        <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <span
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: "999px",
              background: health?.ok ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: health?.ok ? "#0f766e" : "#b91c1c",
              fontWeight: 600,
            }}
          >
            {health?.ok ? "OK" : "FAILED"}
          </span>
          <span style={{ color: "var(--text-subtle)" }}>
            {health ? `HTTP ${health.status ?? "n/a"}` : "No check yet"}
          </span>
          <span style={{ color: "var(--text-subtle)" }}>
            {health ? `Last checked ${formatTimestamp(health.timestamp)}` : ""}
          </span>
        </div>
        <p style={{ marginTop: "0.75rem" }}>
          {health?.detail ?? healthError ?? "Health response pending."}
        </p>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8" }}>
          {health?.url ?? "gateway URL unknown"}
        </p>
        {healthError && (
          <p style={{ marginTop: "0.5rem", color: "#fbbf24" }}>
            {healthError}
          </p>
        )}
      </section>

      <section
        style={{
          border: "1px dashed rgba(248, 250, 252, 0.3)",
          borderRadius: "1.25rem",
          padding: "1.25rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", textTransform: "uppercase" }}>Last error</h2>
        <p style={{ marginTop: "0.75rem" }}>
          {"No recent diagnostics errors."}
        </p>
      </section>
    </main>
  );
}
