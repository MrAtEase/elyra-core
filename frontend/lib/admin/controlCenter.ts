/**
 * Workspace Admin – real data for Marketplace, Policies, Health, Billing (usage) and AI.
 * Replaces the former placeholder/demo values.
 *
 * Settings live in public.workspace_policies.settings (jsonb, migration 0013).
 */
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildBootstrapContractFromDb, appendAdminAuditLog } from "@/lib/orb-os/contracts/store";
import { buildRuntimeIntegrationStatus } from "@/lib/orb-os/contracts/integrationStatus";
import { loadStoredGoogleTokens } from "@/lib/google/tokenStore";

// ── Settings ────────────────────────────────────────────────────────────────

/** Stored in public.workspace_policies.settings (jsonb, migration 0013). */
export type ElyraSettings = {
  ai: { model: string | null; temperature: number; webResearch: boolean };
  budget: { monthlyUsd: number | null; alertPct: number };
};

export const DEFAULT_SETTINGS: ElyraSettings = {
  ai: { model: null, temperature: 0.5, webResearch: true },
  budget: { monthlyUsd: null, alertPct: 80 },
};

const SETTINGS_KEY = "settings";

function mergeSettings(raw: unknown): ElyraSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ElyraSettings>;
  const ai = (r.ai ?? {}) as Partial<ElyraSettings["ai"]>;
  const budget = (r.budget ?? {}) as Partial<ElyraSettings["budget"]>;
  return {
    ai: {
      model: typeof ai.model === "string" && ai.model.trim() ? ai.model.trim() : null,
      temperature: typeof ai.temperature === "number" ? Math.min(1, Math.max(0, ai.temperature)) : DEFAULT_SETTINGS.ai.temperature,
      webResearch: typeof ai.webResearch === "boolean" ? ai.webResearch : DEFAULT_SETTINGS.ai.webResearch,
    },
    budget: {
      monthlyUsd: typeof budget.monthlyUsd === "number" && budget.monthlyUsd >= 0 ? budget.monthlyUsd : null,
      alertPct: typeof budget.alertPct === "number" ? Math.min(100, Math.max(10, Math.round(budget.alertPct))) : DEFAULT_SETTINGS.budget.alertPct,
    },
  };
}

const MIGRATION_HINT = "Bitte einmal frontend/db/migrations/0013_workspace_settings.sql im Supabase SQL Editor ausführen.";

export async function getSettings(workspaceId: string): Promise<{ settings: ElyraSettings; storage: "db" | "unavailable"; error?: string }> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.from("workspace_policies").select("settings").eq("workspace_id", workspaceId).maybeSingle();
    if (error) {
      const missing = /settings|column/i.test(error.message);
      return { settings: DEFAULT_SETTINGS, storage: "unavailable", error: missing ? MIGRATION_HINT : error.message };
    }
    return { settings: mergeSettings((data as { settings?: unknown } | null)?.settings), storage: "db" };
  } catch (err) {
    return { settings: DEFAULT_SETTINGS, storage: "unavailable", error: (err as Error).message };
  }
}

/** Cached per process for 30 s – used by the AI tools on every call. */
const settingsCache = new Map<string, { at: number; value: ElyraSettings }>();
export async function getAiSettingsCached(workspaceId: string): Promise<ElyraSettings["ai"]> {
  const hit = settingsCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 30_000) return hit.value.ai;
  const { settings } = await getSettings(workspaceId);
  settingsCache.set(workspaceId, { at: Date.now(), value: settings });
  return settings.ai;
}

