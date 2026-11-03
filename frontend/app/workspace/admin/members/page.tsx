"use client";

import { useEffect, useMemo, useState } from "react";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import SettingsFormRow from "@/components/merlin/settings/SettingsFormRow";
import SettingsTextField from "@/components/merlin/settings/SettingsTextField";
import { getWorkspaceAccess } from "@/components/workspace/admin/access";
import AccessWhyPopover from "@/components/workspace/AccessWhyPopover";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import {
  getWorkspaceInternalMemberEndpoint,
  getWorkspaceInvitesEndpoint,
  getWorkspaceMemberDeactivateEndpoint,
  getWorkspaceMemberRoleEndpoint,
  getWorkspaceMembersEndpoint,
} from "@/utils/auth-guard";


type MemberEntry = {
  id: string;
  userId: string | null;
  userEmail?: string | null;
  userDisplayName?: string | null;
  role: string;
  title?: string | null;
  status: string;
  inviteId?: string | null;
  kind?: "member" | "invite";
};

const EMAIL_PATTERN = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
const INTERNAL_EMAIL_DOMAIN = (
  process.env.NEXT_PUBLIC_INTERNAL_EMPLOYEE_DOMAIN || "company.com"
).replace(/^@/, "");
const ROLE_OPTIONS = [
  { label: "Staff", value: "staff" },
  { label: "Sales", value: "sales" },
  { label: "HR", value: "hr" },
  { label: "Manager", value: "manager" },
  { label: "Admin", value: "admin" },
  { label: "Owner", value: "owner" },
] as const;
const INTERNAL_ROLE_OPTIONS = [
  { label: "Staff", value: "staff" },
  { label: "Sales", value: "sales" },
  { label: "HR", value: "hr" },
  { label: "Manager", value: "manager" },
  { label: "Admin", value: "admin" },
] as const;

