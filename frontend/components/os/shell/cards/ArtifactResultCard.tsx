"use client";

import { CloudSun, ExternalLink, FileText, Languages, Presentation, Search } from "lucide-react";
import type { WorkspaceArtifact } from "@/components/os/kernel/types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function resolveUiHint(artifact: WorkspaceArtifact): string {
  if (artifact.uiCardHint) return artifact.uiCardHint;
  const payloadHint = asRecord(artifact.payloadJson).ui_card_hint;
  if (typeof payloadHint === "string" && payloadHint.trim()) return payloadHint;

  if (artifact.type === "research_report") return "card.research_report";
  if (artifact.type === "weather_forecast") return "card.weather_forecast";
  if (artifact.type === "translation_result") return "card.translation_result";
  if (artifact.type === "slides_deck_link") return "card.slides_deck_link";
  if (artifact.type === "drive_file") return "card.drive_file";
  return "card.generic";
}

function metadataLine(artifact: WorkspaceArtifact): string {
  const payload = asRecord(artifact.payloadJson);
  if (artifact.type === "weather_forecast") {
    const location = typeof payload.location === "string" ? payload.location : null;
    const days = typeof payload.days === "number" ? payload.days : null;
    if (location || days) return `${location ?? "Forecast"}${days ? ` · ${days} days` : ""}`;
  }
  if (artifact.type === "translation_result") {
    const source = typeof payload.source_lang === "string" ? payload.source_lang : null;
    const target = typeof payload.target_lang === "string" ? payload.target_lang : null;
    if (source || target) return `${source ?? "auto"} -> ${target ?? "target"}`;
  }
  if (artifact.type === "research_report") {
    const citations = typeof payload.citations_count === "number" ? payload.citations_count : null;
    if (citations !== null) return `${citations} citations`;
  }
  return artifact.type;
}

function hintIcon(hint: string) {
  if (hint === "card.research_report") return <Search size={14} />;
  if (hint === "card.weather_forecast") return <CloudSun size={14} />;
  if (hint === "card.translation_result") return <Languages size={14} />;
  if (hint === "card.slides_deck_link") return <Presentation size={14} />;
  if (hint === "card.drive_file") return <FileText size={14} />;
  return <FileText size={14} />;
}

type ArtifactResultCardProps = {
  artifact: WorkspaceArtifact;
  onOpen?: (artifactId: string, artifactType: string) => void;
  compact?: boolean;
};

export default function ArtifactResultCard({ artifact, onOpen, compact = false }: ArtifactResultCardProps) {
  const hint = resolveUiHint(artifact);
  const metaLine = metadataLine(artifact);

  return (
    <article
      className={`rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] ${compact ? "px-2.5 py-2" : "p-3"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-secondary)]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)]">
            {hintIcon(hint)}
          </span>
          <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
            {hint.replace("card.", "").replaceAll("_", " ")}
          </span>
        </div>
      </div>

      <p className="mt-2 text-[12px] font-medium text-[color:var(--text-primary)]">{artifact.title}</p>
      <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">{metaLine}</p>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
          {new Date(artifact.updatedAt).toLocaleString()}
        </span>
        <button
          type="button"
          onClick={() => onOpen?.(artifact.id, artifact.type)}
          disabled={!onOpen}
          className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]"
        >
          <ExternalLink size={11} /> Open
        </button>
      </div>
    </article>
  );
}