export async function saveSettings(workspaceId: string, patch: Partial<ElyraSettings>, actorUserId: string | null): Promise<ElyraSettings> {
  const { settings: current, storage, error } = await getSettings(workspaceId);
  if (storage !== "db") throw new Error(`Einstellungen können nicht gespeichert werden: ${error ?? "Tabelle workspace_policies fehlt"}`);
  const next = mergeSettings({
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    budget: { ...current.budget, ...(patch.budget ?? {}) },
  });
  const supabase = getSupabaseAdminClient();
  const { error: upsertError } = await supabase
    .from("workspace_policies")
    .upsert({ workspace_id: workspaceId, settings: next, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
  if (upsertError) throw new Error(`Speichern fehlgeschlagen: ${upsertError.message}`);
  settingsCache.delete(workspaceId);
  await appendAdminAuditLog({ workspaceId, actorUserId, action: "settings.update", targetType: "workspace_settings", targetId: SETTINGS_KEY, metadata: patch as Record<string, unknown> }).catch(() => undefined);
  return next;
}

// ── Policies (tool registry) ────────────────────────────────────────────────

export type ToolPolicy = { tool_name: string; app_id: string; risk_level: string; requires_approval: boolean; status: string };

export async function listToolPolicies(workspaceId: string): Promise<ToolPolicy[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tool_registry_entries")
    .select("tool_name,app_id,risk_level,requires_approval,status")
    .eq("workspace_id", workspaceId)
    .order("app_id")
    .order("tool_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ToolPolicy[];
}

export async function updateToolPolicy(
  workspaceId: string,
  toolName: string,
  patch: { requires_approval?: boolean; status?: "enabled" | "disabled" },
  actorUserId: string | null,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (typeof patch.requires_approval === "boolean") update.requires_approval = patch.requires_approval;
  if (patch.status === "enabled" || patch.status === "disabled") update.status = patch.status;
  if (Object.keys(update).length === 0) return;
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("tool_registry_entries").update(update).eq("workspace_id", workspaceId).eq("tool_name", toolName);
  if (error) throw new Error(error.message);
  await appendAdminAuditLog({ workspaceId, actorUserId, action: "tool_policy.update", targetType: "tool", targetId: toolName, metadata: update }).catch(() => undefined);
}

/** Bulk rule: every tool of a risk level needs approval (or not). */
export async function updateRiskPolicy(workspaceId: string, riskLevel: "writes" | "destructive", requiresApproval: boolean, actorUserId: string | null) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("tool_registry_entries")
    .update({ requires_approval: requiresApproval })
    .eq("workspace_id", workspaceId)
    .eq("risk_level", riskLevel);
  if (error) throw new Error(error.message);
  await appendAdminAuditLog({ workspaceId, actorUserId, action: "risk_policy.update", targetType: "risk_level", targetId: riskLevel, metadata: { requires_approval: requiresApproval } }).catch(() => undefined);
}

export async function listAudit(workspaceId: string, limit = 15) {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("os_admin_audit_log")
    .select("action,target_type,target_id,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Array<{ action: string; target_type: string; target_id: string | null; created_at: string }>;
}

// ── Marketplace ─────────────────────────────────────────────────────────────

export async function listMarketplace(workspaceId: string, userId: string | null) {
  const contract = await buildBootstrapContractFromDb(workspaceId, { userId });
  return contract.app_manifest.map((app) => {
    const install = contract.installed_apps.find((entry) => entry.app_id === app.app_id);
    const tools = contract.tool_registry.filter((t) => t.app_id === app.app_id);
    const needs = app.auth_requirements
      .filter((req) => req.mode === "required")
      .filter((req) => contract.integration_status.find((e) => e.integration_id === req.integration_id)?.state !== "connected")
      .map((req) => req.integration_id);
    return {
      app_id: app.app_id,
      name: app.name,
      description: app.description,
      category: app.category,
      installed: Boolean(install?.installed),
      enabled: Boolean(install?.enabled),
      tools: tools.length,
      risk: app.risk_tags,
      needs_integration: needs,
    };
  });
}

// ── Usage (Billing) ─────────────────────────────────────────────────────────

async function countRows(table: string, build: (q: ReturnType<ReturnType<typeof getSupabaseAdminClient>["from"]>) => unknown): Promise<number | null> {
  try {
    const supabase = getSupabaseAdminClient();
    const base = supabase.from(table);
    const query = build(base) as PromiseLike<{ count: number | null; error: { message: string } | null }>;
    const { count, error } = await query;
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

export async function usage(workspaceId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [runs, failedRuns, toolCalls, artifacts, tasks] = await Promise.all([
    countRows("orchestration_runs", (q) => q.select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", monthStart)),
    countRows("orchestration_runs", (q) => q.select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", monthStart).eq("status", "failed")),
    countRows("run_events", (q) => q.select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", monthStart).eq("event_type", "TOOL_COMPLETED")),
    countRows("os_tool_artifacts", (q) => q.select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", monthStart)),
    countRows("tasks", (q) => q.select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)),
  ]);
  return { month_start: monthStart, runs, failed_runs: failedRuns, tool_calls: toolCalls, artifacts, tasks };
}

// ── AI providers ────────────────────────────────────────────────────────────

export type ProviderInfo = { id: string; label: string; configured: boolean; detail: string };

export function aiProviders(): ProviderInfo[] {
  const has = (...keys: string[]) => keys.some((k) => Boolean(process.env[k]?.trim()));
  return [
    { id: "gemini", label: "Google Gemini (AI Studio)", configured: has("GEMINI_API_KEY"), detail: [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS].filter(Boolean).join(", ") || "Standardmodelle" },
    { id: "anthropic", label: "Anthropic Claude", configured: has("ANTHROPIC_API_KEY"), detail: process.env.ANTHROPIC_MODEL ?? "" },
    { id: "openai", label: "OpenAI", configured: has("OPENAI_API_KEY"), detail: process.env.OPENAI_MODEL ?? "" },
    { id: "vertex", label: "Vertex AI (Claude/Gemini)", configured: has("VERTEX_PROJECT_ID", "GOOGLE_CLOUD_PROJECT") && has("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_SERVICE_ACCOUNT_JSON", "VERTEX_SERVICE_ACCOUNT_JSON"), detail: process.env.VERTEX_LOCATION ?? "" },
  ];
}

/** Gemini models available for this API key (live list, generateContent-capable only). */
export async function listGeminiModels(): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return [];
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-/.test(n) && /(flash|pro)/.test(n) && !/(tts|image|embedding|live|audio|robotics|banana|omni|vision)/.test(n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Tiny real request per capability – used by the "Testen" buttons. */
export async function testAi(kind: "text" | "search", model?: string | null): Promise<{ ok: boolean; ms: number; detail: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, ms: 0, detail: "GEMINI_API_KEY fehlt" };
  const m = model || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const started = Date.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: kind === "search" ? "Welches Datum ist heute? Antworte in einem Satz." : "Antworte nur mit: OK" }] }],
        ...(kind === "search" ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { maxOutputTokens: 60, temperature: 0 },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const ms = Date.now() - started;
    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      const friendly = /quota|RESOURCE_EXHAUSTED/i.test(msg)
        ? kind === "search"
          ? "Kein Kontingent für die Google-Suche – Abrechnung in Google AI Studio aktivieren."
          : "Kontingent für dieses Modell erschöpft."
        : msg.slice(0, 200);
      return { ok: false, ms, detail: friendly };
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    return { ok: true, ms, detail: `${m}: ${text.slice(0, 120) || "Antwort erhalten"}` };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, detail: (err as Error).name === "TimeoutError" ? "Zeitüberschreitung" : (err as Error).message };
  }
}

// ── Health ──────────────────────────────────────────────────────────────────

export type HealthCheck = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; ms?: number };

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - started };
  } catch (err) {
    return { error: (err as Error).message, ms: Date.now() - started };
  }
}

