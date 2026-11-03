"use client";

import { useEffect, useState } from "react";
import { fetchAssistantJson } from "@/lib/apiClient";

type AuditRecord = {
  id: string;
  action: string;
  domain: string;
  user_id: string;
  resource_id?: string | null;
  created_at: number;
  metadata_json?: Record<string, unknown> | null;
};

export default function AppAuditWindow() {
  const [audit, setAudit] = useState<AuditRecord[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const payload = await fetchAssistantJson<{ audit: AuditRecord[] }>("/v1/audit?limit=150", { method: "GET" });
        if (alive) setAudit(payload.audit ?? []);
      } catch {
        if (alive) setAudit([]);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="ec-panel ec-panel-scroll" style={{ padding: 14 }}>
      <p className="ec-overline">Audit Log</p>
      <div className="ec-list">
        {audit.map((entry) => (
          <article key={entry.id} className="ec-card">
            <strong>{entry.action}</strong>
            <p>{entry.domain}</p>
            <small>{entry.user_id}</small>
            <small>{entry.resource_id ?? "-"}</small>
          </article>
        ))}
        {audit.length === 0 ? <p>No audit entries.</p> : null}
      </div>
    </section>
  );
}
