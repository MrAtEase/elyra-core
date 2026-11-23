"use client";

import Link from "next/link";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { Badge, Card } from "@/components/os/primitives";
import {
  canAccessSystemPlatform,
  classifyWorkspaceScope,
  normalizeAppRole,
  roleLabel,
  scopeLabel,
  workspaceNameLabel,
  workspaceTypeLabel,
} from "@/lib/workspace/workspaceModel";

export default function SettingsProgram() {
  const { data } = useWorkspaceData();
  const scope = classifyWorkspaceScope(data?.activeWorkspace, data?.user?.email);
  const role = normalizeAppRole(data?.membership?.role, data?.user?.email, scope);
  const roleDisplay = roleLabel(role);
  const workspaceType = workspaceTypeLabel(data?.activeWorkspace, data?.user?.email);
  const workspaceName = workspaceNameLabel(data?.activeWorkspace, data?.user?.email);

  return (
    <div className="ec-program-grid">
      <Card>
        <p className="ec-overline">Identity</p>
        <h1>{workspaceName}</h1>
        <div className="ec-inline-row">
          <Badge tone={workspaceType === "Personal" ? "neutral" : "accent"}>{workspaceType}</Badge>
          <Badge tone="accent">{roleDisplay}</Badge>
          <Badge>{scopeLabel(scope)}</Badge>
        </div>
        <p>User: {data?.user?.email ?? "Unknown"}</p>
      </Card>

      <Card>
        <p className="ec-overline">User</p>
        <p>Language, appearance, privacy and account.</p>
        <Link href="/workspace/settings/user" className="ec-link-inline">Open user settings</Link>
      </Card>

      <Card>
        <p className="ec-overline">Workspace</p>
        <p>Members, modules, integration permissions and behavior policies.</p>
        <Link href="/workspace/settings/workspace" className="ec-link-inline">Open workspace settings</Link>
      </Card>

      {canAccessSystemPlatform(role) ? (
        <Card>
          <p className="ec-overline">System Platform</p>
          <p>Owner-only controls remain hidden from primary nav and are available via profile menu.</p>
          <Link href="/system" className="ec-link-inline">Open /system</Link>
        </Card>
      ) : null}
    </div>
  );
}