export default function WorkspaceMembersAdminPage() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const isPersonalWorkspace = workspace?.type === "personal";
  const canManageMembers = access.canManageMembers && !isPersonalWorkspace;
  const availableRoleOptions = access.isOwner
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((option) => option.value !== "owner");

  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [memberActionStatus, setMemberActionStatus] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [internalName, setInternalName] = useState("");
  const [internalEmail, setInternalEmail] = useState("");
  const [internalRole, setInternalRole] = useState("staff");
  const [internalStatus, setInternalStatus] = useState<string | null>(null);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);

  useEffect(() => {
    if (!workspace?.id) {
      setMembers([]);
      setError(null);
      setInviteStatus(null);
      setInviteError(null);
      setInviteLink(null);
      setMemberActionStatus(null);
      setMemberActionError(null);
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    fetch(getWorkspaceMembersEndpoint(workspace.id), {
      credentials: "include",
    })
      .then(async (response) => {
        const payload = (await response.json()) as Record<string, any>;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Unable to load members.");
        }
        if (!canceled) {
          setMembers(Array.isArray(payload.members) ? payload.members : []);
        }
      })
      .catch((err) => {
        if (!canceled) {
          console.error(err);
          setError(err instanceof Error ? err.message : "Unable to load members.");
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [workspace?.id]);

  const fallbackMembers = useMemo<MemberEntry[]>(() => {
    if (!workspace || !data?.membership) return [];
    return [
      {
        id: `${workspace.id}-${data.userId}`,
        userId: data.userId,
        userEmail: data.user?.email ?? null,
        userDisplayName: data.user?.email ?? null,
        role: data.membership.role,
        status: "active",
        kind: "member",
      },
    ];
  }, [workspace?.id, data?.membership, data?.userId, data?.user]);

  const renderedMembers = members.length ? members : !loading ? fallbackMembers : [];

  const handleInvite = async () => {
    if (!canManageMembers || !workspace?.id) {
      return;
    }
    const trimmedEmail = inviteEmail.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setInviteError("Enter a valid email address to send an invite.");
      setInviteStatus(null);
      return;
    }
    setInviteError(null);
    setInviteStatus(null);
    setInviteLink(null);
    try {
      const response = await fetch(getWorkspaceInvitesEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          role: inviteRole,
        }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to send invite.");
      }
      const invite = payload?.invite as Record<string, any> | null;
      setInviteStatus(
        payload?.delivery === "sent"
          ? `Invite sent to ${trimmedEmail}.`
          : `Invite ready for ${trimmedEmail}. Share the link below.`
      );
      if (payload?.inviteUrl) {
        setInviteLink(payload.inviteUrl as string);
      }
      if (invite?.id) {
        setMembers((prev) => [
          {
            id: invite.id,
            userId: null,
            userEmail: invite.email ?? trimmedEmail,
            userDisplayName: invite.email ?? trimmedEmail,
            role: invite.role ?? inviteRole,
            title: invite.title ?? null,
            status: "pending invite",
            inviteId: invite.id,
            kind: "invite",
          },
          ...prev.filter((entry) => entry.id !== invite.id),
        ]);
      }
      setInviteEmail("");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to send invite.");
    }
  };

  const handleInternalProvision = async () => {
    if (!canManageMembers || !workspace?.id) {
      return;
    }
    const trimmedName = internalName.trim();
    const trimmedEmail = internalEmail.trim().toLowerCase();
    if (!trimmedName) {
      setInternalError("Full name is required.");
      setInternalStatus(null);
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setInternalError("Enter a valid email address.");
      setInternalStatus(null);
      return;
    }
    if (!trimmedEmail.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)) {
      setInternalError(`Email must end with @${INTERNAL_EMAIL_DOMAIN}.`);
      setInternalStatus(null);
      return;
    }
    setInternalError(null);
    setInternalStatus(null);
    setInternalLoading(true);
    try {
      const response = await fetch(getWorkspaceInternalMemberEndpoint(workspace.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: trimmedName,
          internalEmail: trimmedEmail,
          role: internalRole,
        }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to provision internal employee.");
      }
      const member = payload?.member as MemberEntry | undefined;
      if (member) {
        setMembers((prev) => [member, ...prev.filter((entry) => entry.id !== member.id)]);
      }
      setInternalName("");
      setInternalEmail("");
      setInternalRole("staff");
      setInternalStatus(`Added ${trimmedName} as ${internalRole.toUpperCase()}.`);
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : "Unable to provision internal employee.");
    } finally {
      setInternalLoading(false);
    }
  };

  const handleRoleChange = async (member: MemberEntry, nextRole: string) => {
    if (!canManageMembers || !workspace?.id || !member.userId) {
      return;
    }
    setMemberActionStatus(null);
    setMemberActionError(null);
    setMemberBusyId(member.id);
    try {
      const response = await fetch(getWorkspaceMemberRoleEndpoint(workspace.id, member.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to update role.");
      }
      const updated = payload?.member as MemberEntry | undefined;
      if (updated) {
        setMembers((prev) => prev.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)));
      }
      setMemberActionStatus("Role updated.");
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : "Unable to update role.");
    } finally {
      setMemberBusyId(null);
    }
  };

  const handleDeactivate = async (member: MemberEntry) => {
    if (!canManageMembers || !workspace?.id || !member.userId) {
      return;
    }
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Deactivate ${member.userDisplayName || member.userEmail || "this member"}?`
          );
    if (!confirmed) return;
    setMemberActionStatus(null);
    setMemberActionError(null);
    setMemberBusyId(member.id);
    try {
      const response = await fetch(getWorkspaceMemberDeactivateEndpoint(workspace.id, member.id), {
        method: "POST",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to deactivate member.");
      }
      const updated = payload?.member as MemberEntry | undefined;
      if (updated) {
        setMembers((prev) => prev.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)));
      }
      setMemberActionStatus("Member deactivated.");
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : "Unable to deactivate member.");
    } finally {
      setMemberBusyId(null);
    }
  };

  const showInternalProvision = canManageMembers && process.env.NODE_ENV !== "production";

  if (isPersonalWorkspace) {
    return (
      <SettingsPane
        eyebrow="Workspace · Members"
        title="Members & Roles"
        description="Review who has access to this workspace."
        scope="WORKSPACE"
      >
        <div className="settings-placeholder">
          <p>Members and role management are not available for personal workspaces.</p>
        </div>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane
      eyebrow="Workspace · Members"
      title="Members & Roles"
      description="Review who has access to this workspace."
      scope="WORKSPACE"
    >
      <div className="settings-members-actions">
        <h3 style={{ margin: 0 }}>Members</h3>
        <button
          type="button"
          onClick={handleInvite}
          disabled={!canManageMembers || !inviteEmail.trim()}
          aria-label="Invite member"
        >
          Invite member
        </button>
      </div>
      {canManageMembers ? (
        <div className="settings-form">
          <SettingsFormRow label="Invite by email" helper="Send an invitation to join this workspace.">
            <SettingsTextField
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="person@company.com"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Role" helper="Assign the member role for this invite.">
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              {availableRoleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </SettingsFormRow>
          <div className="settings-form__actions">
            <button type="button" className="settings-form__submit" onClick={handleInvite}>
              Send invite
            </button>
            <div>
              {inviteStatus && <p className="settings-form__status">{inviteStatus}</p>}
              {inviteError && <p className="settings-form__error">{inviteError}</p>}
              {inviteLink ? (
                <div className="settings-form__link">
                  <label>Invite link</label>
                  <input type="text" value={inviteLink} readOnly onFocus={(event) => event.target.select()} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-form__helper">
          <p className="settings-form__error">Only owners and admins can invite or manage members.</p>
          <AccessWhyPopover requiredCaps={["workspace.members.manage"]} />
        </div>
      )}
      {showInternalProvision ? (
        <div className="settings-subsection">
          <div>
            <p className="settings-subsection__title">Internal employee provision (dev only)</p>
            <p className="settings-subsection__note">
              Create staff accounts without an external login. Email must end with @{INTERNAL_EMAIL_DOMAIN}.
            </p>
          </div>
          <div className="settings-form">
            <SettingsFormRow label="Full name" helper="Employee display name.">
              <SettingsTextField
                value={internalName}
                onChange={(event) => setInternalName(event.target.value)}
                placeholder="Name Surname"
              />
            </SettingsFormRow>
            <SettingsFormRow label="Internal email" helper={`Use an @${INTERNAL_EMAIL_DOMAIN} email.`}>
              <SettingsTextField
                value={internalEmail}
                onChange={(event) => setInternalEmail(event.target.value)}
                placeholder={`person@${INTERNAL_EMAIL_DOMAIN}`}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </SettingsFormRow>
            <SettingsFormRow label="Role preset" helper="Initial role assignment.">
              <select
                value={internalRole}
                onChange={(event) => setInternalRole(event.target.value)}
                disabled={internalLoading}
              >
                {INTERNAL_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsFormRow>
            <div className="settings-form__actions">
              <button
                type="button"
                className="settings-form__submit"
                onClick={handleInternalProvision}
                disabled={internalLoading}
              >
                {internalLoading ? "Provisioning..." : "Add internal employee"}
              </button>
              <div>
                {internalStatus && <p className="settings-form__status">{internalStatus}</p>}
                {internalError && <p className="settings-form__error">{internalError}</p>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {loading && <p>Loading members...</p>}
      {error && <p className="settings-form__error">{error}</p>}
      {memberActionStatus && <p className="settings-form__status">{memberActionStatus}</p>}
      {memberActionError && <p className="settings-form__error">{memberActionError}</p>}
      {!loading && !renderedMembers.length && (
        <div className="settings-placeholder">
          <p>No members yet.</p>
        </div>
      )}
      {renderedMembers.length > 0 && (
        <div className="settings-members-list">
          {renderedMembers.map((member) => {
            const isInvite = member.kind === "invite" || !member.userId;
            const isBusy = memberBusyId === member.id;
            const roleOptions =
              member.role === "owner" ? ROLE_OPTIONS : availableRoleOptions;
            const disableRoleChange = isInvite || isBusy || (!access.isOwner && member.role === "owner");
            return (
              <div key={member.id} className="settings-member-card">
                <div className="settings-member-card__info">
                  <p className="settings-member-card__name">
                    {member.userDisplayName || member.userEmail || "Workspace member"}
                  </p>
                  {member.userEmail && <p className="settings-member-card__email">{member.userEmail}</p>}
                  <div className="settings-member-card__meta">
                    <span>{member.role.toUpperCase()}</span>
                    {member.title && <span>{member.title}</span>}
                    {isInvite && <span>Invite</span>}
                  </div>
                </div>
                <div className="settings-member-card__actions">
                  <span className="settings-member-card__status">
                    {member.status ? `${member.status.charAt(0).toUpperCase()}${member.status.slice(1)}` : ""}
                  </span>
                  {canManageMembers ? (
                    <div className="settings-member-card__actionRow">
                      <select
                        value={member.role}
                        onChange={(event) => handleRoleChange(member, event.target.value)}
                        disabled={disableRoleChange}
                        className="settings-member-card__select"
                      >
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="settings-member-card__action settings-member-card__action--danger"
                        onClick={() => handleDeactivate(member)}
                        disabled={isInvite || isBusy}
                      >
                        Deactivate
                      </button>
                    </div>
                  ) : (
                    <AccessWhyPopover requiredCaps={["workspace.members.manage"]} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SettingsPane>
  );
}
