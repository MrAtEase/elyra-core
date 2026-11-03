"use client";

import { useMemo, useState } from "react";

import SettingsFormRow from "@/components/merlin/settings/SettingsFormRow";
import SettingsTextField from "@/components/merlin/settings/SettingsTextField";
import AccessWhyPopover from "@/components/workspace/AccessWhyPopover";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { getWorkspaceAccess } from "@/components/workspace/admin/access";
import {
  getWorkspaceConnectionsConnectEndpoint,
  getWorkspaceConnectionsDisconnectEndpoint,
  getWorkspaceConnectionsSwitchEndpoint,
} from "@/utils/auth-guard";
import { assertNoRelativeOAuth } from "@/lib/auth/assertNoRelativeOAuth";

const DOMAIN_LABELS: Record<string, string> = {
  mail: "Mail",
  calendar: "Calendar",
  docs: "Docs",
  slides: "Slides",
  tasks: "Tasks",
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  google_oauth: "Google",
  imap_smtp: "IMAP/SMTP",
  caldav: "CalDAV",
  microsoft: "Microsoft",
  apple: "Apple",
};

const GOOGLE_SCOPE_FRAGMENTS: Record<string, string[]> = {
  mail: ["mail.google.com", "gmail.modify", "gmail.send", "gmail.readonly"],
  docs: ["drive", "documents", "spreadsheets"],
  slides: ["presentations"],
  tasks: ["tasks"],
};

const GOOGLE_SCOPE_REQUESTS: Record<string, string[]> = {
  mail: ["mail"],
  docs: ["docs", "slides"],
  slides: ["slides"],
  tasks: ["tasks"],
};

type ConnectionEntry = {
  id: string;
  domain: string;
  provider: string;
  access: string;
  status: string;
  isActive?: boolean;
  meta?: { email?: string | null } | null;
};

function getProviderLabel(provider: string) {
  if (provider.startsWith("google")) return "Google";
  return PROVIDER_LABELS[provider] ?? provider;
}

function hasGoogleScope(scopes: string[], fragments: string[]) {
  const normalized = scopes.map((scope) => scope.toLowerCase());
  return fragments.some((fragment) => normalized.some((scope) => scope.includes(fragment)));
}

