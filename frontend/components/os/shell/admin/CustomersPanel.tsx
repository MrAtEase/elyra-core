"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Building2, Lock, RotateCcw, Search, User, Users } from "lucide-react";

type Customer = {
  id: string;
  name: string;
  kind: "company" | "individual";
  createdAt: number | null;
  members: number;
  ownerEmail: string | null;
  lastActiveAt: number | null;
  requests30d: number;
  costCents30d: number;
  suspendedAt: number | null;
  suspendedReason: string | null;
};

type Summary = {
  companies: number;
  individuals: number;
  users: number;
  active7d: number;
  suspended: number;
  requests30d: number;
};

const card = { borderColor: "var(--os-border-faint, rgba(255,255,255,0.08))", background: "var(--bg-elevated, rgba(255,255,255,0.03))" };

function formatDate(ms: number | null): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function relative(ms: number | null): string {
  if (!ms) return "nie";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return min <= 1 ? "gerade eben" : `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
}

const euro = (cents: number) => (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

type Filter = "all" | "company" | "individual" | "suspended";

/** Elyra Core › Workspace Admin › Kunden. Platform owner only; metadata, never content. */
export default function CustomersPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [suspendFor, setSuspendFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/os/platform/customers", { credentials: "include", cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { summary?: Summary; customers?: Customer[]; message?: string };
    if (response.ok && data.summary) {
      setSummary(data.summary);
      setCustomers(data.customers ?? []);
      setError(null);
    } else {
      setError(response.status === 403 ? "Nur für den Plattform-Owner." : data.message ?? "Kunden konnten nicht geladen werden.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (filter === "company" && c.kind !== "company") return false;
      if (filter === "individual" && c.kind !== "individual") return false;
      if (filter === "suspended" && !c.suspendedAt) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.ownerEmail ?? "").toLowerCase().includes(q);
    });
  }, [customers, filter, query]);

  async function setSuspended(customer: Customer, suspended: boolean) {
    setBusy(true);
    const response = await fetch(`/api/os/platform/customers/${customer.id}/suspension`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suspended, reason }),
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    setBusy(false);
    setSuspendFor(null);
    setReason("");
    if (!response.ok) setError(data.message ?? "Aktion fehlgeschlagen.");
    await load();
  }

  if (loading && !summary) {
    return <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Kunden werden geladen …</p>;
  }
  if (!summary) {
    return <p className="text-sm" style={{ color: "#f87171" }}>{error}</p>;
  }

  const stats: Array<[string, string | number]> = [
    ["Firmen", summary.companies],
    ["Einzelnutzer", summary.individuals],
    ["Nutzer gesamt", summary.users],
    ["Aktiv (7 Tage)", summary.active7d],
    ["KI-Aufrufe (30 Tage)", summary.requests30d.toLocaleString("de-DE")],
    ["Gesperrt", summary.suspended],
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--text-tertiary)" }}>Plattform</p>
        <h2 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Kunden</h2>
        <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          <Lock size={11} /> Nur Kennzahlen. Inhalte wie Mails, Termine, Dokumente oder Chats sind hier nicht einsehbar.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border px-4 py-2.5 text-xs" style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "#f87171" }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border p-3" style={card}>
            <p className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-tertiary)" }}>{label}</p>
            <p className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name oder Owner-E-Mail suchen"
            className="w-full rounded-xl border bg-transparent py-2 pl-8 pr-3 text-sm outline-none"
            style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
          />
        </div>
        {(
          [
            ["all", "Alle"],
            ["company", "Firmen"],
            ["individual", "Einzelnutzer"],
            ["suspended", "Gesperrt"],
          ] as Array<[Filter, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className="rounded-xl border px-3 py-1.5 text-xs transition"
            style={{
              borderColor: filter === id ? "var(--os-accent)" : "var(--os-border-faint)",
              color: filter === id ? "var(--os-accent)" : "var(--text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border" style={card}>
        <div
          className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_70px_110px_110px_120px] gap-3 px-4 py-2 text-[10px] uppercase tracking-[0.12em] md:grid"
          style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--os-border-faint)" }}
        >
          <span>Workspace</span>
          <span>Owner</span>
          <span>Nutzer</span>
          <span>Zuletzt aktiv</span>
          <span>KI (30 T.)</span>
          <span />
        </div>
        {visible.length === 0 && (
          <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>Keine Kunden gefunden.</p>
        )}
        {visible.map((c, index) => (
          <div key={c.id} style={{ borderTop: index ? "1px solid var(--os-border-faint)" : undefined }}>
            <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_70px_110px_110px_120px] md:items-center md:gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg"
                  style={{ background: c.kind === "company" ? "rgba(96,165,250,0.14)" : "rgba(148,163,184,0.12)", color: c.kind === "company" ? "#60a5fa" : "#94a3b8" }}
                >
                  {c.kind === "company" ? <Building2 size={14} /> : <User size={14} />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {c.kind === "individual" && /^(personal|persönlich)$/i.test(c.name.trim()) ? c.ownerEmail ?? c.name : c.name}
                    {c.suspendedAt && (
                      <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(239,68,68,0.14)", color: "#f87171" }}>
                        Gesperrt
                      </span>
                    )}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {c.kind === "company" ? "Firma" : "Einzelnutzer"} · seit {formatDate(c.createdAt)}
                  </p>
                </div>
              </div>
              <span className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>{c.ownerEmail ?? "–"}</span>
              <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                <Users size={11} /> {c.members}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{relative(c.lastActiveAt)}</span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {c.requests30d.toLocaleString("de-DE")}
                {c.costCents30d > 0 ? ` · ${euro(c.costCents30d)}` : ""}
              </span>
              <div className="flex justify-start md:justify-end">
                {c.kind === "company" &&
                  (c.suspendedAt ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setSuspended(c, false)}
                      className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-40"
                      style={{ borderColor: "var(--os-border-faint)", color: "var(--text-primary)" }}
                    >
                      <RotateCcw size={11} /> Entsperren
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSuspendFor(suspendFor === c.id ? null : c.id);
                        setReason("");
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] transition hover:bg-white/10"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      <Ban size={11} /> Sperren
                    </button>
                  ))}
              </div>
            </div>
            {c.suspendedAt && c.suspendedReason && (
              <p className="px-4 pb-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Gesperrt am {formatDate(c.suspendedAt)}: {c.suspendedReason}
              </p>
            )}
            {suspendFor === c.id && (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Grund (optional), z. B. offene Rechnung"
                  maxLength={200}
                  className="min-w-[220px] flex-1 rounded-lg border bg-transparent px-3 py-1.5 text-xs outline-none"
                  style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--text-primary)" }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setSuspended(c, true)}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                  style={{ background: "#ef4444" }}
                >
                  Workspace sperren
                </button>
                <span className="w-full text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  Mitglieder verlieren sofort den Zugriff. Daten bleiben erhalten, Entsperren ist jederzeit möglich.
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
