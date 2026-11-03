"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import { MODULE_REGISTRY, type ModuleStatus } from "@/components/modules/registry";
import { getWorkspaceAccess } from "@/components/workspace/admin/access";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { getWorkspaceMembersEndpoint, getWorkspaceModulesEndpoint } from "@/utils/auth-guard";

type ModuleStatusResponse = {
  id: string;
  status: ModuleStatus;
};

export default function WorkspaceAdminOverviewPage() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const isPersonalWorkspace = workspace?.type === "personal";

  const fallbackConnectedCount = useMemo(
    () => MODULE_REGISTRY.filter((module) => module.status === "connected").length,
    []
  );
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingModules, setLoadingModules] = useState(false);

  useEffect(() => {
    if (!workspace?.id || isPersonalWorkspace) {
      setMemberCount(null);
      return;
    }
    let canceled = false;
    setLoadingMembers(true);
    fetch(getWorkspaceMembersEndpoint(workspace.id), { credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json()) as Record<string, any>;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Unable to load members.");
        }
        if (!canceled) {
          const members = Array.isArray(payload.members) ? payload.members : [];
          setMemberCount(members.length);
        }
      })
      .catch(() => {
        if (!canceled) {
          setMemberCount(null);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingMembers(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [isPersonalWorkspace, workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) {
      setConnectedCount(null);
      return;
    }
    let canceled = false;
    setLoadingModules(true);
    fetch(getWorkspaceModulesEndpoint(workspace.id), { credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json()) as Record<string, any>;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Unable to load modules.");
        }
        if (!canceled && Array.isArray(payload.modules)) {
          const connected = (payload.modules as ModuleStatusResponse[]).filter(
            (entry) => entry?.status === "connected"
          ).length;
          setConnectedCount(connected);
        }
      })
      .catch(() => {
        if (!canceled) {
          setConnectedCount(null);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingModules(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [workspace?.id]);

  if (!workspace) {
    return (
      <SettingsPane
        eyebrow="Workspace Admin"
        title="Overview"
        description="Workspace summary and key actions."
        scope="WORKSPACE"
      >
        <div className="settings-placeholder">
          <p>No workspace selected.</p>
        </div>
      </SettingsPane>
    );
  }

  const resolvedMemberCount =
    memberCount ?? (isPersonalWorkspace ? 1 : data?.membership ? 1 : null);
  const resolvedConnectedCount = connectedCount ?? fallbackConnectedCount;
  const roleLabel = access.rawRole ? access.rawRole.toUpperCase() : "MEMBER";

  const shortcuts = [
    {
      id: "identity",
      label: "Identity",
      description: "Name, slug, branding, and logo.",
      path: "/workspace/admin/identity",
    },
    !isPersonalWorkspace
      ? {
          id: "members",
          label: "Members & Roles",
          description: "Invite and manage access.",
          path: "/workspace/admin/members",
        }
      : null,
    {
      id: "access",
      label: "Access",
      description: "Permissions and policies.",
      path: "/workspace/admin/access",
    },
    {
      id: "modules",
      label: "Modules",
      description: "Connected tools and status.",
      path: "/workspace/admin/modules",
    },
    {
      id: "behavior",
      label: "Behavior",
      description: "Automation and policies.",
      path: "/workspace/admin/behavior",
    },
    access.isOwner
      ? {
          id: "danger",
          label: "Danger Zone",
          description: "Delete workspace and account.",
          path: "/workspace/admin/danger",
        }
      : null,
  ].filter(Boolean) as Array<{ id: string; label: string; description: string; path: string }>;

  return (
    <SettingsPane
      eyebrow="Workspace Admin"
      title="Overview"
      description="Workspace summary and key actions."
      scope="WORKSPACE"
    >
      <div className="settings-details-grid">
        <div>
          <p className="settings-details-grid__label">Workspace</p>
          <p>{workspace.name}</p>
        </div>
        <div>
          <p className="settings-details-grid__label">Slug</p>
          <p>{workspace.slug}</p>
        </div>
        <div>
          <p className="settings-details-grid__label">Type</p>
          <p>{workspace.type}</p>
        </div>
        <div>
          <p className="settings-details-grid__label">Members</p>
          <p>{loadingMembers ? "Loading..." : resolvedMemberCount ?? "N/A"}</p>
        </div>
        <div>
          <p className="settings-details-grid__label">Connected Modules</p>
          <p>{loadingModules ? "Loading..." : resolvedConnectedCount}</p>
        </div>
        <div>
          <p className="settings-details-grid__label">Your Role</p>
          <p>{roleLabel}</p>
        </div>
      </div>
      <div className="settings-overview__grid">
        {shortcuts.map((item) => (
          <Link key={item.id} href={item.path} className="settings-card" aria-label={`Open ${item.label}`}>
            <div>
              <p className="settings-card__label">{item.label}</p>
              <h3>{item.label}</h3>
              <p className="settings-card__description">{item.description}</p>
            </div>
            <span className="settings-card__cta">Open</span>
          </Link>
        ))}
      </div>
    </SettingsPane>
  );
}
