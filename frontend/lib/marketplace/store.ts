/**
 * Marketplace persistence (migration 0017): installs per workspace and Elly's mini-apps.
 * All access goes through server routes with the service role.
 */
import { Script } from "node:vm";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { callGeminiText } from "@/lib/ai/geminiDirect";
import { CATALOG, isInstallable, type InstalledMap } from "@/lib/marketplace/catalog";

export class MarketplaceError extends Error {}

const SETUP_HINT = "Tabellen fehlen – bitte frontend/db/migrations/0017_marketplace.sql im Supabase SQL Editor ausführen.";
const db = () => getSupabaseAdminClient();

function isMissingTable(message: string): boolean {
  return /relation .*(marketplace_installs|mini_apps)|Could not find the table/i.test(message);
}

function fail(message: string): never {
  throw new MarketplaceError(isMissingTable(message) ? SETUP_HINT : message);
}

export type MiniAppSummary = { id: string; name: string; description: string; icon: string; created_at: string; updated_at: string };
export type MiniApp = MiniAppSummary & { html: string; prompt: string; data: Record<string, unknown> };

export async function getInstalled(workspaceId: string): Promise<{ installed: InstalledMap; setupError?: string }> {
  const { data, error } = await db().from("marketplace_installs").select("item_id, installed").eq("workspace_id", workspaceId);
  if (error) {
    if (isMissingTable(error.message)) return { installed: null, setupError: SETUP_HINT };
    throw new MarketplaceError(error.message);
  }
  const map: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ item_id: string; installed: boolean }>) map[row.item_id] = row.installed;
  return { installed: map };
}

export async function setInstalled(workspaceId: string, itemId: string, installed: boolean, userId: string | null): Promise<void> {
  const item = CATALOG.find((entry) => entry.id === itemId);
  if (!item || !isInstallable(item)) throw new MarketplaceError("Unbekannte App oder Skill.");
  const { error } = await db().from("marketplace_installs").upsert(
    { workspace_id: workspaceId, item_id: itemId, kind: item.kind, installed, installed_by: userId, updated_at: new Date().toISOString() },
    { onConflict: "workspace_id,item_id" },
  );
  if (error) fail(error.message);
}

// ── Mini-apps ────────────────────────────────────────────────────────────────

export async function listMiniApps(workspaceId: string): Promise<MiniAppSummary[]> {
  const { data, error } = await db()
    .from("mini_apps")
    .select("id, name, description, icon, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error.message)) return [];
    throw new MarketplaceError(error.message);
  }
  return (data ?? []) as MiniAppSummary[];
}

export async function getMiniApp(workspaceId: string, id: string): Promise<MiniApp> {
  const { data, error } = await db().from("mini_apps").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) fail(error.message);
  if (!data) throw new MarketplaceError("Mini-App nicht gefunden.");
  return data as MiniApp;
}

