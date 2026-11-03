"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

import { Button } from "@/components/ui/button";
import type { ComposeIntentId, ComposeMerlinResult } from "./composeMerlinUtils";
import { COMPOSE_INTENTS } from "./composeMerlinUtils";
import { splitIntoParagraphs } from "@/lib/merlin/render";
import { useT } from "@/lib/i18n/useT";

type MerlinComposePanelProps = {
  recipientsSummary: string | null;
  subjectSummary: string | null;
  actionId: ComposeIntentId;
  onActionChange: (value: ComposeIntentId) => void;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onExecute: () => Promise<void> | void;
  onUseSubject: () => void;
  onUseBody: () => void;
  isProcessing: boolean;
  status: string | null;
  error: string | null;
  result: ComposeMerlinResult | null;
};

export default function MerlinComposePanel({
  recipientsSummary,
  subjectSummary,
  actionId,
  onActionChange,
  instruction,
  onInstructionChange,
  onExecute,
  onUseSubject,
  onUseBody,
  isProcessing,
  status,
  error,
  result,
}: MerlinComposePanelProps) {
  const t = useT();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  useEffect(() => {
    if (instruction && !isOptionsOpen) {
      setIsOptionsOpen(true);
    }
  }, [instruction, isOptionsOpen]);

  const intent = useMemo(
    () => COMPOSE_INTENTS.find((candidate) => candidate.id === actionId) ?? COMPOSE_INTENTS[0],
    [actionId]
  );
  const actionLabel = isProcessing ? t("merlin.processing") : t("merlin.execute");
  const paragraphs = useMemo(() => splitIntoParagraphs(result?.body), [result?.body]);
  const hasResult = Boolean(result);
  const subjectAvailable = Boolean(result?.subject?.trim());
  const fallbackMode = Boolean(result?.fallback);

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text = result.sanitized || result.body;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }, [result]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                {t("merlin.label")}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("merlin.helper")}</p>
            </div>
          </div>
        {recipientsSummary && (
          <p className="text-sm font-semibold text-foreground line-clamp-2">
            {recipientsSummary}
          </p>
        )}
        {subjectSummary && (
          <p className="text-xs text-muted-foreground line-clamp-1">{subjectSummary}</p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="merlin-compose-action-select">
            {t("merlin.action_label")}
          </label>
          <select
            id="merlin-compose-action-select"
            value={actionId}
            onChange={(event) => onActionChange(event.target.value as ComposeIntentId)}
            className="h-9 w-full rounded-md border border-border/60 bg-transparent px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/60"
          >
            {COMPOSE_INTENTS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <div className="text-xs text-muted-foreground">
            {intent?.description ?? ""}
          </div>
        </div>
        <Button
          className="h-9 px-4"
          onClick={() => {
            void onExecute();
          }}
          disabled={isProcessing}
          aria-busy={isProcessing ? true : undefined}
          variant="outline"
        >
          {actionLabel}
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden">
        {fallbackMode && (
          <span className="inline-flex items-center justify-center rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {t("merlin.offline_mode")}
          </span>
        )}
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm leading-relaxed text-foreground">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {hasResult && paragraphs.length ? (
              paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {isProcessing
                  ? t("merlin.processing")
                  : t("merlin.choose_action")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.3em]">
            {subjectAvailable && (
              <button
                type="button"
                onClick={onUseSubject}
                disabled={!subjectAvailable}
                className="text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t("merlin.apply_subject")}
              </button>
            )}
            {hasResult && (
              <button
                type="button"
                onClick={onUseBody}
                className="text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t("merlin.apply_body")}
              </button>
            )}
            {hasResult && (
              <button
                type="button"
                onClick={handleCopy}
                className="text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t("merlin.copy")}
              </button>
            )}
          </div>
        </div>
        {(status || error) && (
          <div className="space-y-1 text-xs">
            {status && (
              <p className="text-muted-foreground">{status}</p>
            )}
            {error && (
              <p className="text-destructive">{error}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          aria-expanded={isOptionsOpen}
          onClick={() => setIsOptionsOpen((prev) => !prev)}
          className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span>{t("merlin.options")}</span>
          <span aria-hidden="true">{isOptionsOpen ? "−" : "+"}</span>
        </button>
        {isOptionsOpen && (
            <textarea
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value)}
              placeholder={t("compose.instruction_placeholder")}
              rows={3}
              className="min-h-[90px] w-full resize-none rounded-xl border border-border/60 bg-muted/20 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
        )}
      </div>
    </div>
  );
}
