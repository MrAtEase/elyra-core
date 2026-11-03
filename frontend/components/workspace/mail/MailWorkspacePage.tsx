"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ModuleHeader from "@/components/workspace/ModuleHeader";
import WorkScopeBadge from "@/components/workspace/WorkScopeBadge";
import { useWorkspaceData, type MailStatus } from "@/components/workspace/WorkspaceContext";
import { useT } from "@/lib/i18n/useT";
import IcloudMailConnect from "@/components/workspace/mail/IcloudMailConnect";
import { IdentityPicker } from "@/components/workspace/mail/IdentityPicker";
import type { MailIdentity } from "@/components/workspace/mail/mail.types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CARD_SURFACE,
  PANE_DIVIDER_R,
  PANE_SCROLL,
  STAGE_GREY_READABLE,
  STAGE_INNER,
  STAGE_SHELL,
} from "@/lib/ui/surfaces";

const STATUS_COPY: Record<MailStatus, { title: string; key: string }> = {
  loading: { title: "Loading mail", key: "mail.loadingSubtitle" },
  not_connected: { title: "Mail not connected", key: "mail.notConnectedSubtitle" },
  connected: { title: "Mail connected", key: "mail.connectedSubtitle" },
  no_access: { title: "No access", key: "mail.noAccessSubtitle" },
  error: { title: "Mail error", key: "mail.errorSubtitle" },
};

function formatDate(value: string | undefined): string {
  if (!value) return "";
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(stamp);
}

