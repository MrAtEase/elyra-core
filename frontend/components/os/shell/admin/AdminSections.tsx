"use client";

/**
 * Workspace Admin › Marketplace, Policies, Health, Billing, AI – real data via /api/os/admin/control.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle, Zap } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { APP_REGISTRY } from "@/components/os/kernel/appRegistry";
import McpMarketplace from "@/components/os/shell/admin/McpMarketplace";

type Section = "marketplace" | "policies" | "health" | "billing" | "ai";

const card = "rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4";
const h4 = "text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]";
const btn = "rounded-full border border-[color:var(--os-border-soft)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:opacity-50";
const input = "rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-[12px] text-[color:var(--text-primary)] outline-none";

async function api<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: await withSupabaseAuthorization(body ? { "Content-Type": "application/json" } : undefined),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !data || data.ok === false) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

function useSection<T>(workspaceId: string, section: Section) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>("GET", `/api/os/admin/control?workspaceId=${encodeURIComponent(workspaceId)}&section=${section}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, section]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

function Header({ title, subtitle, onReload, loading, right }: { title: string; subtitle: string; onReload?: () => void; loading?: boolean; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className={h4}>{title}</h4>
        <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {right}
        {onReload ? (
          <button type="button" onClick={onReload} className={`${btn} inline-flex items-center gap-1`} disabled={loading}>
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Aktualisieren
          </button>
        ) : null}
      </div>
    </div>
  );
}

function State({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="flex items-center gap-2 py-6 text-[12px] text-[color:var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Lade …</div>;
  if (error) return (
    <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-[12px] text-rose-600">
      {error} <button type="button" onClick={onRetry} className="ml-2 underline">Erneut versuchen</button>
    </div>
  );
  return null;
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ background: on ? "var(--os-accent, #6366f1)" : "color-mix(in srgb, var(--text-muted) 35%, transparent)" }}>
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }} />
    </button>
  );
}

const StatusIcon = ({ status }: { status: "ok" | "warn" | "fail" }) =>
  status === "ok" ? <CheckCircle2 size={16} className="text-emerald-500" /> : status === "warn" ? <AlertTriangle size={16} className="text-amber-500" /> : <XCircle size={16} className="text-rose-500" />;

// ── Marketplace ─────────────────────────────────────────────────────────────

type MarketApp = { app_id: string; name: string; description: string; category: string; installed: boolean; enabled: boolean; tools: number; risk: string[]; needs_integration: string[] };

function Marketplace({ workspaceId, onOpenApp }: { workspaceId: string; onOpenApp?: (id: string) => void }) {
  const { data, error, loading, reload } = useSection<{ apps: MarketApp[]; role: string }>(workspaceId, "marketplace");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function patch(appId: string, action: "install" | "enable" | "disable" | "uninstall") {
    setBusy(appId); setNote(null);
    try {
      await api("POST", "/api/os/workspace-admin/apps", undefined).catch(() => undefined); // warm (no-op if unsupported)
    } catch { /* ignore */ }
    try {
      const res = await fetch("/api/os/workspace-admin/apps", {
        method: "PATCH", credentials: "include",
        headers: await withSupabaseAuthorization({ "Content-Type": "application/json" }),
        body: JSON.stringify({ app_id: appId, action, workspaceId }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || j?.ok === false) throw new Error(j?.error ?? `Fehler ${res.status}`);
      await reload();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const native = APP_REGISTRY.filter((a) => a.id !== "settings_ai");

  return (
    <div>
      <Header title="Marketplace" subtitle="Apps für diesen Workspace installieren, aktivieren oder deaktivieren." onReload={() => void reload()} loading={loading} />
      <State loading={loading && !data} error={error} onRetry={() => void reload()} />
      {note ? <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-[12px] text-amber-700">{note}</p> : null}
      {data ? (
        <div className="grid gap-3 md:grid-cols-2">
          {data.apps.map((app) => (
            <div key={app.app_id} className={card}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{app.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-[color:var(--text-muted)]">{app.description}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${app.installed && app.enabled ? "bg-emerald-500/12 text-emerald-700" : app.installed ? "bg-amber-500/12 text-amber-700" : "bg-[color:var(--bg-surface-hover)] text-[color:var(--text-muted)]"}`}>
                  {app.installed ? (app.enabled ? "Aktiv" : "Deaktiviert") : "Nicht installiert"}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">{app.tools} Werkzeuge · {app.category}{app.needs_integration.length ? ` · braucht ${app.needs_integration.join(", ")}` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {busy === app.app_id ? <Loader2 size={14} className="animate-spin text-[color:var(--text-muted)]" /> : !app.installed ? (
                  <button type="button" className={btn} onClick={() => void patch(app.app_id, "install")}>Installieren</button>
                ) : (
                  <>
                    <button type="button" className={btn} onClick={() => void patch(app.app_id, app.enabled ? "disable" : "enable")}>{app.enabled ? "Deaktivieren" : "Aktivieren"}</button>
                    <button type="button" className={`${btn} text-rose-600`} onClick={() => void patch(app.app_id, "uninstall")}>Deinstallieren</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <McpMarketplace workspaceId={workspaceId} />

      <div className="mt-8">
        <h4 className={h4}>Elyra-Apps (immer verfügbar)</h4>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {native.map((a) => (
            <button key={a.id} type="button" onClick={() => onOpenApp?.(a.id)} className={`${card} flex items-center gap-2 p-3 text-left transition hover:bg-[color:var(--bg-surface-hover)]`}>
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-[color:var(--bg-elevated)] text-[13px]">{a.icon}</span>
              <span className="truncate text-[12.5px] text-[color:var(--text-primary)]">{a.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Policies ────────────────────────────────────────────────────────────────

type ToolPolicy = { tool_name: string; app_id: string; risk_level: string; requires_approval: boolean; status: string };
type AuditEntry = { action: string; target_type: string; target_id: string | null; created_at: string };

const RISK_LABEL: Record<string, string> = { read_only: "Nur lesen", writes: "Schreibt", destructive: "Löscht/Sendet" };

function Policies({ workspaceId }: { workspaceId: string }) {
  const { data, error, loading, reload } = useSection<{ tools: ToolPolicy[]; audit: AuditEntry[]; role: string }>(workspaceId, "policies");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "writes" | "destructive">("all");

  async function post(key: string, body: Record<string, unknown>) {
    setBusy(key); setNote(null);
    try { await api("POST", "/api/os/admin/control", { workspaceId, ...body }); await reload(); }
    catch (err) { setNote((err as Error).message); }
    finally { setBusy(null); }
  }

  const tools = data?.tools ?? [];
  const byRisk = (r: string) => tools.filter((t) => t.risk_level === r);
  const allNeed = (r: string) => byRisk(r).length > 0 && byRisk(r).every((t) => t.requires_approval);
  const shown = tools.filter((t) => filter === "all" || t.risk_level === filter);

  return (
    <div>
      <Header title="Policies" subtitle="Lege fest, welche Aktionen Elyra nur nach deiner Freigabe ausführen darf." onReload={() => void reload()} loading={loading} />
      <State loading={loading && !data} error={error} onRetry={() => void reload()} />
      {note ? <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-[12px] text-amber-700">{note}</p> : null}
      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {(["writes", "destructive"] as const).map((risk) => (
              <div key={risk} className={`${card} flex items-center justify-between gap-3`}>
                <div>
                  <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{risk === "writes" ? "Schreibende Aktionen" : "Senden & Löschen"}</p>
                  <p className="text-[11.5px] text-[color:var(--text-muted)]">{byRisk(risk).length} Werkzeuge · {allNeed(risk) ? "immer mit Freigabe" : "teilweise ohne Freigabe"}</p>
                </div>
                {busy === risk ? <Loader2 size={14} className="animate-spin" /> : (
                  <Toggle on={allNeed(risk)} onChange={(v) => void post(risk, { action: "risk_policy", risk_level: risk, requires_approval: v })} />
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <h4 className={h4}>Einzelne Werkzeuge</h4>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={input}>
              <option value="all">Alle</option><option value="writes">Schreibt</option><option value="destructive">Löscht/Sendet</option>
            </select>
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-[color:var(--os-border-soft)]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[color:var(--bg-surface)] text-[color:var(--text-muted)]">
                <tr><th className="px-3 py-2 font-medium">Werkzeug</th><th className="px-3 py-2 font-medium">App</th><th className="px-3 py-2 font-medium">Risiko</th><th className="px-3 py-2 font-medium">Freigabe nötig</th><th className="px-3 py-2 font-medium">Aktiv</th></tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.tool_name} className="border-t border-[color:var(--os-border-soft)]">
                    <td className="px-3 py-2 font-mono text-[11.5px] text-[color:var(--text-primary)]">{t.tool_name}</td>
                    <td className="px-3 py-2 text-[color:var(--text-secondary)]">{t.app_id}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10.5px] ${t.risk_level === "destructive" ? "bg-rose-500/12 text-rose-600" : t.risk_level === "writes" ? "bg-amber-500/12 text-amber-700" : "bg-emerald-500/12 text-emerald-700"}`}>{RISK_LABEL[t.risk_level] ?? t.risk_level}</span></td>
                    <td className="px-3 py-2">{busy === `a:${t.tool_name}` ? <Loader2 size={12} className="animate-spin" /> : <Toggle on={t.requires_approval} onChange={(v) => void post(`a:${t.tool_name}`, { action: "tool_policy", tool_name: t.tool_name, requires_approval: v })} />}</td>
                    <td className="px-3 py-2">{t.status === "policy_blocked" ? <span className="text-[11px] text-rose-600">gesperrt</span> : busy === `s:${t.tool_name}` ? <Loader2 size={12} className="animate-spin" /> : <Toggle on={t.status === "enabled"} onChange={(v) => void post(`s:${t.tool_name}`, { action: "tool_policy", tool_name: t.tool_name, status: v ? "enabled" : "disabled" })} />}</td>
                  </tr>
                ))}
                {shown.length === 0 ? <tr><td colSpan={5} className="px-3 py-4 text-center text-[color:var(--text-muted)]">Keine Werkzeuge registriert.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <h4 className={`${h4} mt-6`}>Änderungsprotokoll</h4>
          <div className="mt-2 space-y-1">
            {data.audit.length === 0 ? <p className="text-[12px] text-[color:var(--text-muted)]">Noch keine Änderungen.</p> : data.audit.map((a, i) => (
              <div key={i} className="flex justify-between gap-3 rounded-lg bg-[color:var(--bg-surface)] px-3 py-1.5 text-[11.5px]">
                <span className="text-[color:var(--text-secondary)]">{a.action} · {a.target_id ?? a.target_type}</span>
                <span className="text-[color:var(--text-muted)]">{new Date(a.created_at).toLocaleString("de-DE")}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────

type Check = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; ms?: number };

function Health({ workspaceId }: { workspaceId: string }) {
  const { data, error, loading, reload } = useSection<{ checks: Check[]; checked_at: string }>(workspaceId, "health");
  const summary = useMemo(() => {
    const c = data?.checks ?? [];
    return { ok: c.filter((x) => x.status === "ok").length, warn: c.filter((x) => x.status === "warn").length, fail: c.filter((x) => x.status === "fail").length };
  }, [data]);
  return (
    <div>
      <Header title="Health" subtitle="Live-Prüfung aller Dienste, die Elyra braucht." onReload={() => void reload()} loading={loading}
        right={data ? <span className="text-[11px] text-[color:var(--text-muted)]">{summary.ok} ok · {summary.warn} Warnung · {summary.fail} Fehler</span> : null} />
      <State loading={loading && !data} error={error} onRetry={() => void reload()} />
      {data ? (
        <div className="space-y-2">
          {data.checks.map((c) => (
            <div key={c.id} className={`${card} flex items-center gap-3 py-3`}>
              <StatusIcon status={c.status} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{c.label}</p>
                <p className="truncate text-[11.5px] text-[color:var(--text-muted)]">{c.detail}</p>
              </div>
              {typeof c.ms === "number" ? <span className="text-[11px] tabular-nums text-[color:var(--text-muted)]">{c.ms} ms</span> : null}
            </div>
          ))}
          <p className="pt-1 text-[11px] text-[color:var(--text-muted)]">Geprüft: {new Date(data.checked_at).toLocaleTimeString("de-DE")}</p>
        </div>
      ) : null}
    </div>
  );
}

// ── Billing ─────────────────────────────────────────────────────────────────

type Usage = { month_start: string; runs: number | null; failed_runs: number | null; tool_calls: number | null; artifacts: number | null; tasks: number | null };
type Settings = { ai: { model: string | null; temperature: number; webResearch: boolean }; budget: { monthlyUsd: number | null; alertPct: number } };

function Billing({ workspaceId }: { workspaceId: string }) {
  const { data, error, loading, reload } = useSection<{ usage: Usage; settings: Settings; storage: string; storage_error: string | null; role: string }>(workspaceId, "billing");
  const [budget, setBudget] = useState("");
  const [alertPct, setAlertPct] = useState(80);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setBudget(data.settings.budget.monthlyUsd == null ? "" : String(data.settings.budget.monthlyUsd));
    setAlertPct(data.settings.budget.alertPct);
  }, [data]);

  async function save() {
    setSaving(true); setNote(null);
    try {
      const value = budget.trim() === "" ? null : Number(budget.replace(",", "."));
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("Bitte eine gültige Zahl eingeben.");
      await api("POST", "/api/os/admin/control", { workspaceId, action: "save_settings", patch: { budget: { monthlyUsd: value, alertPct } } });
      setNote("Gespeichert.");
      await reload();
    } catch (err) { setNote((err as Error).message); }
    finally { setSaving(false); }
  }

  const u = data?.usage;
  const month = u ? new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(u.month_start)) : "";
  const stat = (label: string, value: number | null) => (
    <div className={card}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold tabular-nums text-[color:var(--text-primary)]">{value ?? "–"}</p>
    </div>
  );

  return (
    <div>
      <Header title="Billing & Nutzung" subtitle={`Echte Nutzung dieses Workspaces im ${month || "laufenden Monat"}.`} onReload={() => void reload()} loading={loading} />
      <State loading={loading && !data} error={error} onRetry={() => void reload()} />
      {data && u ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stat("KI-Läufe", u.runs)}{stat("Werkzeug-Aufrufe", u.tool_calls)}{stat("Ergebnisse/Artefakte", u.artifacts)}{stat("Aufgaben gesamt", u.tasks)}
          </div>
          {u.failed_runs ? <p className="mt-2 text-[11.5px] text-amber-700">{u.failed_runs} Läufe sind diesen Monat fehlgeschlagen.</p> : null}

          <div className={`${card} mt-5`}>
            <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Tarif</p>
            <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">Elyra läuft selbst gehostet – es gibt kein Elyra-Abo. Kosten entstehen nur bei den KI-Anbietern über deine eigenen API-Schlüssel.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer noopener" className={btn}>Gemini-Nutzung & Kosten ↗</a>
              <a href="https://console.cloud.google.com/billing" target="_blank" rel="noreferrer noopener" className={btn}>Google Cloud Billing ↗</a>
              <a href="https://supabase.com/dashboard/org/_/billing" target="_blank" rel="noreferrer noopener" className={btn}>Supabase ↗</a>
            </div>
          </div>

          <div className={`${card} mt-3`}>
            <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Monatsbudget</p>
            <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">Dein Zielwert für KI-Kosten. Setze dasselbe Limit zusätzlich als Budget-Warnung in Google Cloud – nur dort wird wirklich abgerechnet.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-secondary)]">
                Budget (USD)
                <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="z. B. 10" className={`${input} w-24`} inputMode="decimal" />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-secondary)]">
                Warnen ab
                <select value={alertPct} onChange={(e) => setAlertPct(Number(e.target.value))} className={input}>
                  {[50, 70, 80, 90, 100].map((p) => <option key={p} value={p}>{p} %</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void save()} disabled={saving || data.storage !== "db"} className={btn}>{saving ? "Speichere …" : "Speichern"}</button>
              {note ? <span className="text-[11.5px] text-[color:var(--text-muted)]">{note}</span> : null}
            </div>
            {data.storage !== "db" ? <p className="mt-2 text-[11.5px] text-amber-700">Speichern nicht möglich: {data.storage_error}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── AI ──────────────────────────────────────────────────────────────────────

type Provider = { id: string; label: string; configured: boolean; detail: string };

function AiSection({ workspaceId }: { workspaceId: string }) {
  const { data, error, loading, reload } = useSection<{ providers: Provider[]; models: string[]; settings: Settings; storage: string; storage_error: string | null; env_model: string | null }>(workspaceId, "ai");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.5);
  const [webResearch, setWebResearch] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; ms: number; detail: string } | "running">>({});

  useEffect(() => {
    if (!data) return;
    setModel(data.settings.ai.model ?? "");
    setTemperature(data.settings.ai.temperature);
    setWebResearch(data.settings.ai.webResearch);
  }, [data]);

  async function save() {
    setSaving(true); setNote(null);
    try {
      await api("POST", "/api/os/admin/control", { workspaceId, action: "save_settings", patch: { ai: { model: model || null, temperature, webResearch } } });
      setNote("Gespeichert – gilt ab der nächsten Anfrage.");
      await reload();
    } catch (err) { setNote((err as Error).message); }
    finally { setSaving(false); }
  }

  async function test(kind: "text" | "search") {
    setTests((t) => ({ ...t, [kind]: "running" }));
    try {
      const r = await api<{ result: { ok: boolean; ms: number; detail: string } }>("POST", "/api/os/admin/control", { workspaceId, action: "test_ai", kind, model: model || null });
      setTests((t) => ({ ...t, [kind]: r.result }));
    } catch (err) {
      setTests((t) => ({ ...t, [kind]: { ok: false, ms: 0, detail: (err as Error).message } }));
    }
  }

  const TestResult = ({ k }: { k: string }) => {
    const r = tests[k];
    if (!r) return null;
    if (r === "running") return <span className="flex items-center gap-1 text-[11.5px] text-[color:var(--text-muted)]"><Loader2 size={12} className="animate-spin" /> teste …</span>;
    return <span className={`flex items-center gap-1 text-[11.5px] ${r.ok ? "text-emerald-600" : "text-rose-600"}`}>{r.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {r.detail}{r.ms ? ` (${r.ms} ms)` : ""}</span>;
  };

  return (
    <div>
      <Header title="AI" subtitle="Anbieter, Modell und Verhalten der KI in diesem Workspace." onReload={() => void reload()} loading={loading} />
      <State loading={loading && !data} error={error} onRetry={() => void reload()} />
      {data ? (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {data.providers.map((p) => (
              <div key={p.id} className={`${card} flex items-center gap-3 py-3`}>
                <StatusIcon status={p.configured ? "ok" : "warn"} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[color:var(--text-primary)]">{p.label}</p>
                  <p className="truncate text-[11.5px] text-[color:var(--text-muted)]">{p.configured ? p.detail || "Konfiguriert" : "Kein API-Schlüssel in .env.local"}</p>
                </div>
              </div>
            ))}
          </div>

          <div className={`${card} mt-5 space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Standard-Modell</p>
                <p className="text-[11.5px] text-[color:var(--text-muted)]">Für Werkzeuge, Slides und Recherche. Leer = Vorgabe aus .env.local ({data.env_model ?? "Standard"}).</p>
              </div>
              <select value={model} onChange={(e) => setModel(e.target.value)} className={`${input} min-w-[240px]`}>
                <option value="">Vorgabe ({data.env_model ?? "Standard"})</option>
                {data.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Kreativität</p>
                <p className="text-[11.5px] text-[color:var(--text-muted)]">Niedrig = sachlich und gleichbleibend, hoch = kreativer.</p>
              </div>
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-40" />
                <span className="w-8 text-right text-[12px] tabular-nums text-[color:var(--text-secondary)]">{temperature.toFixed(1)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Web-Recherche</p>
                <p className="text-[11.5px] text-[color:var(--text-muted)]">Recherche und Slides nutzen die Google-Suche (braucht Gemini-Abrechnung).</p>
              </div>
              <Toggle on={webResearch} onChange={setWebResearch} />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--os-border-soft)] pt-3">
              <button type="button" onClick={() => void save()} disabled={saving || data.storage !== "db"} className={btn}>{saving ? "Speichere …" : "Speichern"}</button>
              {note ? <span className="text-[11.5px] text-[color:var(--text-muted)]">{note}</span> : null}
              {data.storage !== "db" ? <span className="text-[11.5px] text-amber-700">Speichern nicht möglich: {data.storage_error}</span> : null}
            </div>
          </div>

          <div className={`${card} mt-3`}>
            <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Verbindung testen</p>
            <p className="text-[11.5px] text-[color:var(--text-muted)]">Schickt eine winzige echte Anfrage an das gewählte Modell.</p>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void test("text")} className={`${btn} inline-flex items-center gap-1`}><Zap size={11} /> Modell</button><TestResult k="text" /></div>
              <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void test("search")} className={`${btn} inline-flex items-center gap-1`}><Zap size={11} /> Google-Suche</button><TestResult k="search" /></div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Entry ───────────────────────────────────────────────────────────────────

export default function AdminSections({ section, workspaceId, onOpenApp }: { section: Section; workspaceId: string; onOpenApp?: (id: string) => void }) {
  if (section === "marketplace") return <Marketplace workspaceId={workspaceId} {...(onOpenApp ? { onOpenApp } : {})} />;
  if (section === "policies") return <Policies workspaceId={workspaceId} />;
  if (section === "health") return <Health workspaceId={workspaceId} />;
  if (section === "billing") return <Billing workspaceId={workspaceId} />;
  return <AiSection workspaceId={workspaceId} />;
}
