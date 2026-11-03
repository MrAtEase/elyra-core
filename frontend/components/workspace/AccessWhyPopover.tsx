"use client";

import { useId, useMemo, useState } from "react";

import { getAccessRequestsEndpoint } from "@/utils/auth-guard";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import {
  getCapabilityLabel,
  getCapabilityReason,
  getMissingCapabilities,
  getWorkspaceAccess,
} from "@/components/workspace/admin/access";

const DOMAIN_LABELS: Record<string, string> = {
  mail: "Mail",
  calendar: "Calendar",
  docs: "Docs",
  commerce: "Commerce",
  infra: "Infrastructure",
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  google_oauth: "Google",
  apple: "Apple",
  microsoft: "Microsoft",
  imap_smtp: "IMAP/SMTP",
  caldav: "CalDAV",
  notion: "Notion",
  aws: "AWS",
  shopify: "Shopify",
  email: "Email",
};

function getProviderLabel(provider?: string | null) {
  if (!provider) return "a provider";
  if (provider.startsWith("google")) return "Google";
  return PROVIDER_LABELS[provider] ?? provider;
}

function getDomainLabel(domain?: string | null) {
  if (!domain) return "domain";
  return DOMAIN_LABELS[domain] ?? domain;
}

type AccessWhyPopoverProps = {
  requiredCaps: string[];
  note?: string;
};

export default function AccessWhyPopover({ requiredCaps, note }: AccessWhyPopoverProps) {
  const { data } = useWorkspaceData();
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const missingCaps = useMemo(
    () => getMissingCapabilities(access, requiredCaps),
    [access, requiredCaps]
  );
  const [open, setOpen] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const popoverId = useId();
  const workspaceId = data?.activeWorkspace?.id ?? null;

  if (!missingCaps.length) {
    return null;
  }

  const handleRequestAccess = async () => {
    if (!workspaceId) return;
    setRequestStatus(null);
    setRequestError(null);
    try {
      const response = await fetch(getAccessRequestsEndpoint(), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          requestedCaps: missingCaps,
          note: note ?? null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to submit request.");
      }
      setRequestStatus("Request sent to admins.");
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Unable to submit request.");
    }
  };

  return (
    <span className="access-why">
      <button
        type="button"
        className="access-why__button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={popoverId}
      >
        Why?
      </button>
      {open ? (
        <div className="access-why__popover" id={popoverId} role="dialog" aria-live="polite">
          <p className="access-why__title">Access details</p>
          <p className="access-why__meta">
            Role: {access.normalizedRole ? access.normalizedRole.toUpperCase() : "Unknown"}
          </p>
          <div className="access-why__list">
            {missingCaps.map((cap) => {
              const reason = getCapabilityReason(access, cap);
              const reasonText =
                reason?.grantedBy === "connection"
                  ? `${getProviderLabel(reason.connection?.provider)} ${getDomainLabel(
                      reason.connection?.domain
                    )} (${reason.connection?.access ?? "read"})`
                  : "Role assignment required";
              const actionText =
                reason?.grantedBy === "connection"
                  ? access.isAdminOrOwner
                    ? `Connect ${getProviderLabel(reason.connection?.provider)} ${getDomainLabel(
                        reason.connection?.domain
                      )}`
                    : `Ask an admin to connect ${getProviderLabel(
                        reason.connection?.provider
                      )} ${getDomainLabel(reason.connection?.domain)}`
                  : access.isAdminOrOwner
                    ? "Update your role to include this capability"
                    : "Ask an admin to update your role";
              return (
                <div key={cap} className="access-why__item">
                  <p className="access-why__item-title">{getCapabilityLabel(cap)}</p>
                  <p className="access-why__item-reason">{reasonText}</p>
                  <p className="access-why__item-action">{actionText}</p>
                </div>
              );
            })}
          </div>
          {!access.isAdminOrOwner && workspaceId ? (
            <button type="button" className="access-why__request" onClick={handleRequestAccess}>
              Request access
            </button>
          ) : null}
          {requestStatus && <p className="access-why__status">{requestStatus}</p>}
          {requestError && <p className="access-why__error">{requestError}</p>}
        </div>
      ) : null}
    </span>
  );
}
