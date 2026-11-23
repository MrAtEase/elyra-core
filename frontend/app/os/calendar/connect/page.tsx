"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

type SaveState = "idle" | "testing" | "saving";

type ApiErrorPayload = {
  error?: string;
  message?: string;
  details?: string;
  workspaceId?: string;
  upstreamUrl?: string | null;
};

type ApiError = Error & {
  code?: string;
  details?: string;
  status?: number;
};

function ShellCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-[640px] rounded-[28px] border px-6 py-6 shadow-[0_24px_64px_rgba(5,9,18,0.42)] backdrop-blur-xl" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">Calendar Integration</p>
      <h1 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{title}</h1>
      <p className="mt-2 text-sm text-[color:var(--text-secondary)]">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

async function postCaldav(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? `Request failed (${response.status})`;
    const error = new Error(message) as ApiError;
    if (typeof payload?.error === "string" && payload.error.length > 0) {
      error.code = payload.error;
    }
    if (typeof payload?.details === "string" && payload.details.length > 0) {
      error.details = payload.details;
    }
    error.status = response.status;
    throw error;
  }
}

function resolveErrorDetails(error: unknown, fallback: string) {
  const payload = error as ApiError | null;
  if (typeof payload?.details === "string" && payload.details.trim()) {
    return payload.details;
  }
  if (payload?.code === "caldav_routes_missing") {
    return "This is a backend deployment issue, not an iCloud password issue. Calendar can only save after email-io is updated with CalDAV support.";
  }
  if (payload?.code === "email_io_not_configured") {
    return "The frontend runtime is missing the email-io environment variables required to proxy Calendar requests.";
  }
  if (payload?.message?.includes("Unable to resolve CalDAV principal.")) {
    return "iCloud responded, but the CalDAV principal lookup could not be parsed. This is a server-side CalDAV compatibility issue, not a secret-storage issue.";
  }
  if (payload?.message?.includes("CalDAV request failed (400).")) {
    return "The CalDAV server rejected a WebDAV request. The backend now returns the failing phase in the main error line; use that to identify whether principal discovery, calendar lookup, or event querying failed.";
  }
  if (payload?.message?.includes("CalDAV calendar list lookup failed.")) {
    return "Calendar-list enumeration can fail on some CalDAV servers even when authentication is valid. The connect flow now saves after principal and calendar-home discovery; restart the backend if you still see this exact message.";
  }
  return fallback;
}

export default function OsCalendarConnectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";

  const [serverUrl, setServerUrl] = useState("https://caldav.icloud.com");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [status, setStatus] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(searchParams.get("error"));
  const [details, setDetails] = useState<string | null>(null);

  const canSubmit = workspaceId.length > 0 && serverUrl.trim() && username.trim() && appPassword.trim();

  const safeWorkspaceLabel = useMemo(() => (workspaceId ? workspaceId.slice(0, 8) : "missing"), [workspaceId]);

  const handleTest = async () => {
    if (!canSubmit) {
      setMessage("Workspace, CalDAV URL, username, and app password are required.");
      return;
    }

    setStatus("testing");
    setMessage(null);
    setDetails(null);

    try {
      await postCaldav("/api/calendar/caldav/test", {
        workspaceId,
        credentials: {
          serverUrl: serverUrl.trim(),
          username: username.trim(),
          appPassword,
        },
      });
      console.info("[os/calendar/connect] caldav test succeeded", {
        workspaceId: safeWorkspaceLabel,
        route: "calendar/caldav/test",
      });
      setMessage("Connection test succeeded. You can save these credentials now.");
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Unable to test CalDAV connection.";
      console.warn("[os/calendar/connect] caldav test failed", {
        workspaceId: safeWorkspaceLabel,
        route: "calendar/caldav/test",
        reason: nextMessage,
      });
      setMessage(nextMessage);
      setDetails(
        resolveErrorDetails(
          error,
          "Check the CalDAV URL, the iCloud address, and that the password is an app-specific password."
        )
      );
    } finally {
      setStatus("idle");
    }
  };

  const handleSave = async () => {
    if (!canSubmit) {
      setMessage("Workspace, CalDAV URL, username, and app password are required.");
      return;
    }

    setStatus("saving");
    setMessage(null);
    setDetails(null);

    try {
      await postCaldav("/api/calendar/caldav/credentials", {
        workspaceId,
        credentials: {
          serverUrl: serverUrl.trim(),
          username: username.trim(),
          appPassword,
        },
      });
      console.info("[os/calendar/connect] caldav credentials saved", {
        workspaceId: safeWorkspaceLabel,
        route: "calendar/caldav/credentials",
      });
      router.replace("/os/calendar?calendar_connect=icloud_success");
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Unable to save CalDAV credentials.";
      console.warn("[os/calendar/connect] caldav save failed", {
        workspaceId: safeWorkspaceLabel,
        route: "calendar/caldav/credentials",
        reason: nextMessage,
      });
      setMessage(nextMessage);
      setDetails(
        resolveErrorDetails(
          error,
          "No secrets were stored. Review the credentials and try again."
        )
      );
      setStatus("idle");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <ShellCard
        title="Connect iCloud Calendar"
        subtitle="Set up iCloud CalDAV inside the OS shell. You will be returned to Calendar after a successful save."
      >
        {!workspaceId ? (
          <div className="rounded-2xl border px-4 py-4 text-sm" style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(127,29,29,0.18)", color: "rgb(254,226,226)" }}>
            Missing `workspaceId` in the URL. Open this flow from Calendar so the workspace context is preserved.
          </div>
        ) : null}

        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">CalDAV URL</span>
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              className="h-11 rounded-2xl border px-3 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">iCloud Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="name@icloud.com"
              className="h-11 rounded-2xl border px-3 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">App-Specific Password</span>
            <input
              type="password"
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
              className="h-11 rounded-2xl border px-3 text-sm text-[color:var(--text-primary)] outline-none"
              style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)" }}
            />
          </label>
        </div>

        {message ? (
          <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: message.toLowerCase().includes("succeeded") ? "rgba(74,222,128,0.35)" : "rgba(245,158,11,0.35)", background: message.toLowerCase().includes("succeeded") ? "rgba(20,83,45,0.18)" : "rgba(120,53,15,0.18)", color: "var(--text-primary)" }}>
            <p>{message}</p>
            {details ? <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{details}</p> : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={status !== "idle" || !canSubmit}
            className="rounded-2xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
          >
            {status === "testing" ? "Testing..." : "Test Connection"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={status !== "idle" || !canSubmit}
            className="rounded-2xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--os-accent)", color: "var(--text-on-accent, #fff)" }}
          >
            {status === "saving" ? "Saving..." : "Save and Return"}
          </button>
          <Link
            href="/os/calendar"
            className="rounded-2xl border px-4 py-2.5 text-sm font-medium transition"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
          >
            Back to Calendar
          </Link>
        </div>
      </ShellCard>
    </main>
  );
}