export async function saveMiniApp(
  workspaceId: string,
  userId: string | null,
  input: { id?: string | null; name: string; description: string; icon: string; prompt: string; html: string },
): Promise<MiniAppSummary> {
  const html = input.html.trim();
  if (!html) throw new MarketplaceError("Die Mini-App ist leer.");
  if (html.length > 400_000) throw new MarketplaceError("Die Mini-App ist zu groß.");
  const scriptError = findScriptError(html);
  if (scriptError) throw new MarketplaceError(`Die Mini-App enthält einen Fehler (${scriptError}) – bitte erst beheben.`);
  const row = {
    workspace_id: workspaceId,
    name: input.name.trim().slice(0, 60) || "Mini-App",
    description: input.description.trim().slice(0, 300),
    icon: (input.icon.trim() || "✦").slice(0, 4),
    prompt: input.prompt.slice(0, 4000),
    html,
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? db().from("mini_apps").update(row).eq("workspace_id", workspaceId).eq("id", input.id)
    : db().from("mini_apps").insert({ ...row, created_by: userId });
  const { data, error } = await query.select("id, name, description, icon, created_at, updated_at").single();
  if (error) fail(error.message);
  return data as MiniAppSummary;
}

export async function deleteMiniApp(workspaceId: string, id: string): Promise<void> {
  const { error } = await db().from("mini_apps").delete().eq("workspace_id", workspaceId).eq("id", id);
  if (error) fail(error.message);
}

export async function saveMiniAppData(workspaceId: string, id: string, data: Record<string, unknown>): Promise<void> {
  if (JSON.stringify(data).length > 1_500_000) throw new MarketplaceError("Zu viele gespeicherte Daten (max. 1,5 MB).");
  const { error } = await db().from("mini_apps").update({ data }).eq("workspace_id", workspaceId).eq("id", id);
  if (error) fail(error.message);
}

// ── Generation (Elly builds a mini-app) ──────────────────────────────────────

const BUILD_SYSTEM = `Du baust kleine Web-Apps ("Mini-Apps") für Elyra, ein KI-Betriebssystem im Browser.
Die App läuft in einem abgeschotteten iframe ohne Netzwerkzugriff. Regeln:
- Liefere NUR den Inhalt für <body>: HTML-Markup, ein <style>-Block und ein <script>-Block. Kein <html>, <head> oder <body>-Tag.
- Keine externen Dateien, Schriften, CDNs, Bilder-URLs oder fetch()-Aufrufe – alles inline. Bilder nur als Inline-SVG oder Emoji.
- Gestaltung: professionell wie ein modernes SaaS-Dashboard (Linear, Stripe, Notion): klare Hierarchie, viel Weißraum, Kennzahlen oben, Diagramme statt Zahlenlisten, saubere Tabellen, leere Zustände mit kurzem Hinweis.
- PFLICHT: Nutze das eingebaute Elyra-UI-Kit statt eigener Grundstile. Klassen:
  Layout: .e-app (äußerer Container), .e-header mit .e-title und .e-sub, .e-row, .e-grid (Kacheln, auto-fit), .e-grid-2 (zwei Spalten)
  Karten: .e-card, .e-card-head, .e-card-title, .e-card-sub
  Kennzahlen: .e-kpi > .e-kpi-label + .e-kpi-value + span.e-delta.up|down|flat (+ optional div für Sparkline)
  Navigation: .e-tabs > button.e-tab(.active)
  Buttons: .e-btn, .e-btn.primary, .e-btn.ghost, .e-btn.danger, .e-btn.sm
  Formulare: .e-form (Raster), .e-field > label.e-label + .e-input/.e-select/.e-textarea
  Tabellen: .e-table-wrap > table.e-table (Zahlenspalten mit class="num")
  Sonstiges: .e-badge, .e-dot, .e-progress(.warn|.over) > span[style=width:%], .e-dropzone (.drag beim Ziehen), .e-empty > .e-empty-icon, .e-list > .e-list-item, .e-note, .e-pos/.e-neg/.e-muted
- Diagramme NUR über das Kit (SVG, Theme-Farben, Legende, Tooltip inklusive; nie eigene Chart-Bibliotheken):
  elyra.chart.donut(el, [{label, value}], {format, center, centerLabel})   – Anteile (z. B. Ausgaben nach Kategorie), max. 7 Segmente
  elyra.chart.bars(el, [{label, value}], {format, horizontal:true})         – Ranglisten (z. B. Top-Händler)
  elyra.chart.bars(el, {labels, series:[{name, values}]}, {format})         – Vergleich je Periode (z. B. Einnahmen vs. Ausgaben pro Monat)
  elyra.chart.line(el, {labels, series:[{name, values}]}, {format, area:true}) – Verlauf über Zeit
  elyra.chart.spark(el, values)                                             – Mini-Verlauf in KPI-Kacheln
  el = Element oder CSS-Selektor eines leeren <div>. Nach jeder Datenänderung neu zeichnen.
  Formatierung: elyra.fmt.eur(n), elyra.fmt.num(n), elyra.fmt.pct(0.12), elyra.fmt.date(d), elyra.fmt.month(d); Veränderung: elyra.delta(aktuell, vorher, {invert:true bei Kosten}) → {text, cls}.
- Farben für Kategorien: elyra.chart.color(i) (feste, geprüfte Reihenfolge) – nie eigene Farbwerte.
- Für alles Übrige ausschließlich diese CSS-Variablen für Farben:
  var(--bg) Hintergrund, var(--surface) Karten, var(--text) Text, var(--muted) Nebentext, var(--accent) Akzent, var(--border) Rahmen. So passt die App zu Hell- und Dunkelmodus.
  VERBOTEN sind feste Farben: keine #hex-Werte, kein rgb()/hsl(), keine Farbnamen (außer transparent, white auf var(--accent)-Buttons). Abstufungen nur mit color-mix(in srgb, var(--accent) 15%, transparent) o. ä.
- Die App muss im Fenster ab 360px Breite funktionieren (responsive).
- Oberfläche auf Deutsch, außer der Nutzer will es anders.
- Verfügbare Schnittstelle (global, asynchron):
  await elyra.get(key) → gespeicherter Wert oder null (bleibt dauerhaft gespeichert)
  await elyra.set(key, value) → speichert einen JSON-fähigen Wert
  await elyra.ask(prompt) → Antwort der KI als Text (nur nutzen, wenn die App wirklich KI braucht; sparsam)
- Speichere Nutzerdaten mit elyra.set, damit sie beim nächsten Öffnen noch da sind. Lade sie beim Start mit elyra.get.
- Robuster Code: keine Fehler bei leeren Daten, Eingaben prüfen, kein alert()/confirm()/prompt().
Antworte als JSON: {"name": "kurzer Name (max. 3 Wörter)", "icon": "ein passendes Emoji", "description": "ein Satz, was die App kann", "html": "<der Body-Inhalt>"}`;

export async function generateMiniApp(input: { description: string; previousHtml?: string | null; feedback?: string | null }) {
  const description = input.description.trim();
  if (description.length < 8) throw new MarketplaceError("Beschreibe kurz, was die App können soll.");
  const prompt = input.previousHtml && input.feedback
    ? `Ursprünglicher Wunsch:\n${description}\n\nBisherige App (Body-Inhalt):\n${input.previousHtml}\n\nÄnderungswunsch:\n${input.feedback}\n\nLiefere die vollständige, überarbeitete App.`
    : `Baue diese App:\n${description}`;
  const { text, model } = await callGeminiText({ system: BUILD_SYSTEM, prompt, json: true, temperature: 0.5, maxOutputTokens: 32000, timeoutMs: 150_000 });
  let parsed: { name?: string; icon?: string; description?: string; html?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new MarketplaceError("Die KI hat keine gültige App geliefert – bitte noch einmal versuchen.");
  }
  let html = String(parsed.html ?? "").replace(/<\/?(html|head|body)[^>]*>/gi, "").trim();
  if (html.length < 40) throw new MarketplaceError("Die KI hat keine gültige App geliefert – bitte noch einmal versuchen.");
  html = await ensureValidScripts(html);
  html = await repairFixedColors(html);
  return {
    name: String(parsed.name ?? "Mini-App").slice(0, 60),
    icon: String(parsed.icon ?? "✦").slice(0, 4),
    description: String(parsed.description ?? "").slice(0, 300),
    html,
    model,
  };
}

/** Compiles (never runs) every inline <script>; returns the first syntax error or null. */
export function findScriptError(html: string): string | null {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const attrs = match[1] ?? "";
    if (/\bsrc=/i.test(attrs) || /type=["']?module/i.test(attrs)) continue;
    try {
      new Script(match[2] ?? "");
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  if (/<script\b[^>]*>(?![\s\S]*<\/script>)/i.test(html)) return "Script-Block ist nicht geschlossen (Antwort abgeschnitten?)";
  return null;
}

/** Generated code sometimes has a syntax error – let the model fix it (max. 2 attempts). */
async function ensureValidScripts(html: string): Promise<string> {
  let current = html;
  for (let attempt = 0; attempt < 2; attempt++) {
    const error = findScriptError(current);
    if (!error) return current;
    try {
      const { text } = await callGeminiText({
        system: "Du reparierst JavaScript in einer kleinen Web-App (Body-Inhalt mit <style> und <script>). Behebe den genannten Syntaxfehler und alle weiteren offensichtlichen Fehler, ändere sonst nichts. Antworte nur mit dem vollständigen, korrigierten Body-Inhalt, ohne Erklärung und ohne Markdown.",
        prompt: `Syntaxfehler: ${error}\n\n${current}`,
        temperature: 0.1,
        maxOutputTokens: 16000,
        timeoutMs: 90_000,
      });
      const fixed = text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
      if (fixed.length > current.length * 0.6) current = fixed;
    } catch {
      break;
    }
  }
  const remaining = findScriptError(current);
  if (remaining) throw new MarketplaceError(`Elly hat fehlerhaften Code erzeugt (${remaining}). Bitte „Neu bauen“ oder einen Änderungswunsch versuchen.`);
  return current;
}

/** Models sometimes ignore the colour rule; one cheap repair pass keeps apps readable in dark and light mode. */
async function repairFixedColors(html: string): Promise<string> {
  const fixed = (html.match(/(?<!&)#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []).length;
  if (fixed <= 2) return html;
  try {
    const { text } = await callGeminiText({
      system: "Du überarbeitest CSS in einer kleinen Web-App. Ersetze alle festen Farben (#hex, rgb(), rgba(), hsl(), Farbnamen) durch diese Variablen: var(--bg) Seitenhintergrund, var(--surface) Karten/Felder, var(--text) Text, var(--muted) Nebentext, var(--accent) Akzent/Buttons, var(--border) Rahmen. Schatten: color-mix(in srgb, var(--text) 12%, transparent). Ändere sonst nichts am Code. Antworte nur mit dem vollständigen, geänderten Body-Inhalt, ohne Erklärung und ohne Markdown.",
      prompt: html,
      temperature: 0.1,
      maxOutputTokens: 16000,
      timeoutMs: 90_000,
    });
    const repaired = text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (repaired.length <= html.length * 0.6) return html;
    return findScriptError(repaired) ? html : repaired;
  } catch {
    return html;
  }
}

// Mini-apps may call the AI through the host – limited per workspace to keep costs in check.
const askBudget = new Map<string, { windowStart: number; count: number }>();
const ASK_LIMIT_PER_HOUR = 60;

export async function askForMiniApp(workspaceId: string, prompt: string): Promise<string> {
  const now = Date.now();
  const budget = askBudget.get(workspaceId);
  if (!budget || now - budget.windowStart > 3_600_000) askBudget.set(workspaceId, { windowStart: now, count: 1 });
  else if (budget.count >= ASK_LIMIT_PER_HOUR) throw new MarketplaceError("KI-Limit für Mini-Apps erreicht (60 Anfragen pro Stunde).");
  else budget.count++;
  const { text } = await callGeminiText({
    system: "Du bist die KI hinter einer kleinen App. Antworte knapp, sachlich und im Format, das die Anfrage verlangt.",
    prompt: prompt.slice(0, 8000),
    maxOutputTokens: 2048,
    timeoutMs: 45_000,
  });
  return text;
}
