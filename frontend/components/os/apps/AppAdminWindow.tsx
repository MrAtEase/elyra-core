"use client";

import { useEffect, useState } from "react";
import { fetchAssistantJson } from "@/lib/apiClient";

type UsagePayload = {
  day_utc: string;
  usage: { requests_count: number; tokens_count: number; cost_cents: number };
  quota: { requests_per_day: number; tokens_per_day: number; cost_cents_per_day: number };
  remaining: { requests: number; tokens: number; cost_cents: number };
};

export default function AppAdminWindow() {
  const [usage, setUsage] = useState<UsagePayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const payload = await fetchAssistantJson<UsagePayload>("/v1/usage", { method: "GET" });
        if (alive) setUsage(payload);
      } catch {
        if (alive) setUsage(null);
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
      <p className="ec-overline">Admin</p>
      <article className="ec-card">
        <strong>Policies</strong>
        <p>Default deny tools; only http_request allowlisted with host/method restrictions.</p>
      </article>
      <article className="ec-card">
        <strong>Quotas</strong>
        <p>Requests/day: {usage?.quota.requests_per_day ?? "-"}</p>
        <p>Tokens/day: {usage?.quota.tokens_per_day ?? "-"}</p>
        <p>Cost/day (cents): {usage?.quota.cost_cents_per_day ?? "-"}</p>
      </article>
      <article className="ec-card">
        <strong>Usage ({usage?.day_utc ?? "-"})</strong>
        <p>Requests: {usage?.usage.requests_count ?? "-"}</p>
        <p>Tokens: {usage?.usage.tokens_count ?? "-"}</p>
        <p>Cost (cents): {usage?.usage.cost_cents ?? "-"}</p>
      </article>
    </section>
  );
}
