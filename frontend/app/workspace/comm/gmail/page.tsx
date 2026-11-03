"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Sheet, SheetClose, SheetContent, SheetOverlay } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { MAIL_INTENTS, type MerlinIntentId } from "@/lib/merlin/intents";
import WorkScopeBadge from "@/components/workspace/WorkScopeBadge";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { useMailThreads } from "@/components/workspace/mail/useMailThreads";
import { createTaskFromThread } from "@/components/workspace/mail/mail-client";
import type { MailThread } from "@/components/workspace/mail/mail-model";
import type { Task } from "@/components/workspace/tasks/task-model";

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return "No date";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
};

const searchMatch = (thread: MailThread, query: string) => {
  const haystack = [thread.subject, thread.fromEmail, thread.snippet]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
};

const PRIMARY_LABELS = ["Inbox", "Focus", "Pinned"];
const MORE_LABELS = ["Sent", "Drafts", "Archive"];
const CATEGORY_LABELS = ["Updates", "People", "Ops"];

const buildMerlinOutput = (intent: MerlinIntentId, thread: MailThread | null) => {
  if (!thread) {
    return "";
  }
  const sender = thread.fromEmail ?? thread.toEmails[0] ?? "Absender";
  const snippet = thread.snippet ?? "Merlin hat keinen Text erhalten.";
  switch (intent) {
    case "draft_reply":
      return `Antwort an ${sender}: Vielen Dank für deine Nachricht. Hier ist ein Entwurf, der den Ton ruhig und fokussiert hält.`;
    case "extract_tasks":
      return `To-dos aus dieser Mail:\n• Kontext prüfen\n• Entscheidung vorbereiten\n• Team update senden`;
    case "summarize_mail":
    default:
      return `Zusammenfassung: ${snippet}`;
  }
};