export default function ConnectionsPanel() {
  const { data, refresh } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const connections = Array.isArray(data?.workspaceConnections)
    ? (data?.workspaceConnections as ConnectionEntry[])
    : [];
  const scopes = Array.isArray(data?.scopes) ? data.scopes : [];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapUser, setImapUser] = useState("");
  const [imapPassword, setImapPassword] = useState("");

  const [caldavUrl, setCaldavUrl] = useState("");
  const [caldavUser, setCaldavUser] = useState("");
  const [caldavPassword, setCaldavPassword] = useState("");
  const workspaceType = String(workspace?.type ?? "").toLowerCase();
  const isPersonalWorkspace = workspaceType === "personal" || workspaceType === "individual";

  const connectionsByDomain = useMemo(() => {
    const grouped: Record<string, ConnectionEntry[]> = {};
    connections.forEach((connection) => {
      const key = connection.domain;
      grouped[key] = grouped[key] ? [...grouped[key], connection] : [connection];
    });
    return grouped;
  }, [connections]);

  const missingGoogleScopes = useMemo(() => {
    const result: Record<string, boolean> = {};
    Object.entries(GOOGLE_SCOPE_FRAGMENTS).forEach(([domain, fragments]) => {
      result[domain] = scopes.length ? !hasGoogleScope(scopes, fragments) : false;
    });
    return result;
  }, [scopes]);

  const handleGoogleConnect = async (scopeList?: string[]) => {
    if (!workspace?.id) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyId("google");
    try {
      const response = await fetch(getWorkspaceConnectionsConnectEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "mail",
          provider: "google_oauth",
          config: {
            reauth: Boolean(scopeList && scopeList.length),
            scopes: scopeList ? scopeList.join(",") : null,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to start Google connection.");
      }
      if (payload?.authUrl) {
        // Ensure we never redirect to a relative assistant oauth path
        assertNoRelativeOAuth(payload.authUrl as string);
        window.location.assign(payload.authUrl as string);
      } else {
        await refresh();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to start Google connection.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    if (!workspace?.id) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyId(connectionId);
    try {
      const response = await fetch(getWorkspaceConnectionsDisconnectEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to disconnect.");
      }
      setStatusMessage("Connection disconnected.");
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to disconnect.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSwitch = async (domain: string, connectionId: string) => {
    if (!workspace?.id) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyId(connectionId);
    try {
      const response = await fetch(getWorkspaceConnectionsSwitchEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, toConnectionId: connectionId }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to switch connection.");
      }
      setStatusMessage("Active connection updated.");
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to switch connection.");
    } finally {
      setBusyId(null);
    }
  };

  const handleImapConnect = async () => {
    if (!workspace?.id) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyId("imap");
    try {
      const response = await fetch(getWorkspaceConnectionsConnectEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "mail",
          provider: "imap_smtp",
          access: "write",
          config: {
            host: imapHost,
            port: Number(imapPort || 993),
            user: imapUser,
            appPassword: imapPassword,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to connect IMAP/SMTP.");
      }
      setStatusMessage("IMAP/SMTP connected.");
      setImapHost("");
      setImapPort("993");
      setImapUser("");
      setImapPassword("");
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to connect IMAP/SMTP.");
    } finally {
      setBusyId(null);
    }
  };

  const handleCaldavConnect = async () => {
    if (!workspace?.id) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyId("caldav");
    try {
      const response = await fetch(getWorkspaceConnectionsConnectEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "calendar",
          provider: "caldav",
          access: "write",
          config: {
            url: caldavUrl,
            user: caldavUser,
            appPassword: caldavPassword,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to connect CalDAV.");
      }
      setStatusMessage("CalDAV connected.");
      setCaldavUrl("");
      setCaldavUser("");
      setCaldavPassword("");
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to connect CalDAV.");
    } finally {
      setBusyId(null);
    }
  };

  if (!workspace) {
    return (
      <div className="settings-placeholder">
        <p>No workspace selected.</p>
      </div>
    );
  }

  return (
    <div className="settings-subsection">
      <div>
        <p className="settings-subsection__title">Identity & Connections</p>
        <p className="settings-subsection__note">
          Connect providers to unlock mail, calendar, and document capabilities.
        </p>
      </div>

      {statusMessage && <p className="settings-form__status">{statusMessage}</p>}
      {errorMessage && <p className="settings-form__error">{errorMessage}</p>}

      <div className="settings-connections-grid">
        {["mail", "calendar", "docs", "slides", "tasks"].map((domain) => {
          const entries = connectionsByDomain[domain] ?? [];
          const activeEntry = entries.find((entry) => entry.isActive) ?? entries[0] ?? null;
          const missingScopes = missingGoogleScopes[domain];
          const scopeRequest = GOOGLE_SCOPE_REQUESTS[domain];
          const statusLabel = activeEntry
            ? activeEntry.status === "missing_scopes"
              ? "Not connected (missing scopes)"
              : "Connected"
            : missingScopes
              ? "Not connected (missing scopes)"
              : "Not connected";
          return (
            <div key={domain} className="settings-connection-card">
              <div>
                <p className="settings-connection-card__title">{DOMAIN_LABELS[domain] ?? domain}</p>
                <p className="settings-connection-card__status">{statusLabel}</p>
                {activeEntry ? (
                  <p className="settings-connection-card__meta">
                    {getProviderLabel(activeEntry.provider)}
                    {activeEntry.meta?.email ? ` · ${activeEntry.meta.email}` : ""}
                  </p>
                ) : null}
                {missingScopes ? (
                  <p className="settings-connection-card__meta">
                    Re-auth required to enable {DOMAIN_LABELS[domain] ?? domain}.
                  </p>
                ) : null}
              </div>
              <div className="settings-connection-card__actions">
                {domain === "mail" && isPersonalWorkspace ? (
                  <button
                    type="button"
                    className="settings-member-card__action"
                    onClick={() => {
                      const section = document.getElementById("imap-connect-section");
                      section?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    disabled={!access.canManageConnections}
                  >
                    Connect iCloud (IMAP)
                  </button>
                ) : domain === "calendar" && isPersonalWorkspace ? (
                  <button
                    type="button"
                    className="settings-member-card__action"
                    onClick={() => {
                      const section = document.getElementById("caldav-connect-section");
                      section?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    disabled={!access.canManageConnections}
                  >
                    Connect CalDAV
                  </button>
                ) : domain !== "tasks" ? (
                  <button
                    type="button"
                    className="settings-member-card__action"
                    onClick={() =>
                      handleGoogleConnect(scopeRequest && scopeRequest.length ? scopeRequest : undefined)
                    }
                    disabled={!access.canManageConnections || busyId === "google"}
                  >
                    {missingScopes ? "Reconnect Google" : "Connect Google"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="settings-member-card__action"
                    onClick={() => handleGoogleConnect(["tasks"])}
                    disabled={!access.canManageConnections || busyId === "google"}
                  >
                    Enable Tasks
                  </button>
                )}
                {!access.canManageConnections ? (
                  <AccessWhyPopover requiredCaps={["workspace.connections.manage"]} />
                ) : null}
              </div>
              {entries.length > 1 ? (
                <div className="settings-connection-card__switch">
                  <label>Switch provider</label>
                  <select
                    value={activeEntry?.id ?? ""}
                    onChange={(event) => handleSwitch(domain, event.target.value)}
                    disabled={!access.canManageConnections}
                  >
                    {entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {getProviderLabel(entry.provider)}
                        {entry.meta?.email ? ` · ${entry.meta.email}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {activeEntry ? (
                <button
                  type="button"
                  className="settings-member-card__action settings-member-card__action--danger"
                  onClick={() => handleDisconnect(activeEntry.id)}
                  disabled={!access.canManageConnections || busyId === activeEntry.id}
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="settings-subsection" id="imap-connect-section">
        <div>
          <p className="settings-subsection__title">Personal mail (IMAP/SMTP)</p>
          <p className="settings-subsection__note">
            Connect a personal inbox using an app password.
          </p>
        </div>
        <div className="settings-form">
          <SettingsFormRow label="Host" helper="IMAP/SMTP host name.">
            <SettingsTextField
              value={imapHost}
              onChange={(event) => setImapHost(event.target.value)}
              placeholder="imap.example.com"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Port" helper="IMAP/SMTP port.">
            <SettingsTextField
              value={imapPort}
              onChange={(event) => setImapPort(event.target.value)}
              placeholder="993"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Username" helper="Account username or email.">
            <SettingsTextField
              value={imapUser}
              onChange={(event) => setImapUser(event.target.value)}
              placeholder="person@example.com"
            />
          </SettingsFormRow>
          <SettingsFormRow label="App password" helper="Use an app-specific password.">
            <SettingsTextField
              value={imapPassword}
              onChange={(event) => setImapPassword(event.target.value)}
              placeholder="app-password"
              type="password"
            />
          </SettingsFormRow>
          <div className="settings-form__actions">
            <button
              type="button"
              className="settings-form__submit"
              onClick={handleImapConnect}
              disabled={!access.canManageConnections || busyId === "imap"}
            >
              Connect IMAP/SMTP
            </button>
            {!access.canManageConnections ? (
              <AccessWhyPopover requiredCaps={["workspace.connections.manage"]} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="settings-subsection" id="caldav-connect-section">
        <div>
          <p className="settings-subsection__title">Personal calendar (CalDAV)</p>
          <p className="settings-subsection__note">
            Connect a CalDAV calendar using an app password.
          </p>
        </div>
        <div className="settings-form">
          <SettingsFormRow label="Server URL" helper="CalDAV server URL.">
            <SettingsTextField
              value={caldavUrl}
              onChange={(event) => setCaldavUrl(event.target.value)}
              placeholder="https://caldav.example.com"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Username" helper="Account username or email.">
            <SettingsTextField
              value={caldavUser}
              onChange={(event) => setCaldavUser(event.target.value)}
              placeholder="person@example.com"
            />
          </SettingsFormRow>
          <SettingsFormRow label="App password" helper="Use an app-specific password.">
            <SettingsTextField
              value={caldavPassword}
              onChange={(event) => setCaldavPassword(event.target.value)}
              placeholder="app-password"
              type="password"
            />
          </SettingsFormRow>
          <div className="settings-form__actions">
            <button
              type="button"
              className="settings-form__submit"
              onClick={handleCaldavConnect}
              disabled={!access.canManageConnections || busyId === "caldav"}
            >
              Connect CalDAV
            </button>
            {!access.canManageConnections ? (
              <AccessWhyPopover requiredCaps={["workspace.connections.manage"]} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