export async function healthChecks(workspaceId: string, userId: string | null): Promise<HealthCheck[]> {
  const supabase = getSupabaseAdminClient();
  const aiServiceUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8788";

  const [db, gemini, google, aiService, weather, integrations] = await Promise.all([
    timed(async () => {
      const { error } = await supabase.from("workspaces").select("id").eq("id", workspaceId).limit(1);
      if (error) throw new Error(error.message);
    }),
    timed(async () => {
      const models = await listGeminiModels();
      if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("GEMINI_API_KEY fehlt");
      if (models.length === 0) throw new Error("Modellliste nicht abrufbar");
      const configured = (process.env.GEMINI_MODEL ?? "").trim();
      return { count: models.length, configuredAvailable: !configured || models.includes(configured), configured };
    }),
    timed(async () => loadStoredGoogleTokens(workspaceId, userId)),
    timed(async () => {
      const res = await fetch(`${aiServiceUrl}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),
    timed(async () => {
      const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=38.7&longitude=-9.1&current=temperature_2m", { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),
    timed(async () => buildRuntimeIntegrationStatus(workspaceId, userId)),
  ]);

  const checks: HealthCheck[] = [];
  checks.push(db.error
    ? { id: "db", label: "Datenbank (Supabase)", status: "fail", detail: db.error, ms: db.ms }
    : { id: "db", label: "Datenbank (Supabase)", status: db.ms > 1500 ? "warn" : "ok", detail: db.ms > 1500 ? "Langsam" : "Erreichbar", ms: db.ms });

  if (gemini.error) checks.push({ id: "gemini", label: "KI-Modell (Gemini)", status: "fail", detail: gemini.error, ms: gemini.ms });
  else {
    const g = gemini.value!;
    checks.push({
      id: "gemini", label: "KI-Modell (Gemini)", status: g.configuredAvailable ? "ok" : "warn", ms: gemini.ms,
      detail: g.configuredAvailable ? `${g.count} Modelle verfügbar${g.configured ? `, ${g.configured} aktiv` : ""}` : `Konfiguriertes Modell ${g.configured} ist nicht verfügbar`,
    });
  }

  if (google.error) checks.push({ id: "google", label: "Google-Konto", status: "fail", detail: google.error, ms: google.ms });
  else {
    const t = google.value as { accessToken?: string | null; refreshToken?: string | null; expiresAtMs?: number | null } | null;
    const connected = Boolean(t?.accessToken || t?.refreshToken);
    checks.push({
      id: "google", label: "Google-Konto (Gmail, Kalender, Drive)", ms: google.ms,
      status: connected ? (t?.refreshToken ? "ok" : "warn") : "fail",
      detail: connected ? (t?.refreshToken ? "Verbunden, Token wird automatisch erneuert" : "Verbunden, aber ohne Refresh-Token – bald neu verbinden") : "Nicht verbunden",
    });
  }

  checks.push(aiService.error
    ? { id: "ai_service", label: "Elyra AI-Service (Agenten, Ads-Audit)", status: "fail", detail: `Nicht erreichbar unter ${aiServiceUrl} – „npm run dev“ im backend/ai-service starten`, ms: aiService.ms }
    : { id: "ai_service", label: "Elyra AI-Service (Agenten, Ads-Audit)", status: "ok", detail: "Läuft", ms: aiService.ms });

  checks.push(weather.error
    ? { id: "weather", label: "Wetterdienst (Open-Meteo)", status: "warn", detail: weather.error, ms: weather.ms }
    : { id: "weather", label: "Wetterdienst (Open-Meteo)", status: "ok", detail: "Erreichbar", ms: weather.ms });

  if (integrations.value) {
    const relevant = integrations.value.filter((i) => i.state === "connected" || i.state === "degraded" || i.integration_id === "google_oauth");
    for (const i of relevant) {
      if (i.integration_id === "google_oauth") continue;
      checks.push({
        id: `int_${i.integration_id}`, label: `Integration: ${i.integration_id}`,
        status: i.state === "connected" ? "ok" : "warn",
        detail: i.state === "connected" ? "Verbunden" : i.error_message_safe ?? i.state,
      });
    }
  }
  return checks;
}
