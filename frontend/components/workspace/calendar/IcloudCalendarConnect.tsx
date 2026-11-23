"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";

type IcloudCalendarConnectProps = {
  workspaceId: string;
  connected: boolean;
  identityEmail: string | null;
  onSuccess: () => Promise<void>;
};

export default function IcloudCalendarConnect({
  workspaceId,
  connected,
  identityEmail,
  onSuccess,
}: IcloudCalendarConnectProps) {
  const t = useT();
  const [serverUrl, setServerUrl] = useState("https://caldav.icloud.com");
  const [username, setUsername] = useState(identityEmail ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleTest = async () => {
    setStatusMessage(null);
    setIsTesting(true);
    try {
      const response = await fetch("/api/calendar/caldav/test/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          credentials: {
            serverUrl: serverUrl.trim(),
            username: username.trim(),
            appPassword,
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Unable to test CalDAV connection");
      }
      setStatusMessage(t("calendar.icloudTestSuccess"));
    } catch (error: any) {
      setStatusMessage(error?.message ?? t("calendar.icloudTestError"));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setStatusMessage(null);
    setIsSaving(true);
    try {
      const response = await fetch("/api/calendar/caldav/credentials/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          credentials: {
            serverUrl: serverUrl.trim(),
            username: username.trim(),
            appPassword,
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message ?? "Unable to save CalDAV credentials");
      }
      setStatusMessage(t("calendar.icloudSaveSuccess"));
      await onSuccess();
    } catch (error: any) {
      setStatusMessage(error?.message ?? t("calendar.icloudSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const description = useMemo(
    () =>
      connected
        ? t("calendar.icloudConnected")
        : t("calendar.icloudSubtitle"),
    [connected, t]
  );

  return (
    <section className="calendar2035__connect calendar2035__connect--icloud">
      <div>
        <p className="calendar2035__connect-title">{t("calendar.icloudTitle")}</p>
        <p className="calendar2035__connect-desc">{description}</p>
      </div>
      <div className="calendar2035__connect-form">
        <label className="calendar2035__connect-label">CalDAV URL</label>
        <input
          className="calendar2035__connect-input"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
        />
        <label className="calendar2035__connect-label">Username</label>
        <input
          className="calendar2035__connect-input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label className="calendar2035__connect-label">App password</label>
        <input
          type="password"
          className="calendar2035__connect-input"
          value={appPassword}
          onChange={(event) => setAppPassword(event.target.value)}
        />
        <div className="calendar2035__connect-actions">
          <button
            type="button"
            className="calendar2035__btn"
            onClick={handleTest}
            disabled={isTesting}
          >
            {isTesting ? t("calendar.icloudTesting") : t("calendar.icloudTest")}
          </button>
          <button
            type="button"
            className="calendar2035__btn calendar2035__btn--primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? t("calendar.icloudSaving") : t("calendar.icloudSave")}
          </button>
        </div>
        {statusMessage && (
          <p className="calendar2035__connect-status" aria-live="polite">
            {statusMessage}
          </p>
        )}
      </div>
    </section>
  );
}
