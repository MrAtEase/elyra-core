"use client";

import { useMemo, useState } from "react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

type IcloudMailConnectProps = {
  workspaceId: string;
  connected: boolean;
  identityEmail: string | null;
  onSuccess: () => Promise<void>;
  onClose?: () => void;
};

type ImapCredentialsPayload = {
  imapHost?: string;
  imapPort?: number | null;
  username: string;
  appPassword: string;
};

type SmtpCredentialsPayload = {
  smtpHost?: string;
  smtpPort?: number | null;
  smtpUsername?: string;
  smtpAppPassword?: string;
  smtpSecure?: boolean;
};

export default function IcloudMailConnect({
  workspaceId,
  connected,
  identityEmail,
  onSuccess,
  onClose,
}: IcloudMailConnectProps) {
  const normalizedWorkspaceId = useMemo(
    () => normalizeWorkspaceId(workspaceId) ?? workspaceId,
    [workspaceId]
  );
  const [imapHost, setImapHost] = useState("imap.mail.me.com");
  const [imapPort, setImapPort] = useState("993");
  const [imapUsername, setImapUsername] = useState(identityEmail ?? "");
  const [imapAppPassword, setImapAppPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.mail.me.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState(identityEmail ?? "");
  const [smtpAppPassword, setSmtpAppPassword] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const sanitizedImapPort = useMemo(() => {
    const parsed = Number(imapPort);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [imapPort]);

  const sanitizedSmtpPort = useMemo(() => {
    const parsed = Number(smtpPort);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [smtpPort]);

  const buildImapPayload = (): ImapCredentialsPayload => {
    const trimmedHost = imapHost.trim();
    const normalizedImapPassword = imapAppPassword.trim() || smtpAppPassword.trim();
    return {
      ...(trimmedHost ? { imapHost: trimmedHost } : {}),
      ...(sanitizedImapPort !== null ? { imapPort: sanitizedImapPort } : {}),
      username: imapUsername.trim(),
      appPassword: normalizedImapPassword,
    };
  };

  const buildSmtpPayload = (): SmtpCredentialsPayload => {
    const trimmedHost = smtpHost.trim();
    const trimmedUsername = smtpUsername.trim();
    return {
      ...(trimmedHost ? { smtpHost: trimmedHost } : {}),
      ...(sanitizedSmtpPort !== null ? { smtpPort: sanitizedSmtpPort } : {}),
      ...(trimmedUsername ? { smtpUsername: trimmedUsername } : {}),
      ...(smtpAppPassword.trim() ? { smtpAppPassword: smtpAppPassword.trim() } : {}),
      ...(smtpSecure ? { smtpSecure: smtpSecure } : {}),
    };
  };

  const handleTestImap = async () => {
    setStatusMessage(null);
    setIsTesting(true);
    try {
      const payload = {
        workspaceId: normalizedWorkspaceId,
        credentials: buildImapPayload(),
      };
      const response = await fetch("/api/mail/imap/test/", {
        method: "POST",
        credentials: "include",
        headers: await withSupabaseAuthorization({
          "Content-Type": "application/json",
          "x-workspace-id": normalizedWorkspaceId,
        }),
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? data?.error ?? "Unable to test IMAP connection");
      }
      setStatusMessage("IMAP connection test successful.");
    } catch (error: any) {
      setStatusMessage(
        error?.message ?? "Unable to test IMAP connection."
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveCredentials = async () => {
    setStatusMessage(null);
    setIsSaving(true);
    try {
      const response = await fetch("/api/mail/imap/credentials/", {
        method: "POST",
        credentials: "include",
        headers: await withSupabaseAuthorization({
          "Content-Type": "application/json",
          "x-workspace-id": normalizedWorkspaceId,
        }),
        body: JSON.stringify({
          workspaceId: normalizedWorkspaceId,
          credentials: {
            ...buildImapPayload(),
            ...buildSmtpPayload(),
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? data?.error ?? "Unable to save iCloud credentials");
      }
      setStatusMessage("iCloud credentials saved.");
      onClose?.();
      await onSuccess().catch(() => undefined);
    } catch (error: any) {
      setStatusMessage(
        error?.message ?? "Unable to save iCloud credentials."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">iCloud Mail (IMAP)</p>
        <p className="text-sm text-[color:var(--text-secondary)]">
          Connect using your Apple app-specific password.
        </p>
        {connected && (
          <p className="text-xs font-medium text-emerald-700">Connected</p>
        )}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-surface-hover)]"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">IMAP host</label>
            <input
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              value={imapHost}
              onChange={(event) => setImapHost(event.target.value)}
              placeholder="imap.mail.me.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">IMAP port</label>
            <input
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              type="number"
              value={imapPort}
              onChange={(event) => setImapPort(event.target.value)}
              placeholder="993"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Email</label>
            <input
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              value={imapUsername}
              onChange={(event) => setImapUsername(event.target.value)}
              placeholder="name@icloud.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">App password</label>
            <input
              type="password"
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              value={imapAppPassword}
              onChange={(event) => setImapAppPassword(event.target.value)}
              placeholder="App-specific password"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">SMTP host</label>
            <input
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
              placeholder="smtp.mail.me.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">SMTP port</label>
            <input
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              type="number"
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
              placeholder="587"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">SMTP username</label>
            <input
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              value={smtpUsername}
              onChange={(event) => setSmtpUsername(event.target.value)}
              placeholder="name@icloud.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">SMTP app password</label>
            <input
              type="password"
              className="h-10 w-full rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)] px-3 text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--os-border-strong)]"
              value={smtpAppPassword}
              onChange={(event) => setSmtpAppPassword(event.target.value)}
              placeholder="App-specific password"
            />
          </div>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-[color:var(--text-secondary)]">
        <input
          type="checkbox"
          id="smtpSecure"
          checked={smtpSecure}
          onChange={(event) => setSmtpSecure(event.target.checked)}
          className="h-4 w-4 rounded border-[color:var(--os-border-soft)]"
        />
        Use secure connection (TLS)
      </label>

      <div className="sticky bottom-0 z-10 flex flex-wrap gap-2 border-t border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] pt-3">
        <button
          type="button"
          className="inline-flex items-center rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm font-medium text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleTestImap}
          disabled={isTesting}
        >
          {isTesting ? "Testing..." : "Test IMAP"}
        </button>
        <button
          type="button"
          className="inline-flex items-center rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--accent-primary)] px-3 py-2 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleSaveCredentials}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Save credentials"}
        </button>
      </div>

      {statusMessage && (
        <p className="text-xs text-[color:var(--text-secondary)]" aria-live="polite">
          {statusMessage}
        </p>
      )}
    </section>
  );
}
