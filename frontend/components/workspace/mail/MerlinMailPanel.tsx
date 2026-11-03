"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { MAIL_INTENTS, type MerlinIntentId } from "@/lib/merlin/intents";
import type { MailThread, MerlinResult } from "@/components/workspace/mail/mailTypes";
import { Button } from "@/components/ui/button";
import {
  detectFallbackMode,
  parseSummaryResult,
  splitIntoParagraphs,
  stripDebugMarkers,
  toBulletPoints,
} from "@/lib/merlin/render";
import { useT } from "@/lib/i18n/useT";

type MerlinMailPanelProps = {
  thread: MailThread | null;
  isConnected: boolean;
  intentId: MerlinIntentId;
  onIntentChange: (value: MerlinIntentId) => void;
  result: MerlinResult | null;
  status: string | null;
  error: string | null;
  isProcessing: boolean;
  customInstruction: string;
  onCustomInstructionChange: (value: string) => void;
  onExecute: () => Promise<void> | void;
  onClose: () => void;
  isDemoMode: boolean;
};

export default function MerlinMailPanel({
  thread,
  isConnected,
  intentId,
  onIntentChange,
  result,
  status,
  error,
  isProcessing,
  customInstruction,
  onCustomInstructionChange,
  onExecute,
  onClose,
}: MerlinMailPanelProps) {
  const intent = useMemo(
    () => MAIL_INTENTS.find((candidate) => candidate.id === intentId) ?? MAIL_INTENTS[0],
    [intentId]
  );
  const t = useT();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);

  useEffect(() => {
    if (customInstruction && !isOptionsOpen) {
      setIsOptionsOpen(true);
    }
  }, [customInstruction, isOptionsOpen]);

  const rawResult = result?.raw;
  const sanitizedResultRaw = useMemo(() => stripDebugMarkers(rawResult), [rawResult]);
  const sanitizedDraftBody = useMemo(
    () => stripDebugMarkers(result?.draft?.body),
    [result?.draft?.body]
  );
  const fallbackMode = useMemo(() => detectFallbackMode(rawResult), [rawResult]);
  const summaryDetails = useMemo(
    () => parseSummaryResult(sanitizedResultRaw),
    [sanitizedResultRaw]
  );
  const fallbackBullets = useMemo(() => toBulletPoints(sanitizedResultRaw), [sanitizedResultRaw]);
  const fallbackParagraphs = useMemo(
    () => splitIntoParagraphs(sanitizedResultRaw),
    [sanitizedResultRaw]
  );

  const displayBulletLines = summaryDetails?.bulletLines.length
    ? summaryDetails.bulletLines
    : fallbackBullets;
  const bulletPreview = displayBulletLines.slice(0, 6);

  const isDraftIntent = intentId === "draft_reply";
  const isSummaryIntent = intentId === "summarize_mail";
  const hasThread = Boolean(thread);
  const canExecute = hasThread && (!isDraftIntent || isConnected);
  const actionLabel = isProcessing ? t("merlin.processing") : t("merlin.execute");

  const handleCopyOutput = useCallback(() => {
    if (!sanitizedResultRaw || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(sanitizedResultRaw);
  }, [sanitizedResultRaw]);

  const renderSummaryContent = () => (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {summaryDetails?.summaryLine && (
        <p className="text-sm font-semibold text-foreground">{summaryDetails.summaryLine}</p>
      )}
      {bulletPreview.length > 0 && (
        <ul className="space-y-1 pl-4 text-sm text-foreground">
          {bulletPreview.map((point, index) => (
            <li key={index} className="list-disc marker:text-foreground/70">
              {point}
            </li>
          ))}
        </ul>
      )}
      {summaryDetails?.nextStep && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {t("merlin.next_step")}
          </p>
          <p className="text-sm text-foreground">{summaryDetails.nextStep}</p>
        </div>
      )}
      {!bulletPreview.length && !summaryDetails?.summaryLine && sanitizedResultRaw && (
        <p>{sanitizedResultRaw}</p>
      )}
    </div>
  );

  const renderDraftContent = () => {
    const draftParagraphs = splitIntoParagraphs(sanitizedDraftBody);
    return (
      <div className="space-y-3 text-sm leading-relaxed text-foreground">
        {result?.draft?.subject && (
          <p className="text-sm font-semibold text-foreground">
            {t("merlin.subject_label")} {result.draft.subject}
          </p>
        )}
        {draftParagraphs.length ? (
          draftParagraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{t("merlin.draft_empty")}</p>
        )}
      </div>
    );
  };

  const renderDefaultContent = () => {
    if (fallbackBullets.length > 0) {
      return (
        <ul className="space-y-1 pl-4 text-sm text-foreground">
          {fallbackBullets.map((point, index) => (
            <li key={index} className="list-disc marker:text-foreground/70">
              {point}
            </li>
          ))}
        </ul>
      );
    }

    if (fallbackParagraphs.length > 0) {
      return (
        <div className="space-y-2 text-sm leading-relaxed text-foreground">
          {fallbackParagraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      );
    }

    return (
      <p className="text-xs text-muted-foreground">
        {t("merlin.no_output")}
      </p>
    );
  };

  const renderResultArea = () => {
    if (isProcessing) {
      return <p className="text-sm text-muted-foreground">{t("merlin.processing")}</p>;
    }

    if (!result) {
      return (
        <p className="text-xs text-muted-foreground">{t("merlin.no_output")}</p>
      );
    }

    if (isSummaryIntent) {
      return renderSummaryContent();
    }

    if (isDraftIntent) {
      return renderDraftContent();
    }

    return renderDefaultContent();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
            {t("merlin.label")}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("merlin.close_panel")}
            className="rounded-full border border-border/60 bg-background/60 p-1 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold leading-snug text-foreground line-clamp-2">
            {thread?.subject || t("mail.no_subject")}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {thread?.messages?.[0]?.from ||
              thread?.participants?.join(", ") ||
              t("mail.unknown_sender")}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex-1">
            <span className="sr-only">{t("merlin.action_label")}</span>
            <select
              value={intentId}
              onChange={(event) =>
                onIntentChange(event.target.value as MerlinIntentId)
              }
              className="h-9 w-full rounded-md border border-border/60 bg-transparent px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/60"
            >
              {MAIL_INTENTS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="h-9 px-4 sm:ml-3"
            onClick={() => {
              void onExecute();
            }}
            disabled={!canExecute || isProcessing}
            aria-busy={isProcessing ? true : undefined}
          >
            {actionLabel}
          </Button>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t("merlin.choose_action")}</p>
          {intent?.description && <p>{intent.description}</p>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden">
        {fallbackMode && (
          <div className="inline-flex items-center rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Offline-Modus: vereinfachte Ausgabe
          </div>
        )}
        <div className="flex flex-1 flex-col rounded-xl border border-border/60 bg-muted/20 p-4 text-sm leading-relaxed text-foreground">
          <div className="flex-1" aria-live="polite">
            {renderResultArea()}
          </div>
          {result && sanitizedResultRaw && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleCopyOutput}
                className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Kopieren
              </button>
            </div>
          )}
        </div>
        {(status || error) && (
          <div className="space-y-1 text-xs">
            {status && <p className="text-muted-foreground">{status}</p>}
            {error && <p className="text-destructive">{error}</p>}
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
          <span>Optionen</span>
          <span aria-hidden="true">{isOptionsOpen ? "−" : "+"}</span>
        </button>
        {isOptionsOpen && (
          <textarea
            value={customInstruction}
            onChange={(event) => onCustomInstructionChange(event.target.value)}
            placeholder="Optional: Ton, Format oder besondere Hinweise …"
            rows={3}
            className="min-h-[90px] w-full resize-none rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        )}
      </div>
    </div>
  );
}
