"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Archive, Search } from "lucide-react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { Badge, Button, Card, ConfirmModal, ConnectCard, EmptyState, ListRow, Toast } from "@/components/os/primitives";

function extractEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

const SUGGESTIONS = [
  "Thanks for your message. I can confirm the next step by end of day.",
  "Received. I will review and send a decision tomorrow morning.",
  "Great update. Let's align quickly in a 20 minute call this week.",
];

export default function MailProgram() {
  const pathname = usePathname() ?? "";
  const slug = pathname.startsWith("/w/") ? pathname.split("/")[2] ?? "active" : "active";
  const {
    mailStatus,
    mailInbox,
    mailThread,
    mailThreadLoading,
    mailThreadError,
    mailLabels,
    mailLabelsLoading,
    activeMessage,
    refreshMail,
    fetchMailThread,
    loadMailLabels,
    sendMail,
    trashMailThread,
  } = useWorkspaceData();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState("INBOX");
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void refreshMail(activeLabel);
    void loadMailLabels();
  }, [refreshMail, loadMailLabels, activeLabel]);

  useEffect(() => {
    if (!mailInbox.length) {
      setSelectedThreadId(null);
      return;
    }
    if (!selectedThreadId) setSelectedThreadId(mailInbox[0]!.id);
  }, [mailInbox, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    void fetchMailThread(selectedThreadId);
  }, [selectedThreadId, fetchMailThread]);

  const filteredThreads = useMemo(() => {
    return mailInbox.filter((item) => {
      const query = search.toLowerCase().trim();
      const searchHit =
        !query ||
        item.subject.toLowerCase().includes(query) ||
        item.from.toLowerCase().includes(query) ||
        item.snippet.toLowerCase().includes(query);
      const unreadHit = !onlyUnread || item.unread;
      return searchHit && unreadHit;
    });
  }, [mailInbox, search, onlyUnread]);

  const receiver = extractEmail(activeMessage?.from) ?? "";
  const subject = activeMessage?.subject ? `Re: ${activeMessage.subject}` : "Follow-up";

  const handleSend = async () => {
    setConfirmOpen(false);
    if (!receiver || !draftBody.trim()) return;
    try {
      await sendMail({ to: [receiver], subject, body: draftBody.trim() });
      setToast("Email sent.");
      setDraftBody("");
      void refreshMail(activeLabel);
      window.setTimeout(() => setToast(null), 2400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send mail";
      setToast(message);
    }
  };

  if (mailStatus !== "connected") {
    return (
      <ConnectCard
        title="Connect Mail"
        text="Connect Gmail, Outlook or IMAP to unlock inbox triage, thread view and supervised send."
        note="This is a setup state, not an error. External send always asks for confirmation."
        action={
          <Link href={`/w/${slug}/marketplace`}>
            <Button>Open Integrations</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="ec-three-col">
      <Card className="ec-panel-scroll">
        <div className="ec-inline-row ec-space-between">
          <p className="ec-overline">Inbox</p>
          <Badge>{filteredThreads.length} threads</Badge>
        </div>

        <div className="ec-inline-row">
          <label className="ec-search">
            <Search size={14} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search mail" />
          </label>
          <label className="ec-check">
            <input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />
            <span>Unread</span>
          </label>
        </div>

        <div className="ec-inline-wrap">
          <button
            type="button"
            className={`ec-chip ${activeLabel === "INBOX" ? "is-active" : ""}`}
            onClick={() => setActiveLabel("INBOX")}
          >
            INBOX
          </button>
          {mailLabelsLoading ? <small>Loading labels...</small> : null}
          {mailLabels.slice(0, 8).map((label) => (
            <button
              key={label.id}
              type="button"
              className={`ec-chip ${activeLabel === label.id ? "is-active" : ""}`}
              onClick={() => setActiveLabel(label.id)}
            >
              {label.name}
            </button>
          ))}
        </div>

        <div className="ec-list">
          {filteredThreads.map((thread) => (
            <ListRow
              key={thread.id}
              className={selectedThreadId === thread.id ? "is-selected" : ""}
              title={thread.subject || "Untitled"}
              description={`${thread.from} · ${thread.date}`}
              trailing={thread.unread ? <Badge tone="accent">Unread</Badge> : null}
              onClick={() => setSelectedThreadId(thread.id)}
            />
          ))}
        </div>
      </Card>

      <Card className="ec-panel-scroll">
        <div className="ec-inline-row ec-space-between">
          <p className="ec-overline">Thread</p>
          <Button variant="ghost" onClick={() => (selectedThreadId ? void trashMailThread(selectedThreadId, activeLabel) : undefined)}>
            <Archive size={14} /> Archive
          </Button>
        </div>

        {mailThreadLoading ? <p>Loading thread...</p> : null}
        {mailThreadError ? <p>{mailThreadError}</p> : null}
        {!mailThread && !mailThreadLoading ? (
          <EmptyState title="No thread selected" text="Select a thread to inspect participants and messages." />
        ) : null}

        {mailThread ? (
          <div className="ec-thread">
            <h2>{mailThread.subject || "No subject"}</h2>
            {(mailThread.messages || []).map((message) => (
              <article key={message.id} className="ec-thread-msg">
                <strong>{message.from}</strong>
                <small>{message.date}</small>
                <p>{message.textPlain || message.snippet || "No preview available."}</p>
              </article>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">Draft + Send</p>
        <h3>Suggest reply</h3>
        <div className="ec-inline-wrap">
          {SUGGESTIONS.map((item) => (
            <button key={item} type="button" className="ec-chip" onClick={() => setDraftBody(item)}>
              {item}
            </button>
          ))}
        </div>

        <textarea
          value={draftBody}
          onChange={(event) => setDraftBody(event.target.value)}
          rows={11}
          placeholder="Edit draft before send..."
        />

        <div className="ec-inline-row">
          <Button onClick={() => setConfirmOpen(true)} disabled={!receiver || !draftBody.trim()}>
            Send (Confirm)
          </Button>
          <Button variant="outline" onClick={() => setDraftBody("")}>Clear</Button>
        </div>
        <small>Recipient: {receiver || "No thread sender selected"}</small>
      </Card>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm email send"
        message={`Send this draft to ${receiver || "recipient"}?`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleSend}
      />
      <Toast message={toast} />
    </div>
  );
}