export default function GmailPage() {
  const { data } = useWorkspaceData();
  const workspaceId = data?.activeWorkspace?.id ?? null;
  const userId = data?.user?.id ?? null;
  const { threads, isLoading, error, refresh } = useMailThreads(workspaceId);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createdTask, setCreatedTask] = useState<Task | null>(null);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredThreads = useMemo(() => {
    if (!normalizedQuery) {
      return threads;
    }
    return threads.filter((thread) => searchMatch(thread, normalizedQuery));
  }, [normalizedQuery, threads]);

  useEffect(() => {
    if (filteredThreads.length === 0) {
      setSelectedThreadId(null);
      return;
    }

    const stillExists = selectedThreadId
      ? filteredThreads.some((thread) => thread.id === selectedThreadId)
      : false;

    if (!selectedThreadId || !stillExists) {
      setSelectedThreadId(filteredThreads[0]!.id);
    }
  }, [filteredThreads, selectedThreadId]);

  const selectedThread = filteredThreads.find((thread) => thread.id === selectedThreadId) ?? null;

  const [merlinOpen, setMerlinOpen] = useState(false);
  const [intentId, setIntentId] = useState<MerlinIntentId>("summarize_mail");
  const [merlinText, setMerlinText] = useState("");
  const [merlinStatus, setMerlinStatus] = useState<string | null>(null);
  const [merlinError, setMerlinError] = useState<string | null>(null);
  const [isMerlinBusy, setIsMerlinBusy] = useState(false);
  const [showMoreLabels, setShowMoreLabels] = useState(false);
  const [showCategoryLabels, setShowCategoryLabels] = useState(false);
  const merlinTimerRef = useRef<number | null>(null);

  const selectedIntent = useMemo(
    () => MAIL_INTENTS.find((candidate) => candidate.id === intentId) ?? MAIL_INTENTS[0],
    [intentId]
  );

  const runIntent = (id: MerlinIntentId) => {
    if (!selectedThread) {
      setMerlinError("Wähle zuerst eine Mail aus, damit Merlin den Kontext sieht.");
      return;
    }
    const intent = MAIL_INTENTS.find((candidate) => candidate.id === id) ?? MAIL_INTENTS[0];
    if (!intent) {
      setMerlinError("Intent not available");
      return;
    }
    setMerlinError(null);
    setMerlinStatus(`${intent.label} läuft…`);
    setIsMerlinBusy(true);
    if (merlinTimerRef.current) {
      window.clearTimeout(merlinTimerRef.current);
    }
    merlinTimerRef.current = window.setTimeout(() => {
      setMerlinText(buildMerlinOutput(id, selectedThread));
      setMerlinStatus(`${intent.label} bereit.`);
      setIsMerlinBusy(false);
      merlinTimerRef.current = null;
    }, 450);
  };

  useEffect(() => {
    return () => {
      if (merlinTimerRef.current) {
        window.clearTimeout(merlinTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setMerlinStatus(null);
    setMerlinError(null);
  }, [selectedThread?.id]);

  const handleCreateTask = async () => {
    if (!workspaceId || !selectedThread) {
      return;
    }
    setIsCreating(true);
    setActionError(null);
    try {
      const task = await createTaskFromThread({
        workspaceId,
        thread: selectedThread,
        createdBy: userId,
      });
      setCreatedTask(task);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create task";
      console.error("[Mail] create task from thread", err);
      setActionError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const listMessage = isLoading
    ? "Loading mail threads…"
    : filteredThreads.length === 0
      ? "No mail threads to display."
      : null;

  return (
    <section className="workspace-main-panel relative overflow-visible px-0">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">Comm · Mail</p>
        <p className="workspace-main-panel__desc">
          Merlin ist eingebettet, nicht drübergestülpt – die Inbox fühlt sich ruhig, tool-artig und premium an.
        </p>
        <WorkScopeBadge />
      </div>

      {error && (
        <div
          className="workspace-main-panel__status-card"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          <p>{error}</p>
        </div>
      )}

      {!workspaceId ? (
        <div className="workspace-main-panel__status-card">
          <p>Select an active workspace to see mail threads.</p>
        </div>
      ) : (
        <div className="relative mt-6">
          <button
            type="button"
            aria-label="Toggle Merlin panel"
            aria-expanded={merlinOpen}
            onClick={() => setMerlinOpen((prev) => !prev)}
            className={`absolute right-[-22px] top-1/2 -translate-y-1/2 z-30 h-44 w-12 rounded-full border border-slate-200 bg-white/90 backdrop-blur shadow-md hover:shadow-lg transition focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 flex items-center justify-center ${merlinOpen ? "bg-neutral-100 shadow-inner" : ""}`}
          >
            <span
              className="text-xs tracking-[0.2em] font-medium text-neutral-700 select-none"
              style={{ writingMode: "vertical-rl" }}
            >
              MERLIN
            </span>
          </button>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div className="rounded-[26px] border border-slate-200 bg-white/80 p-5 shadow-[0_45px_90px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">Postfächer</p>
                  <button
                    type="button"
                    className="text-xs text-neutral-500 hover:text-neutral-900 transition"
                    onClick={() => setShowMoreLabels((prev) => !prev)}
                  >
                    Mehr ▾
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {PRIMARY_LABELS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
                    >
                      <span>{label}</span>
                      <span className="text-xs text-neutral-400">›</span>
                    </button>
                  ))}
                </div>
                {showMoreLabels && (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.25em] text-neutral-400">Mehr</span>
                      <button
                        type="button"
                        className="text-xs text-neutral-500 hover:text-neutral-900 transition"
                        onClick={() => setShowCategoryLabels((prev) => !prev)}
                      >
                        Kategorien ▾
                      </button>
                    </div>
                    <div className="space-y-2">
                      {MORE_LABELS.map((label) => (
                        <button
                          key={label}
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
                        >
                          <span>{label}</span>
                          <span className="text-xs text-neutral-400">›</span>
                        </button>
                      ))}
                    </div>
                    {showCategoryLabels && (
                      <div className="space-y-2 pt-2">
                        {CATEGORY_LABELS.map((label) => (
                          <button
                            key={label}
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-100"
                          >
                            <span>{label}</span>
                            <span className="text-xs text-neutral-400">›</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <input
                    type="search"
                    aria-label="Search mail threads"
                    placeholder="Search subject, sender, or snippet"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="flex-1 min-w-[180px] rounded-2xl border border-slate-200 bg-white/70 px-4 py-2 text-sm text-neutral-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-neutral-300"
                  />
                  <button
                    type="button"
                    onClick={refresh}
                    disabled={isLoading}
                    className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
                <div className="mt-4 max-h-[calc(100vh-380px)] overflow-y-auto pr-1">
                  {listMessage ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-neutral-500">
                      {listMessage}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {filteredThreads.map((thread) => {
                        const isSelected = selectedThread?.id === thread.id;
                        return (
                          <button
                            key={thread.id}
                            type="button"
                            data-e2e-mail-thread-row={`thread-${thread.id}`}
                            onClick={() => setSelectedThreadId(thread.id)}
                            aria-pressed={isSelected}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${isSelected ? "border-slate-900 bg-slate-50 shadow-[0_20px_60px_rgba(15,23,42,0.12)]" : "border-slate-200 bg-white/80 hover:border-slate-300"}`}
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <p
                                data-e2e-mail-thread-subject={`thread-${thread.id}`}
                                className="text-base font-semibold text-slate-900"
                              >
                                {thread.subject ?? "No subject"}
                              </p>
                              <span className="text-xs text-neutral-500">
                                {formatTimestamp(thread.lastMessageAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-neutral-500">
                              From: {thread.fromEmail ?? "Unknown sender"}
                            </p>
                            <p className="mt-2 text-sm text-neutral-600">
                              {thread.snippet || "No preview available."}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <article className="rounded-[26px] border border-slate-200 bg-white/90 p-6 shadow-[0_40px_80px_rgba(15,23,42,0.08)]">
                {selectedThread ? (
                  <>
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Thread details</p>
                      <h2 className="mt-1 text-2xl font-semibold text-slate-900">{selectedThread.subject ?? "No subject"}</h2>
                      <p className="mt-1 text-sm text-neutral-500">Last message: {formatTimestamp(selectedThread.lastMessageAt)}</p>
                    </div>
                    <div className="mt-4 flex flex-col gap-1">
                      <p
                        data-e2e-mail-detail-from="true"
                        className="text-sm font-medium text-slate-900"
                      >
                        From: {selectedThread.fromEmail ?? "Unknown sender"}
                      </p>
                      {selectedThread.toEmails.length > 0 && (
                        <p className="text-sm text-neutral-500">
                          To: {selectedThread.toEmails.join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Snippet</p>
                      <p
                        data-e2e-mail-detail-snippet="true"
                        className="mt-1 text-sm text-slate-900"
                      >
                        {selectedThread.snippet || "No snippet available."}
                      </p>
                    </div>
                    {selectedThread.raw && (
                      <details className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
                        <summary className="cursor-pointer text-xs text-neutral-500">Raw payload</summary>
                        <pre className="mt-3 max-h-[180px] overflow-auto text-[0.75rem] text-neutral-600 whitespace-pre-wrap">
                          {JSON.stringify(selectedThread.raw, null, 2)}
                        </pre>
                      </details>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-6 text-center text-sm text-neutral-500">
                    Select a thread to see the details and create a task.
                  </div>
                )}
              </article>

              <div className="rounded-2xl border border-slate-200 bg-neutral-50/70 px-4 py-3 flex items-center justify-between gap-4">
                <p className="text-sm text-neutral-700">
                  Merlin kann diese Mail zusammenfassen oder eine Antwort vorschlagen.
                </p>
                <button
                  type="button"
                  onClick={() => setMerlinOpen(true)}
                  className="text-sm font-medium text-neutral-900 rounded-md border border-slate-200 px-3 py-1.5 hover:bg-neutral-100 transition whitespace-nowrap"
                >
                  Vorschlag ansehen
                </button>
              </div>

              <div className="rounded-[26px] border border-slate-200 bg-white/90 p-5 shadow-[0_35px_60px_rgba(15,23,42,0.06)] space-y-3">
                <p className="text-xs uppercase tracking-[0.3em] text-neutral-500">Aktion</p>
                <button
                  type="button"
                  data-e2e-create-task-from-thread={selectedThread ? `thread-${selectedThread.id}` : undefined}
                  onClick={handleCreateTask}
                  disabled={isCreating || !selectedThread}
                  className="inline-flex items-center rounded-2xl border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-[0_15px_30px_rgba(15,23,42,0.2)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCreating ? "Creating task…" : "Create task"}
                </button>
                {actionError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                    {actionError}
                  </div>
                )}
                {createdTask && (
                  <div
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                    role="status"
                  >
                    <p className="font-medium text-slate-900">Task created</p>
                    <p className="mt-0.5">{createdTask.title} · {createdTask.id}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Sheet open={merlinOpen} onOpenChange={setMerlinOpen} modal={false}>
        <SheetOverlay className="bg-transparent pointer-events-none" />
        <SheetContent
          side="right"
          className="pointer-events-auto w-[420px] max-w-full p-0 border-l border-slate-200 bg-white [&>button]:hidden"
        >
          <div className="flex h-full flex-col">
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-neutral-500">Merlin</div>
                  <div className="mt-1 text-sm font-medium text-neutral-900">
                    {selectedThread?.subject ?? "Merlin wartet auf Kontext"}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {selectedThread?.fromEmail ?? "—"}
                  </div>
                </div>
                <SheetClose className="text-neutral-500 hover:text-neutral-900">✕</SheetClose>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 px-4 pb-3 pt-2">
              <label className="text-xs text-neutral-500">Aktion</label>
              <div className="mt-1 flex items-center gap-2">
                <select
                  className="h-9 w-full rounded-md border border-slate-200 bg-transparent px-3 text-sm text-neutral-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-neutral-300"
                  value={intentId}
                  onChange={(event) => setIntentId(event.target.value as MerlinIntentId)}
                  aria-label="Merlin Aktion wählen"
                >
                  {MAIL_INTENTS.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => runIntent(intentId)}
                  disabled={isMerlinBusy || !selectedThread}
                  aria-busy={isMerlinBusy || undefined}
                  className="h-9 whitespace-nowrap rounded-md border border-slate-200 bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isMerlinBusy ? "Merlin arbeitet…" : "Ausführen"}
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                {selectedIntent?.description ?? "Wähle eine Aktion und klicke Ausführen."}
              </p>
            </div>

            <Separator />

            <div className="px-4 py-4">
              <textarea
                value={merlinText}
                onChange={(event) => setMerlinText(event.target.value)}
                placeholder="Klicke auf einen Button oben, um Merlin zu fragen…"
                className="w-full min-h-[140px] rounded-md border border-slate-200 bg-transparent p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-neutral-300"
              />
              {merlinStatus && (
                <p className="mt-2 text-xs text-neutral-500">{merlinStatus}</p>
              )}
              {merlinError && (
                <p className="mt-2 text-xs text-rose-600">{merlinError}</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
