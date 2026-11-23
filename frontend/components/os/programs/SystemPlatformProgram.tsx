"use client";

import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { Badge, Card, EmptyState } from "@/components/os/primitives";
import { canAccessSystemPlatform, classifyWorkspaceScope, normalizeAppRole } from "@/lib/workspace/workspaceModel";

const blocks = [
  { id: "directory", title: "Org / Workspace Directory", text: "Global list of tenants and ownership mapping." },
  { id: "users", title: "User Management", text: "Invite users, assign roles, and enforce access." },
  { id: "policies", title: "Policies", text: "Data handling, connector, and security policies." },
  { id: "billing", title: "Billing / Plans", text: "Plan assignment and invoices (stub)." },
  { id: "audit", title: "Audit & Logs", text: "System-level actions and execution logs (stub)." },
];

export default function SystemPlatformProgram() {
  const { data } = useWorkspaceData();
  const scope = classifyWorkspaceScope(data?.activeWorkspace, data?.user?.email);
  const role = normalizeAppRole(data?.membership?.role, data?.user?.email, scope);

  if (!canAccessSystemPlatform(role)) {
    return <EmptyState title="Restricted" text="System Platform is available only for system owners." />;
  }

  return (
    <div className="ec-program-grid">
      <Card>
        <p className="ec-overline">System Platform</p>
        <h1>Master Account Controls</h1>
        <p>Business / Founder owner scope for Elyra Core platform governance.</p>
        <div className="ec-inline-row">
          <Badge tone="warning">system_owner</Badge>
          <Badge>Route: /system</Badge>
        </div>
      </Card>
      <div className="ec-grid-2">
        {blocks.map((block) => (
          <Card key={block.id}>
            <strong>{block.title}</strong>
            <p>{block.text}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
