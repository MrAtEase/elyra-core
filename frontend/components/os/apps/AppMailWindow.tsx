"use client";

import { useEffect, useMemo, useState } from "react";
import { MailCheck, RefreshCw, Send, Sparkles } from "lucide-react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

function extractEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export default function AppMailWindow() {
  const {
    mailStatus,
    mailError,
    mailInbox,
    mailThread,
    mailThreadLoading,
    refreshMail,
    fetchMailThread,
    sendMail,
    sendAssistantChatMessage,
    mailPendingAction,
    requestMailRevision,
    confirmMailAction,
    dismissMailAction,
  } = useWorkspaceData();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    void refreshMail("INBOX");
  }, [refreshMail]);

  useEffect(() => {
    if (!selectedThreadId && mailInbox.length > 0) {
      setSelectedThreadId(mailInbox[0]!.id);
    }
  }, [mailInbox, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    void fetchMailThread(selectedThreadId);
  }, [fetchMailThread, selectedThreadId]);

  useEffect(() => {
    if (!mailPendingAction || mailPendingAction.type !== "mail_send") return;
    const payload = mailPendingAction.payload ?? {};
    const body = payload.bodyText || payload.body || payload.text || "";
    if (typeof body === "string" && body.trim()) {
      setDraftBody(body);
    }
  }, [mailPendingAction]);

  const activeMessage = useMemo(() => {
    if (!mailThread?.messages?.length) return null;
    return mailThread.messages[mailThread.messages.length - 1] ?? null;
  }, [mailThread]);

  const receiver = useMemo(
    () => extractEmail(activeMessage?.from) ?? extractEmail(mailThread?.participants?.[0]) ?? null,
    [activeMessage?.from, mailThread?.participants]
  );
  const subject = useMemo(() => {
    const source = activeMessage?.subject || mailThread?.subject || "Follow-up";
    return source.toLowerCase().startsWith("re:") ? source : `Re: ${source}`;
  }, [activeMessage?.subject, mailThread?.subject]);

  const handleDraft = async () => {
    if (!activeMessage?.id && !mailThread?.id) return;
    setStatusText("Generating draft with Elyra...");
    const prompt = `Draft a concise and professional reply for this thread. Thread id: ${
      mailThread?.id ?? "n/a"
    }. Keep it clear and actionable.`;
    try {
      await sendAssistantChatMessage(prompt);
      if (!draftBody.trim()) {
        setDraftBody("Thanks for the update. I reviewed this and will confirm the next step shortly.");
      }
      setStatusText("Draft ready. Review before send.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unable to generate draft");
    }
  };

  const handleSend = async () => {
    if (!receiver || !draftBody.trim()) return;
    setIsSending(true);
    setStatusText(null);
    try {
      await sendMail({
        to: [receiver],
        subject,
        body: draftBody.trim(),
      });
      setDraftBody("");
      setStatusText("Email sent.");
      void refreshMail("INBOX");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to send");
    } finally {
      setIsSending(false);
    }
  };

  if (mailStatus !== "connected") {
    return (
      <section className="h-full p-5 text-white">
        <p className="text-xs uppercase tracking-[0.2em] text-white/45">Mail Setup</p>
        <h2 className="mt-2 text-lg font-semibold">Connect Mail</h2>
        <p className="mt-2 text-sm text-white/70">
          {mailStatus === "not_connected"
            ? "Mail is not connected yet. This is a first-run setup state."
            : mailStatus === "loading"
            ? "Checking mail connection..."
            : "Mail access is limited for this workspace."}
        </p>
        {mailError ? <p className="mt-3 text-xs text-rose-200">{mailError}</p> : null}
      </section>
    );
  }

  return (
    <div className="grid h-full grid-cols-[280px_minmax(0,1fr)_320px] bg-[#0b0e15]/90 text-white">
      <section className="border-r border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-white/45">Threads</p>
          <button
            type="button"
            onClick={() => void refreshMail("INBOX")}
            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-xs text-white/80"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <div className="grid gap-2">
          {mailInbox.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setSelectedThreadId(thread.id)}
              className={`rounded-lg border px-3 py-2 text-left ${
                selectedThreadId === thread.id ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <p className="truncate text-sm font-medium">{thread.subject || "No subject"}</p>
              <p className="truncate text-xs text-white/65">{thread.from}</p>
              <p className="truncate text-xs text-white/45">{thread.snippet}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="border-r border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-white/45">Thread Detail</p>
          <span className="text-xs text-white/60">{mailThreadLoading ? "Loading..." : mailThread?.messages?.length ?? 0} msgs</span>
        </div>
        {!mailThread ? (
          <p className="text-sm text-white/60">Select a thread to open it.</p>
        ) : (
          <div className="grid gap-3">
            <h3 className="text-base font-semibold">{mailThread.subject || "No subject"}</h3>
            {(mailThread.messages || []).map((message) => (
              <article key={message.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs text-white/55">{message.from}</p>
                <p className="whitespace-pre-wrap text-sm text-white/88">
                  {message.textPlain || message.snippet || "No preview available."}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-white/45">Draft Reply</p>
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            onClick={handleDraft}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white"
          >
            <Sparkles size={14} /> Draft reply with Elyra
          </button>
          <textarea
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            rows={12}
            placeholder="Draft appears here..."
            className="w-full rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-white outline-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!receiver || !draftBody.trim() || isSending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300/20 px-3 py-2 text-sm font-semibold text-cyan-50 disabled:opacity-50"
          >
            <Send size={14} /> {isSending ? "Sending..." : "Send"}
          </button>
          {mailPendingAction?.type === "mail_send" ? (
            <div className="rounded-lg border border-amber-200/35 bg-amber-100/10 p-2 text-xs text-amber-100">
              <p className="mb-2">Elyra prepared a supervised send action.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void confirmMailAction()} className="rounded bg-emerald-500/30 px-2 py-1">
                  <MailCheck size={12} className="inline-block align-middle" /> Confirm
                </button>
                <button type="button" onClick={() => void requestMailRevision()} className="rounded bg-white/15 px-2 py-1">
                  Revise
                </button>
                <button type="button" onClick={() => void dismissMailAction()} className="rounded bg-rose-500/25 px-2 py-1">
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          {statusText ? <p className="text-xs text-white/65">{statusText}</p> : null}
        </div>
      </section>
    </div>
  );
}
