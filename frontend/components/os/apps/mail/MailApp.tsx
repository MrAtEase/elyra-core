"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  ArrowRight,
  Flag,
  Mail,
  Paperclip,
  PenSquare,
  RefreshCw,
  Search,
  Send,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import IcloudMailConnect from "@/components/workspace/mail/IcloudMailConnect";
import {
  AiServiceError,
  fetchIcloudMessageDetail,
  fetchIcloudMessages,
  fetchGmailMessageDetail,
  fetchGmailMessages,
  fetchWorkspaceIntegrationState,
  startGoogleConnect,
  type GmailListMessage,
  type GmailMessageDetail,
  type WorkspaceIntegrationState,
} from "@/components/os/apps/liveGoogleClient";

const FOLDERS = [
  { id: "inbox", label: "Inbox", icon: Mail },
  { id: "sent", label: "Sent", icon: Send },
  { id: "starred", label: "Starred", icon: Star },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
] as const;

const LABEL_COLORS: Record<string, string> = {
  work: "bg-blue-500",
  important: "bg-red-500",
  design: "bg-purple-500",
  engineering: "bg-green-500",
  team: "bg-yellow-500",
};

type ComposeDraft = {
  to: string;
  subject: string;
  body: string;
};

type MailSnapshot = {
  status: WorkspaceIntegrationState;
  messages: GmailListMessage[];
  detail: GmailMessageDetail | null;
  selectedId: string | null;
  savedAt: number;
};

function formatMessageTime(value: string): string {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(stamp);
}

function formatLongDate(value: string): string {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(stamp);
}

function formatShortDate(value: string): string {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(stamp);
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof AiServiceError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

/** Parse "Name <email@domain.com>" → { name, email } or just email */
function parseSender(raw: string): { display: string; email: string | null; initials: string } {
  if (!raw || raw === "Unknown sender" || raw === "Unknown") {
    return { display: "Unbekannter Absender", email: null, initials: "?" };
  }
  // "Name <email>"
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1]?.trim() ?? "";
    const email = match[2]?.trim() ?? "";
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
    return { display: name || email, email, initials: (initials || (email[0]?.toUpperCase() ?? "?")) };
  }
  // Plain email
  if (raw.includes("@")) {
    const local = raw.split("@")[0] ?? raw;
    const display = local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { display, email: raw, initials: display[0]?.toUpperCase() ?? "?" };
  }
  // Plain name
  const initials = raw
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return { display: raw, email: null, initials: (initials || (raw[0]?.toUpperCase() ?? "?")) };
}

function isNeedsAuthError(error: unknown): boolean {
  if (!(error instanceof AiServiceError)) return false;
  const message = error.message.trim().toLowerCase();
  const code = (error.code ?? "").trim().toLowerCase();
  return message === "needs_auth" || code === "needs_auth";
}

function mailSnapshotKey(workspaceId: string) {
  return `elyra:mail:snapshot:${workspaceId}`;
}

