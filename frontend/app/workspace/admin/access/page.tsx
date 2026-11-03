"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import AccessWhyPopover from "@/components/workspace/AccessWhyPopover";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import {
  getCapabilityLabel,
  getWorkspaceAccess,
} from "@/components/workspace/admin/access";
import {
  getAccessRequestDecisionEndpoint,
  getWorkspaceAccessRequestsEndpoint,
} from "@/utils/auth-guard";

type AccessRequestEntry = {
  id: string;
  requesterEmail?: string | null;
  requesterName?: string | null;
  requestedCaps: string[];
  status: string;
  note?: string | null;
  createdAt: number;
};

const CAPABILITY_GROUPS = [
  {
    label: "Tasks",
    items: ["work.tasks.view", "work.tasks.write", "work.tasks.assign"],
  },
  {
    label: "Mail",
    items: ["work.mail.view", "work.mail.send"],
  },
  {
    label: "Calendar",
    items: ["work.calendar.view", "work.calendar.write"],
  },
  {
    label: "Docs",
    items: ["docs.read", "docs.write"],
  },
  {
    label: "Commerce & Infra",
    items: ["commerce.read", "commerce.write", "infra.read", "infra.write"],
  },
  {
    label: "Workspace Admin",
    items: [
      "workspace.identity.manage",
      "workspace.members.manage",
      "workspace.access.manage",
      "workspace.connections.manage",
    ],
  },
];

export default function WorkspaceAccessAdminPage() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);

  const [requests, setRequests] = useState<AccessRequestEntry[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!workspace?.id || !access.canManageAccess) return;
    setRequestLoading(true);
    setRequestError(null);
    try {
      const response = await fetch(getWorkspaceAccessRequestsEndpoint(workspace.id), {
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to load access requests.");
      }
      setRequests(Array.isArray(payload.requests) ? payload.requests : []);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Unable to load access requests.");
    } finally {
      setRequestLoading(false);
    }
  }, [access.canManageAccess, workspace?.id]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleDecision = async (requestId: string, decision: "approved" | "denied") => {
    if (!workspace?.id) return;
    setActionStatus(null);
    setRequestError(null);
    try {
      const response = await fetch(getAccessRequestDecisionEndpoint(requestId), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to update request.");
      }
      setActionStatus(
        decision === "approved"
          ? "Request approved. Role update required."
          : "Request denied."
      );
      await loadRequests();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Unable to update request.");
    }
  };

  const capabilityGroups = useMemo(() => CAPABILITY_GROUPS, []);

  if (!workspace) {
    return (
      <SettingsPane
        eyebrow="Workspace · Access"
        title="Permissions & Access"
        description="Workspace roles, policies, and access controls."
        scope="WORKSPACE"
      >
        <div className="settings-placeholder">
          <p>No workspace selected.</p>
        </div>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane
      eyebrow="Workspace · Access"
      title="Permissions & Access"
      description="Workspace roles, policies, and access controls."
      scope="WORKSPACE"
    >
      <div className="settings-access-grid">
        {capabilityGroups.map((group) => (
          <div key={group.label} className="settings-access-group">
            <h3>{group.label}</h3>
            <div className="settings-access-list">
              {group.items.map((capability) => {
                const enabled = access.capabilities.includes(capability);
                return (
                  <div
                    key={capability}
                    className={`settings-access-item ${enabled ? "is-enabled" : "is-disabled"}`}
                  >
                    <div>
                      <p className="settings-access-item__label">{getCapabilityLabel(capability)}</p>
                      <p className="settings-access-item__status">
                        {enabled ? "Enabled" : "Restricted"}
                      </p>
                    </div>
                    {!enabled ? (
                      <AccessWhyPopover requiredCaps={[capability]} note="Access request from Access page." />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {access.canManageAccess ? (
        <div className="settings-subsection">
          <div>
            <p className="settings-subsection__title">Access requests</p>
            <p className="settings-subsection__note">Review incoming access requests from your team.</p>
          </div>
          {requestLoading && <p>Loading access requests...</p>}
          {requestError && <p className="settings-form__error">{requestError}</p>}
          {actionStatus && <p className="settings-form__status">{actionStatus}</p>}
          {!requestLoading && !requests.length && (
            <div className="settings-placeholder">
              <p>No pending requests.</p>
            </div>
          )}
          {requests.length > 0 && (
            <div className="settings-access-requests">
              {requests.map((request) => (
                <div key={request.id} className="settings-access-request-card">
                  <div>
                    <p className="settings-access-request-card__title">
                      {request.requesterName || request.requesterEmail || "Requester"}
                    </p>
                    <p className="settings-access-request-card__meta">
                      {request.requestedCaps.map(getCapabilityLabel).join(", ")}
                    </p>
                    {request.note ? (
                      <p className="settings-access-request-card__note">{request.note}</p>
                    ) : null}
                  </div>
                  <div className="settings-access-request-card__actions">
                    <button
                      type="button"
                      className="settings-member-card__action"
                      onClick={() => handleDecision(request.id, "approved")}
                      disabled={request.status !== "pending"}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="settings-member-card__action settings-member-card__action--danger"
                      onClick={() => handleDecision(request.id, "denied")}
                      disabled={request.status !== "pending"}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="settings-placeholder">
          <p>Only admins can review access requests. Use the “Why?” links to request access.</p>
        </div>
      )}
    </SettingsPane>
  );
}
