"use client";

import { useEffect, useState } from "react";
import { fetchAssistantJson } from "@/lib/apiClient";

type ApprovalRecord = {
  id: string;
  state: string;
  proposal_json: { run_id?: string; method?: string; host?: string } | null;
  created_at: number;
};

export default function AppApprovalsWindow() {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const payload = await fetchAssistantJson<{ approvals: ApprovalRecord[] }>("/v1/approvals", { method: "GET" });
      setApprovals(payload.approvals ?? []);
    } catch {
      setApprovals([]);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, []);

  const approve = async (entry: ApprovalRecord) => {
    const runId = entry.proposal_json?.run_id;
    if (!runId) return;
    setBusyId(entry.id);
    try {
      await fetchAssistantJson(`/v1/runs/${runId}/approve`, { method: "POST" });
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="ec-panel ec-panel-scroll" style={{ padding: 14 }}>
      <p className="ec-overline">Pending Approvals</p>
      <div className="ec-list">
        {approvals.map((entry) => (
          <article key={entry.id} className="ec-card">
            <strong>{entry.state}</strong>
            <p>{entry.proposal_json?.method} {entry.proposal_json?.host}</p>
            <small>run: {entry.proposal_json?.run_id ?? "-"}</small>
            <button type="button" onClick={() => void approve(entry)} disabled={busyId === entry.id} className="ec-button ec-button--primary">
              {busyId === entry.id ? "Approving..." : "Approve"}
            </button>
          </article>
        ))}
        {approvals.length === 0 ? <p>No pending approvals.</p> : null}
      </div>
    </section>
  );
}
