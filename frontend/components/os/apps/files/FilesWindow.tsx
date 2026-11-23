"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink, File, FileImage, FileSpreadsheet, FileText, Presentation, RefreshCw, Search, Share2, Star,
} from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import { startGoogleConnect } from "@/components/os/apps/liveGoogleClient";
import { GOOGLE_DRIVE_READONLY_SCOPE } from "@/lib/google/scopes";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number | null;
  webViewLink: string | null;
  owner: string | null;
  shared: boolean;
  starred: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; files: DriveFile[] }
  | { kind: "disconnected"; reason: "not_connected" | "expired" | "missing_scope" }
  | { kind: "api_disabled"; enableUrl: string | null }
  | { kind: "error" };

type Filter = "all" | "docs" | "sheets" | "slides" | "pdf" | "images" | "starred" | "shared";

const COLUMNS = { display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 90px 130px", columnGap: "12px" } as const;

const FILTERS: Array<[Filter, string]> = [
  ["all", "Alle"],
  ["docs", "Dokumente"],
  ["sheets", "Tabellen"],
  ["slides", "Präsentationen"],
  ["pdf", "PDFs"],
  ["images", "Bilder"],
  ["starred", "Markiert"],
  ["shared", "Geteilt"],
];

function category(mime: string): Exclude<Filter, "all" | "starred" | "shared"> | "other" {
  if (mime.includes("document") || mime.includes("wordprocessing") || mime === "text/plain" || mime === "text/markdown") return "docs";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "sheets";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "slides";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "images";
  return "other";
}

function typeLabel(mime: string): string {
  const map: Record<string, string> = {
    docs: "Dokument",
    sheets: "Tabelle",
    slides: "Präsentation",
    pdf: "PDF",
    images: "Bild",
  };
  return map[category(mime)] ?? "Datei";
}

function FileIcon({ mime }: { mime: string }) {
  const c = category(mime);
  if (c === "sheets") return <FileSpreadsheet size={16} className="text-emerald-500" />;
  if (c === "slides") return <Presentation size={16} className="text-amber-500" />;
  if (c === "pdf") return <FileText size={16} className="text-red-500" />;
  if (c === "images") return <FileImage size={16} className="text-teal-500" />;
  if (c === "docs") return <FileText size={16} className="text-blue-500" />;
  return <File size={16} style={{ color: "var(--text-muted)" }} />;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

function formatModified(iso: string | null): string {
  if (!iso) return "–";
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return `heute, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Dateien: the workspace's Google Drive, read-only. Opens files in Google Drive. */
export default function FilesWindow() {
  const { activeWorkspace } = useKernel();
  const workspaceId = activeWorkspace.id;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Server-side search, debounced.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query.trim()), 350);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const url = new URL("/api/os/files", window.location.origin);
      url.searchParams.set("workspaceId", workspaceId);
      if (search) url.searchParams.set("q", search);
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | { connected?: boolean; state?: "not_connected" | "expired" | "missing_scope" | "api_disabled"; detail?: string; files?: DriveFile[] }
        | null;
      if (!response.ok || !data) return setState({ kind: "error" });
      if (data.state === "api_disabled") {
        const enableUrl = data.detail?.match(/https:\/\/console\.developers\.google\.com\/\S+?(?=\s|$)/)?.[0]?.replace(/[.,]$/, "") ?? null;
        return setState({ kind: "api_disabled", enableUrl });
      }
      if (!data.connected) return setState({ kind: "disconnected", reason: data.state ?? "not_connected" });
      setState({ kind: "ready", files: data.files ?? [] });
    } catch {
      setState({ kind: "error" });
    }
  }, [search, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const files = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.files.filter((f) => {
      if (filter === "all") return true;
      if (filter === "starred") return f.starred;
      if (filter === "shared") return f.shared;
      return category(f.mimeType) === filter;
    });
  }, [filter, state]);

  const selected = files.find((f) => f.id === selectedId) ?? null;

  const connect = () => {
    void startGoogleConnect(workspaceId, "/os/files", [GOOGLE_DRIVE_READONLY_SCOPE]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--bg-surface)" }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--os-border-faint)" }}>
        <div className="mr-auto">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Google Drive</p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {state.kind === "ready"
              ? `${state.files.length} ${state.files.length === 1 ? "Datei" : "Dateien"}${search ? ` für „${search}“` : ", zuletzt geändert zuerst"}`
              : state.kind === "loading"
                ? "Wird geladen …"
                : state.kind === "disconnected"
                  ? "Nicht verbunden"
                  : state.kind === "api_disabled"
                  ? "Drive API nicht aktiviert"
                  : "Nicht erreichbar"}
          </p>
        </div>
        <div className="relative w-64 max-w-full">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="In Drive suchen"
            className="w-full rounded-xl border bg-transparent py-1.5 pl-8 pr-3 text-sm outline-none"
            style={{ borderColor: "var(--os-border-soft)", color: "var(--text-primary)" }}
            disabled={state.kind === "disconnected" || state.kind === "api_disabled"}
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="grid h-8 w-8 place-items-center rounded-lg transition hover:bg-black/5"
          style={{ color: "var(--text-secondary)" }}
          aria-label="Aktualisieren"
          title="Aktualisieren"
        >
          <RefreshCw size={14} className={state.kind === "loading" ? "animate-spin" : ""} />
        </button>
      </div>

      {state.kind === "disconnected" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {state.reason === "not_connected" ? "Google Drive ist nicht verbunden" : "Die Google-Verbindung muss erneuert werden"}
          </p>
          <p className="max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
            {state.reason === "not_connected"
              ? "Verbinde ein Google-Konto, dann zeigt Elyra hier deine Dateien aus Google Drive. Elyra liest nur, es ändert und löscht nichts."
              : state.reason === "missing_scope"
                ? "Für Dateien fehlt die Berechtigung „Google Drive lesen“. Verbinde Google erneut und erlaube den Zugriff."
                : "Die Anmeldung bei Google ist abgelaufen, zum Beispiel nach einer Passwortänderung. Verbinde dein Konto einfach neu."}
          </p>
          <button
            type="button"
            onClick={connect}
            className="mt-1 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--os-accent)" }}
          >
            {state.reason === "not_connected" ? "Google verbinden" : "Neu verbinden"}
          </button>
        </div>
      )}

      {state.kind === "api_disabled" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Die Google Drive API ist nicht aktiviert</p>
          <p className="max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
            Dein Google-Konto ist verbunden, aber im Google-Cloud-Projekt dieser Elyra-Instanz ist die Drive API ausgeschaltet.
            Aktiviere sie einmal in der Google Cloud Console. Danach erscheinen deine Dateien nach ein, zwei Minuten.
          </p>
          <div className="mt-1 flex gap-2">
            {state.enableUrl && (
              <a
                href={state.enableUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "var(--os-accent)" }}
              >
                Drive API aktivieren
              </a>
            )}
            <button type="button" onClick={() => void load()} className="rounded-xl border px-4 py-2 text-sm" style={{ borderColor: "var(--os-border-soft)", color: "var(--text-primary)" }}>
              Erneut prüfen
            </button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Google Drive ist gerade nicht erreichbar.</p>
          <button type="button" onClick={() => void load()} className="rounded-xl border px-4 py-2 text-sm" style={{ borderColor: "var(--os-border-soft)", color: "var(--text-primary)" }}>
            Erneut versuchen
          </button>
        </div>
      )}

      {(state.kind === "ready" || state.kind === "loading") && (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap gap-1.5 px-5 pt-3">
              {FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className="rounded-full border px-3 py-1 text-xs transition"
                  style={{
                    borderColor: filter === id ? "var(--os-accent)" : "var(--os-border-soft)",
                    color: filter === id ? "var(--os-accent)" : "var(--text-secondary)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <div
                className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{ ...COLUMNS, color: "var(--text-muted)" }}
              >
                <span>Name</span>
                <span>Typ</span>
                <span className="text-right">Größe</span>
                <span className="text-right">Geändert</span>
              </div>
              {state.kind === "loading" &&
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="mb-1 h-10 animate-pulse rounded-xl" style={{ background: "var(--os-surface-soft, rgba(0,0,0,.04))" }} />
                ))}
              {state.kind === "ready" && files.length === 0 && (
                <p className="px-3 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  {search ? `Keine Dateien für „${search}“.` : "Keine Dateien in dieser Ansicht."}
                </p>
              )}
              {state.kind === "ready" &&
                files.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedId(f.id)}
                    onDoubleClick={() => f.webViewLink && window.open(f.webViewLink, "_blank", "noopener")}
                    className="w-full items-center rounded-xl px-3 py-2 text-left text-sm transition"
                    style={{
                      ...COLUMNS,
                      background: selectedId === f.id ? "color-mix(in srgb, var(--os-accent) 12%, transparent)" : "transparent",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <FileIcon mime={f.mimeType} />
                      <span className="truncate">{f.name}</span>
                      {f.starred && <Star size={11} className="flex-shrink-0 fill-amber-400 text-amber-400" />}
                      {f.shared && <Share2 size={11} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{typeLabel(f.mimeType)}</span>
                    <span className="text-right text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>{formatSize(f.size)}</span>
                    <span className="text-right text-xs" style={{ color: "var(--text-secondary)" }}>{formatModified(f.modifiedTime)}</span>
                  </button>
                ))}
            </div>
          </div>

          {selected && (
            <aside className="hidden w-64 flex-shrink-0 flex-col gap-4 border-l p-5 lg:flex" style={{ borderColor: "var(--os-border-faint)" }}>
              <div className="flex items-start gap-2.5">
                <FileIcon mime={selected.mimeType} />
                <p className="break-words text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{selected.name}</p>
              </div>
              <dl className="space-y-2 text-xs">
                {(
                  [
                    ["Typ", typeLabel(selected.mimeType)],
                    ["Größe", formatSize(selected.size)],
                    ["Geändert", formatModified(selected.modifiedTime)],
                    ["Besitzer", selected.owner ?? "Du"],
                    ["Geteilt", selected.shared ? "Ja" : "Nein"],
                  ] as Array<[string, string]>
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
                    <dd className="text-right" style={{ color: "var(--text-primary)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              {selected.webViewLink && (
                <a
                  href={selected.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white"
                  style={{ background: "var(--os-accent)" }}
                >
                  <ExternalLink size={12} /> In Google Drive öffnen
                </a>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
