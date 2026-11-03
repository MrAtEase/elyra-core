"use client";

import { useMemo } from "react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

export default function AppSettingsWindow() {
  const { data } = useWorkspaceData();
  const role = useMemo(() => data?.membership?.role ?? "member", [data?.membership?.role]);

  return (
    <section className="ec-panel ec-panel-scroll" style={{ padding: 14 }}>
      <p className="ec-overline">Settings</p>
      <article className="ec-card">
        <strong>Workspace</strong>
        <p>Elyra Core Workspace</p>
        <small>Single workspace mode</small>
      </article>
      <article className="ec-card">
        <strong>User</strong>
        <p>{data?.user?.email ?? "-"}</p>
        <small>Role: {role}</small>
      </article>
      <article className="ec-card">
        <strong>Security</strong>
        <p>Approvals, Audit, Quotas and Policy Gates are enforced in runtime.</p>
      </article>
    </section>
  );
}
