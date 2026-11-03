"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import SettingsScopeBadge from "@/components/merlin/settings/SettingsScopeBadge";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

import { getWorkspaceAccess } from "./access";

const OVERVIEW_PATH = "/workspace/admin";

const NAV_ITEMS = [
  {
    id: "identity",
    label: "Identity",
    description: "Workspace name, slug, branding.",
    path: "/workspace/admin/identity",
  },
  {
    id: "members",
    label: "Members & Roles",
    description: "People, permissions, invites.",
    path: "/workspace/admin/members",
  },
  {
    id: "access",
    label: "Access",
    description: "Permissions and policy controls.",
    path: "/workspace/admin/access",
  },
  {
    id: "modules",
    label: "Modules & Integrations",
    description: "Connected services and status.",
    path: "/workspace/admin/modules",
  },
  {
    id: "behavior",
    label: "Behavior",
    description: "Automation and policy controls.",
    path: "/workspace/admin/behavior",
  },
  {
    id: "preview",
    label: "Role preview",
    description: "Simulate workspace roles safely.",
    path: "/workspace/admin/preview",
  },
];

function isActivePath(pathname: string, target: string) {
  return pathname === target || pathname === `${target}/` || pathname.startsWith(`${target}/`);
}

export default function WorkspaceAdminNav() {
  const pathname = usePathname() ?? "";
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const overviewActive = isActivePath(pathname, OVERVIEW_PATH);
  const isPersonalWorkspace = workspace?.type === "personal";
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.id === "members" && isPersonalWorkspace) {
      return false;
    }
    if (item.id === "preview" && !access.isAdminOrOwner) {
      return false;
    }
    return true;
  });
  const dangerActive = isActivePath(pathname, "/workspace/admin/danger");

  return (
    <nav className="settings-nav workspace-admin-nav" aria-label="Workspace admin">
      <Link className={`settings-nav__overview ${overviewActive ? "is-active" : ""}`} href={OVERVIEW_PATH}>
        <span>Overview</span>
        <small>Workspace admin overview</small>
      </Link>

      <div className="settings-nav__section">
        <div className="settings-nav__section-head">
          <SettingsScopeBadge scope="WORKSPACE" variant="nav" />
          <div>
            <p className="settings-nav__section-title">Workspace Admin</p>
            <p className="settings-nav__section-description">Identity, members, modules, and behavior.</p>
          </div>
        </div>
        <div className="settings-nav__items workspace-admin-nav__items">
          {visibleItems.map((item) => {
            const active = isActivePath(pathname, item.path);
            return (
              <Link
                key={item.id}
                href={item.path}
                className={`settings-nav__item ${active ? "is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
              </Link>
            );
          })}
        </div>
      </div>

      {access.isOwner ? (
        <div className="workspace-admin-nav__footer">
          <Link
            href="/workspace/admin/danger"
            className={`settings-nav__item workspace-admin-nav__danger ${dangerActive ? "is-active" : ""}`}
            aria-current={dangerActive ? "page" : undefined}
          >
            <span>Danger Zone</span>
            <small>Permanent, destructive actions.</small>
          </Link>
        </div>
      ) : null}
    </nav>
  );
}