function loadMailSnapshot(workspaceId: string): MailSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(mailSnapshotKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MailSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveMailSnapshot(workspaceId: string, snapshot: MailSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(mailSnapshotKey(workspaceId), JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

function MessageRow({ message }: { message: GmailListMessage }) {
  const sender = parseSender(message.from);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!message.isRead ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" />
          )}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--bg-surface-hover)] text-[10px] font-semibold text-[color:var(--text-secondary)]">
            {sender.initials}
          </span>
          <div className="min-w-0">
            <p className={cn("truncate text-[13px] leading-tight", message.isRead ? "text-[color:var(--text-secondary)]" : "font-semibold text-[color:var(--text-primary)]")}>
              {sender.display}
            </p>
            {sender.email && sender.display !== sender.email ? (
              <p className="truncate text-[10px] text-[color:var(--text-muted)]">{sender.email}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[color:var(--text-muted)]">
          {message.isStarred ? <Star size={13} className="fill-yellow-300 text-yellow-300" /> : null}
          {message.hasAttachment ? <Paperclip size={13} /> : null}
          <span className="text-[11px]">{formatMessageTime(message.date)}</span>
        </div>
      </div>
      <p className={cn("mt-1 truncate text-[13px]", message.isRead ? "text-[color:var(--text-secondary)]" : "font-medium text-[color:var(--text-primary)]")}>
        {message.subject}
      </p>
      <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">{message.preview}</p>
      {message.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white/95",
                LABEL_COLORS[label.toLowerCase()] ?? "bg-white/10"
              )}
            >
              {label.toLowerCase()}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function MessageDetailHeader({ message, detail }: { message: GmailListMessage; detail: GmailMessageDetail | null }) {
  const sender = parseSender(message.from);
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--bg-surface-hover)] text-sm font-semibold text-[color:var(--text-secondary)]">
        {sender.initials}
      </span>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold leading-tight text-[color:var(--text-primary)] sm:text-[20px]">
          {message.subject || "(kein Betreff)"}
        </h2>
        <p className="mt-0.5 text-sm font-medium text-[color:var(--text-secondary)]">
          {sender.display}
          {sender.email && sender.display !== sender.email && (
            <span className="ml-1.5 text-xs font-normal text-[color:var(--text-muted)]">&lt;{sender.email}&gt;</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
          {formatLongDate(message.date)}
          {detail?.headers?.length ? (
            <span className="ml-2 text-[color:var(--text-muted)]/60">{detail.headers.length} header(s)</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export default function MailApp() {
  const {
    activeWorkspace,
    activeMessages,
    activeIntentState,
    confirmActiveIntentStep,
    logBehaviorEvent,
  } = useKernel();
  const [status, setStatus] = useState<WorkspaceIntegrationState | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [messages, setMessages] = useState<GmailListMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GmailMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [showIcloudConnect, setShowIcloudConnect] = useState(false);
  const [sendConfirmed, setSendConfirmed] = useState(false);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft>({
    to: "",
    subject: "",
    body: "",
  });

  const workspaceId = status?.workspaceId ?? activeWorkspace.id;
  const workspaceSnapshotId = activeWorkspace.id;
  const googleState = status?.google;
  const mailProvider = status?.mailProvider ?? null;
  const isPersonalWorkspace = activeWorkspace.kind === "individual";
  const canReadMail = Boolean(workspaceId && mailProvider);

  // Keep selectedId in a ref so refreshMessages doesn't re-create on every click
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const didHydrateSnapshotRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const payload = await fetchWorkspaceIntegrationState(activeWorkspace.id);
      setStatus(payload);
      setError(null);
    } catch (statusError) {
      setStatus(null);
      setError(normalizeError(statusError, "Unable to validate session."));
    } finally {
      setStatusLoading(false);
    }
  }, [activeWorkspace.id]);

  // refreshMessages: selectedId removed from deps → no re-fetch on message click
  const refreshMessages = useCallback(async (
    overrideWorkspaceId?: string,
    overrideProvider?: string | null,
  ) => {
    const wid = overrideWorkspaceId ?? workspaceId;
    const provider = overrideProvider !== undefined ? overrideProvider : mailProvider;
    if (!wid || !provider) return;
    setLoading(true);
    try {
      const inbox =
        provider === "imap" || provider === "icloud_imap"
          ? await fetchIcloudMessages({ workspaceId: wid, mailbox: "INBOX", limit: 40 })
          : await fetchGmailMessages({ workspaceId: wid, q: "in:inbox", limit: 40 });
      setMessages(inbox);
      setError(null);
      const curSelected = selectedIdRef.current;
      if (!curSelected || !inbox.some((entry) => entry.id === curSelected)) {
        setSelectedId(inbox[0]?.id ?? null);
      }
      const effectiveStatus = status ?? null;
      if (effectiveStatus) {
        saveMailSnapshot(wid, {
          status: effectiveStatus.workspaceId === wid ? effectiveStatus : { ...effectiveStatus, workspaceId: wid },
          messages: inbox,
          detail: null,
          selectedId: curSelected && inbox.some((entry) => entry.id === curSelected) ? curSelected : (inbox[0]?.id ?? null),
          savedAt: Date.now(),
        });
      }
    } catch (loadError) {
      if (
        (provider === "imap" || provider === "icloud_imap") &&
        isNeedsAuthError(loadError)
      ) {
        setStatus((previous) => (previous ? { ...previous, mailProvider: null } : previous));
        setShowIcloudConnect(true);
      }
      setError(normalizeError(loadError, "Unable to load inbox."));
    } finally {
      setLoading(false);
    }
  }, [mailProvider, status, workspaceId]); // selectedId removed from deps

  // Combined initial load: fetch status + messages in a single async flow (no React re-render waterfall)
  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      const snapshot = loadMailSnapshot(activeWorkspace.id);
      if (snapshot) {
        didHydrateSnapshotRef.current = activeWorkspace.id;
        setStatus(snapshot.status);
        setMessages(snapshot.messages);
        setSelectedId(snapshot.selectedId ?? snapshot.messages[0]?.id ?? null);
        setDetail(snapshot.detail);
        setStatusLoading(false);
        setLoading(false);
        setError(null);
        setLoading(true);
      } else {
        didHydrateSnapshotRef.current = null;
        setStatusLoading(true);
        setLoading(true);
      }
      try {
        const payload = await fetchWorkspaceIntegrationState(activeWorkspace.id);
        if (cancelled) return;
        setStatus(payload);
        setError(null);
        const wid = payload.workspaceId ?? activeWorkspace.id;
        const provider = payload.mailProvider;
        saveMailSnapshot(activeWorkspace.id, {
          status: payload,
          messages: snapshot?.messages ?? [],
          detail: snapshot?.detail ?? null,
          selectedId: snapshot?.selectedId ?? null,
          savedAt: Date.now(),
        });
        if (!wid || !provider) return;
        // Immediately continue with message fetch (no re-render in between)
        prevCanReadMail.current = true;
        await refreshMessages(wid, provider);
      } catch (initError) {
        if (!cancelled) {
          setStatus(null);
          setError(normalizeError(initError, "Unable to validate session."));
        }
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    }
    void initialLoad();
    return () => { cancelled = true; };
  }, [activeWorkspace.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When canReadMail changes (e.g. user connects Google mid-session), sync messages
  const prevCanReadMail = useRef(false);
  useEffect(() => {
    if (!canReadMail) {
      setMessages([]);
      setSelectedId(null);
      setDetail(null);
      prevCanReadMail.current = false;
      return;
    }
    // Only trigger if it just became true (not on every re-render)
    if (!prevCanReadMail.current) {
      prevCanReadMail.current = true;
      void refreshMessages();
    }
  }, [canReadMail, refreshMessages]);

  useEffect(() => {
    if (!workspaceId || !selectedId || !canReadMail) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const fetchDetail =
      mailProvider === "imap" || mailProvider === "icloud_imap"
        ? fetchIcloudMessageDetail
        : fetchGmailMessageDetail;
    void fetchDetail({ workspaceId, messageId: selectedId })
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload);
        const snapshotStatus = status;
        if (snapshotStatus) {
          saveMailSnapshot(workspaceSnapshotId, {
            status: snapshotStatus,
            messages,
            detail: payload,
            selectedId,
            savedAt: Date.now(),
          });
        }
      })
      .catch((detailError) => {
        if (cancelled) return;
        if (
          (mailProvider === "imap" || mailProvider === "icloud_imap") &&
          isNeedsAuthError(detailError)
        ) {
          setStatus((previous) => (previous ? { ...previous, mailProvider: null } : previous));
          setShowIcloudConnect(true);
        }
        setError(normalizeError(detailError, "Unable to load message detail."));
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canReadMail, mailProvider, messages, selectedId, status, workspaceId, workspaceSnapshotId]);

  const filteredMessages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return messages;
    return messages.filter((message) =>
      `${message.from} ${message.subject} ${message.preview}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [messages, query]);

  const selectedFromList = useMemo(
    () => filteredMessages.find((message) => message.id === selectedId) ?? null,
    [filteredMessages, selectedId]
  );

  useEffect(() => {
    if (!selectedId && filteredMessages.length > 0) {
      setSelectedId(filteredMessages[0]!.id);
    }
    if (selectedId && !filteredMessages.some((entry) => entry.id === selectedId)) {
      setSelectedId(filteredMessages[0]?.id ?? null);
    }
  }, [filteredMessages, selectedId]);

  const activeMessage = detail ?? selectedFromList;
  const activeBodyText =
    detail?.bodyText || selectedFromList?.preview || "";
  const latestAssistantCardSet = useMemo(
    () =>
      [...activeMessages]
        .reverse()
        .find((message) => message.role === "assistant" && message.actionCards && message.actionCards.length > 0)
        ?.actionCards ?? [],
    [activeMessages]
  );
  const mailDraftCards = useMemo(
    () => latestAssistantCardSet.filter((card) => card.id.toLowerCase().includes("mail")),
    [latestAssistantCardSet]
  );
  const confirmSendStep = useMemo(
    () => activeIntentState.steps.find((step) => step.status === "approval_required"),
    [activeIntentState.steps]
  );
  const needsSendConfirmation = Boolean(
    confirmSendStep &&
      (activeIntentState.text.toLowerCase().includes("send") || activeIntentState.text.toLowerCase().includes("reply"))
  );
  const canConfirmSend = mailDraftCards.length > 0 && (needsSendConfirmation || activeIntentState.kind === "read_only");
  const folderCounts = useMemo(
    () => ({
      inbox: messages.length,
      sent: 0,
      starred: messages.filter((message) => message.isStarred).length,
      archive: 0,
      trash: 0,
    }),
    [messages]
  );

  useEffect(() => {
    if (!needsSendConfirmation) {
      setSendConfirmed(false);
    }
  }, [needsSendConfirmation, activeIntentState.updatedAt]);

  useEffect(() => {
    if (mailProvider) {
      setShowIcloudConnect(false);
    }
  }, [mailProvider]);

  const connectGoogle = async () => {
    try {
      await startGoogleConnect(workspaceId, "/os");
    } catch (connectError) {
      setError(normalizeError(connectError, "Unable to start Google connect."));
    }
  };

  const updateComposeDraft = useCallback(
    (field: keyof ComposeDraft, value: string) => {
      setComposeDraft((previous) => ({ ...previous, [field]: value }));
      logBehaviorEvent({
        eventType: "edit_output",
        fieldName: `mail_draft.${field}`,
        metadata: {
          length: value.length,
        },
      });
    },
    [logBehaviorEvent],
  );

  if (statusLoading) {
    return (
      <div className="relative h-full overflow-hidden rounded-[12px] border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-3">
        <div className="grid h-full gap-3 lg:grid-cols-[210px_360px_minmax(0,1fr)]">
          <div className="hidden rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-3 lg:block">
            <div className="h-10 rounded-xl bg-[color:var(--bg-surface-soft)]" />
            <div className="mt-4 space-y-2">
              <div className="h-9 rounded-xl bg-[color:var(--bg-surface-soft)]" />
              <div className="h-9 rounded-xl bg-[color:var(--bg-surface-soft)]" />
              <div className="h-9 rounded-xl bg-[color:var(--bg-surface-soft)]" />
            </div>
          </div>
          <div className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-3">
            <div className="h-10 rounded-xl bg-[color:var(--bg-surface-soft)]" />
            <div className="mt-3 space-y-2">
              <div className="h-20 rounded-2xl bg-[color:var(--bg-surface-soft)]" />
              <div className="h-20 rounded-2xl bg-[color:var(--bg-surface-soft)]" />
              <div className="h-20 rounded-2xl bg-[color:var(--bg-surface-soft)]" />
            </div>
          </div>
          <div className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-5">
            <div className="h-5 w-40 rounded-full bg-[color:var(--bg-surface-soft)]" />
            <div className="mt-4 space-y-3">
              <div className="h-4 rounded-full bg-[color:var(--bg-surface-soft)]" />
              <div className="h-4 rounded-full bg-[color:var(--bg-surface-soft)]" />
              <div className="h-4 w-4/5 rounded-full bg-[color:var(--bg-surface-soft)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          {error ?? "Unable to load session."}
        </div>
      </div>
    );
  }

  if (!mailProvider) {
    return (
      <div className="flex h-full min-h-0 items-stretch justify-center overflow-y-auto p-8">
        <div className="flex w-full max-w-2xl min-h-0 flex-col rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-6 text-[color:var(--text-primary)]">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-muted)]">Mail Integration</p>
          <h2 className="mt-2 text-2xl font-semibold">Connect Mail</h2>
          <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
            Connect a mail provider for this workspace to load threads and messages.
          </p>
          {!status.google.config.ready ? (
            <p className="mt-2 text-xs text-amber-700">
              Google is not configured in this environment. iCloud IMAP remains available.
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {!isPersonalWorkspace ? (
              <button
                type="button"
                onClick={() => {
                  void connectGoogle();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-sm font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
              >
                <ArrowRight size={16} />
                Connect Google
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowIcloudConnect((current) => !current)}
              className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-sm font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
            >
              <ArrowRight size={16} />
              {showIcloudConnect ? "Hide iCloud form" : "Connect iCloud"}
            </button>
          </div>
          {showIcloudConnect && workspaceId ? (
            <div className="mt-5 h-[min(66vh,560px)] min-h-[420px] overflow-hidden rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] p-4">
              <IcloudMailConnect
                workspaceId={workspaceId}
                connected={false}
                identityEmail={status?.google.accountEmail ?? null}
                onClose={() => setShowIcloudConnect(false)}
                onSuccess={async () => {
                  await refreshStatus().catch(() => undefined);
                  await refreshMessages().catch(() => undefined);
                  setShowIcloudConnect(false);
                }}
              />
            </div>
          ) : null}
          {!status.google.config.ready && status.google.config.issues.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700">
              {status.google.config.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {mailProvider ? (
            <p className="mt-3 text-xs text-[color:var(--text-muted)]">
              Active provider: {mailProvider === "google" ? "Google" : "iCloud"}
            </p>
          ) : null}
          {error ? <p className="mt-4 text-xs text-rose-600">{error}</p> : null}
        </div>
      </div>
    );
  }

  if (mailProvider === "google" && !status.google.config.ready) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-600">
            Google Configuration
          </p>
          <p className="mt-3">
            Missing Google env configuration. Set required variables and restart the app.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700">
            {status.google.config.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden rounded-[12px] border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[210px_360px_minmax(0,1fr)]">
        <aside className="hidden h-full flex-col border-r border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-3 lg:flex">
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
          >
            <PenSquare size={18} />
            Compose
          </button>

          <div className="mt-4 space-y-1">
            <p className="px-2 text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Folders</p>
            {FOLDERS.map((folder) => {
              const FolderIcon = folder.icon;
              return (
                <button
                  key={folder.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-transparent px-2 py-2 text-sm text-[color:var(--text-secondary)] transition hover:border-[color:var(--os-border-soft)] hover:bg-[color:var(--bg-surface-hover)]"
                >
                  <span className="inline-flex items-center gap-2">
                    <FolderIcon size={15} className="text-[color:var(--text-muted)]" />
                    {folder.label}
                  </span>
                  <span className="rounded-md bg-[color:var(--bg-surface-soft)] px-1.5 py-0.5 text-xs text-[color:var(--text-muted)]">
                    {folderCounts[folder.id]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <p className="px-2 text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Labels</p>
            <div className="mt-2 space-y-1">
              {Object.entries(LABEL_COLORS).map(([label, colorClass]) => (
                <div key={label} className="flex items-center gap-2 px-2 py-1.5 text-sm text-[color:var(--text-secondary)]">
                  <span className={cn("h-2.5 w-2.5 rounded-full", colorClass)} />
                  <span className="capitalize">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex h-full min-h-0 flex-col border-r border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]">
          <div className="border-b border-[color:var(--os-border-soft)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
                {activeWorkspace.label} · Mail
              </p>
              <button
                type="button"
                onClick={() => setComposeOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--os-border-soft)] px-2 py-1 text-[11px] text-[color:var(--text-secondary)] lg:hidden"
              >
                <PenSquare size={12} />
                Compose
              </button>
            </div>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search emails..."
                className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] pl-9 pr-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
              <span>{filteredMessages.length} results</span>
              <button
                type="button"
                onClick={() => void refreshMessages()}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--os-border-soft)] px-2 py-1 text-[color:var(--text-secondary)] transition hover:border-[color:var(--os-border-strong)]"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {filteredMessages.map((message) => {
              const selected = selectedId === message.id;
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(message.id)}
                    className={cn(
                      "w-full border-b border-[color:var(--os-border-soft)] px-3 py-3 text-left transition",
                      selected ? "bg-[color:var(--bg-surface-soft)]" : "hover:bg-[color:var(--bg-surface-hover)]"
                    )}
                  >
                    <MessageRow message={message} />
                  </button>
                </li>
              );
            })}
            {filteredMessages.length === 0 ? (
              <li className="px-4 py-6 text-sm text-[color:var(--text-muted)]">
                {loading ? "Loading messages..." : "No messages found."}
              </li>
            ) : null}
          </ul>
        </section>

        <section className="flex h-full min-h-0 flex-col bg-[color:var(--bg-surface)]">
          {activeMessage ? (
            <>
              <header className="border-b border-[color:var(--os-border-soft)] px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <MessageDetailHeader message={activeMessage} detail={detail} />
                  <div className="flex shrink-0 items-center gap-1 text-[color:var(--text-secondary)]">
                    <button type="button" className="rounded-lg border border-[color:var(--os-border-soft)] p-2 transition hover:bg-[color:var(--bg-surface-hover)]">
                      <Star size={16} />
                    </button>
                    <button type="button" className="rounded-lg border border-[color:var(--os-border-soft)] p-2 transition hover:bg-[color:var(--bg-surface-hover)]">
                      <Flag size={16} />
                    </button>
                    <button type="button" className="rounded-lg border border-[color:var(--os-border-soft)] p-2 transition hover:bg-[color:var(--bg-surface-hover)]">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="max-w-none text-[15px] leading-relaxed text-[color:var(--text-primary)]">
                  {detailLoading ? (
                    <p className="text-[color:var(--text-muted)]">Loading message content...</p>
                  ) : (
                    <p className="whitespace-pre-wrap">
                      {activeBodyText}
                    </p>
                  )}
                </div>
              </div>

              {mailDraftCards.length > 0 ? (
                <section className="border-t border-[color:var(--os-border-soft)] px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">AI Drafts</p>
                  <div className="mt-2 space-y-2">
                    {mailDraftCards.map((card) => (
                      <article key={card.id} className="rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 py-2">
                        <p className="text-sm text-[color:var(--text-primary)]">{card.title}</p>
                        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{card.detail}</p>
                      </article>
                    ))}
                  </div>
                  {canConfirmSend && !sendConfirmed ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmSendStep) {
                          confirmActiveIntentStep(confirmSendStep.id);
                        }
                        setSendConfirmed(true);
                      }}
                      className="mt-3 rounded-lg border border-emerald-300/45 bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-900 transition hover:bg-emerald-200"
                    >
                      Confirm send
                    </button>
                  ) : null}
                  {sendConfirmed ? (
                    <p className="mt-2 text-xs text-emerald-700">Success: drafts marked as sent.</p>
                  ) : null}
                </section>
              ) : null}

              <footer className="border-t border-[color:var(--os-border-soft)] px-5 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[color:var(--os-border-soft)] px-4 py-2 text-sm text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                  >
                    Forward
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[color:var(--os-border-soft)] px-4 py-2 text-sm text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                  >
                    Archive
                  </button>
                </div>
                <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                  Send actions are disabled in this MVP window unless `gmail.send` scope is granted.
                </p>
              </footer>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-muted)]">
              Select an email to view details.
            </div>
          )}
        </section>
      </div>

      {error ? (
        <div className="absolute bottom-4 right-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}

      <AnimatePresence>
        {composeOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setComposeOpen(false)}
            />
            <motion.div
              className="fixed inset-0 z-[310] flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="w-full max-w-2xl rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] p-5 shadow-[0_28px_88px_rgba(20,45,83,0.25)]"
                initial={{ scale: 0.9, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.94, y: 12, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">New message</h3>
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="rounded-md border border-[color:var(--os-border-soft)] p-1.5 text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)]"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="space-y-3">
                  <input
                    value={composeDraft.to}
                    onChange={(event) => updateComposeDraft("to", event.target.value)}
                    placeholder="To"
                    className="h-10 w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
                  />
                  <input
                    value={composeDraft.subject}
                    onChange={(event) => updateComposeDraft("subject", event.target.value)}
                    placeholder="Subject"
                    className="h-10 w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
                  />
                  <textarea
                    value={composeDraft.body}
                    onChange={(event) => updateComposeDraft("body", event.target.value)}
                    placeholder="Write your message..."
                    className="h-52 w-full rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
                  />
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-[color:var(--text-muted)]">
                    Draft UI works. Sending is disabled until Gmail send scope is enabled.
                  </p>
                  <button
                    type="button"
                    disabled
                    className="rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)] px-4 py-2 text-sm font-medium text-[color:var(--text-muted)]"
                  >
                    Send (disabled)
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