export default function MailWorkspacePage() {
  const t = useT();
  const {
    data,
    mailStatus,
    mailError,
    mailProvider,
    mailInbox,
    mailThread,
    mailThreadLoading,
    mailThreadError,
    mailLabels,
    mailLabelsLoading,
    mailIdentities,
    activeMailIdentity,
    setActiveMailIdentity,
    refreshMail,
    fetchMailThread,
    trashMailThread,
    loadMailLabels,
  } = useWorkspaceData();

  const mappedIdentities: MailIdentity[] = useMemo(
    () =>
      mailIdentities.map((identity) => ({
        ...identity,
        provider: "icloud" as const,
        status: "active" as const,
      })),
    [mailIdentities]
  );

  const workspaceId = data?.activeWorkspace?.id ?? null;
  const workspaceType = String(data?.activeWorkspace?.type ?? "").toLowerCase();
  const isPersonalWorkspace = workspaceType === "personal" || workspaceType === "individual";
  const activeIdentityRecord = mappedIdentities.find((identity) => identity.id === activeMailIdentity);
  const activeIdentityEmail = activeIdentityRecord?.email ?? data?.user?.email ?? null;

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    void loadMailLabels();
  }, [loadMailLabels]);

  useEffect(() => {
    if (!mailLabels.length) {
      setActiveLabel("INBOX");
      return;
    }
    if (!mailLabels.some((label) => label.id === activeLabel)) {
      setActiveLabel(mailLabels[0]?.id ?? "INBOX");
    }
  }, [mailLabels, activeLabel]);

  useEffect(() => {
    void refreshMail(activeLabel || "INBOX");
  }, [activeLabel, refreshMail]);

  useEffect(() => {
    if (!mailInbox.length) {
      setSelectedThreadId(null);
      return;
    }
    if (!selectedThreadId || !mailInbox.some((item) => item.id === selectedThreadId)) {
      setSelectedThreadId(mailInbox[0]?.id ?? null);
    }
  }, [mailInbox, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    void fetchMailThread(selectedThreadId);
  }, [selectedThreadId, fetchMailThread]);

  const filteredThreads = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return mailInbox;
    return mailInbox.filter((thread) => {
      const haystack = `${thread.from} ${thread.subject} ${thread.snippet}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [mailInbox, searchTerm]);

  const statusTitle = STATUS_COPY[mailStatus].title;
  const statusDescription = mailError ?? t(STATUS_COPY[mailStatus].key as any);

  const handleRetry = useCallback(() => {
    void refreshMail(activeLabel || "INBOX");
  }, [activeLabel, refreshMail]);

  const activeThread = mailThread && mailThread.id === selectedThreadId ? mailThread : null;

  return (
    <section className="workspace-main-panel workspace-mail">
      <ModuleHeader
        moduleLabel={t("mail.moduleLabel")}
        subtitle={t("mail.moduleSubtitle")}
        rightSlot={
          <div className="workspace-mail__header-actions">
            <IdentityPicker
              identities={mappedIdentities}
              value={activeMailIdentity}
              onChange={setActiveMailIdentity}
            />
            <WorkScopeBadge />
          </div>
        }
      />

      <div className="workspace-mail__status">
        <div>
          <p className="workspace-mail__status-title">{statusTitle}</p>
          <p className="workspace-mail__status-desc">{statusDescription}</p>
        </div>
        <div className="workspace-mail__status-actions">
          {mailProvider === "imap" || mailProvider === "icloud_imap" ? (
            <span className="workspace-mail__provider-tag">Connected provider: IMAP (iCloud)</span>
          ) : null}
          <button
            type="button"
            className="workspace-mail__secondary"
            onClick={handleRetry}
          >
            {t("mail.reload")}
          </button>
        </div>
      </div>

      {(isPersonalWorkspace || mailProvider === "imap" || mailProvider === "icloud_imap") && workspaceId ? (
        <IcloudMailConnect
          workspaceId={workspaceId}
          connected={mailStatus === "connected"}
          identityEmail={activeIdentityEmail}
          onSuccess={() => refreshMail(activeLabel || "INBOX")}
        />
      ) : null}

      <div className={cn(STAGE_SHELL, "h-[calc(100vh-120px)] min-h-[620px]")}> 
        <div className={cn(STAGE_INNER, "h-full")}> 
          <div className={cn("grid h-full min-h-0 grid-cols-1 md:grid-cols-[360px_1fr]", STAGE_GREY_READABLE)}>
            <section className={cn("flex h-full min-h-0 flex-col", PANE_SCROLL, PANE_DIVIDER_R)}>
              <div className="space-y-3 px-5 py-5">
                <div className="flex items-center gap-2">
                  <input
                    className="mail-search"
                    type="search"
                    placeholder={t("mail.searchPlaceholder")}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {mailLabelsLoading ? <span className="text-xs text-slate-500">{t("mail.labelsLoading")}</span> : null}
                  {(mailLabels.length ? mailLabels : [{ id: "INBOX", name: "INBOX" }]).map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      className={`chip ${activeLabel === label.id ? "chip--active" : ""}`}
                      onClick={() => setActiveLabel(label.id)}
                    >
                      {label.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="flex flex-col gap-3">
                  {filteredThreads.map((thread) => {
                    const selected = thread.id === selectedThreadId;
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setSelectedThreadId(thread.id)}
                        className={cn(
                          "rounded-2xl border px-3 py-3 text-left transition",
                          selected
                            ? "border-primary/70 bg-primary/10"
                            : "border-slate-200/50 bg-white/70 hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{thread.from || t("mail.unknownSender")}</p>
                          <span className="text-[11px] text-slate-500">{formatDate(thread.date)}</span>
                        </div>
                        <p className="truncate text-sm text-slate-800">{thread.subject || t("mail.noSubject")}</p>
                        <p className="line-clamp-1 text-xs text-slate-500">{thread.snippet || t("mail.noPreview")}</p>
                      </button>
                    );
                  })}
                  {!filteredThreads.length ? (
                    <p className="text-sm text-slate-500">{t("mail.emptyInbox")}</p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="flex h-full min-h-0 flex-col">
              <div className="h-full overflow-y-auto px-6 py-5">
                {mailThreadLoading ? <p className="text-sm text-slate-500">{t("mail.loadingMessage")}</p> : null}
                {mailThreadError ? <p className="text-sm text-rose-600">{mailThreadError}</p> : null}
                {!activeThread && !mailThreadLoading ? (
                  <p className="text-sm text-slate-500">{t("mail.selectThread")}</p>
                ) : null}

                {activeThread ? (
                  <article className="space-y-4">
                    <header className="flex items-center justify-between border-b border-slate-200/70 pb-3">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">{activeThread.subject || t("mail.noSubject")}</h2>
                        <p className="text-xs text-slate-500">{activeThread.participants.join(", ")}</p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void trashMailThread(activeThread.id, activeLabel || "INBOX")}
                      >
                        {t("mail.delete")}
                      </Button>
                    </header>

                    <div className="space-y-3">
                      {activeThread.messages.map((message) => (
                        <article key={message.id} className={cn("space-y-2 p-4", CARD_SURFACE)}>
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span className="font-medium text-slate-900">{message.from}</span>
                            <span>{formatDate(message.date)}</span>
                          </div>
                          <p className="text-sm leading-relaxed text-slate-700">
                            {message.textPlain || message.snippet || t("mail.noPreview")}
                          </p>
                        </article>
                      ))}
                    </div>
                  </article>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
