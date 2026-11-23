"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { classifyWorkspaceScope, normalizeAppRole, roleLabel, workspaceNameLabel, workspaceTypeLabel } from "@/lib/workspace/workspaceModel";

export default function WorkspacePageClient() {
  const router = useRouter();
  const { data, calendarStatus, mailStatus } = useWorkspaceData();

  const workspace = data?.activeWorkspace;
  const scope = classifyWorkspaceScope(workspace, data?.user?.email);
  const role = normalizeAppRole(data?.membership?.role, data?.user?.email, scope);

  const workspaceName = workspaceNameLabel(workspace, data?.user?.email);
  const workspaceType = workspaceTypeLabel(workspace, data?.user?.email);
  const slug = workspace?.slug || "active";

  const statusItems = useMemo(
    () => [
      { id: "mail", label: "Mail", ok: mailStatus === "connected", value: mailStatus === "connected" ? "Ready" : "Setup" },
      { id: "calendar", label: "Calendar", ok: calendarStatus === "ready", value: calendarStatus === "ready" ? "Ready" : "Setup" },
      { id: "orchestrator", label: "Orchestrator", ok: true, value: "Ready" },
    ],
    [mailStatus, calendarStatus]
  );

  return (
    <div className="orchestrateDashboard">
      <header className="orchestrateDashboard__header">
        <div>
          <p className="orchestrateDashboard__eyebrow">Desktop</p>
          <h1>{workspaceName}</h1>
          <p>Vision-2035 shell with calm setup states and supervised actions.</p>
        </div>
        <div className="ec-inline-row">
          <Badge variant={workspaceType === "Personal" ? "neutral" : "info"}>{workspaceType}</Badge>
          <Badge variant="info">{roleLabel(role)}</Badge>
        </div>
      </header>

      <section className="orchestrateDashboard__grid" aria-label="System status">
        {statusItems.map((item) => (
          <Card key={item.id} className="orchestrateStatusCard">
            <p>{item.label}</p>
            <strong>{item.value}</strong>
            <span data-ok={item.ok}>{item.ok ? "Healthy" : "Needs setup"}</span>
          </Card>
        ))}
      </section>

      <section className="orchestrateDashboard__columns">
        <Card className="orchestratePanelCard">
          <div className="orchestratePanelCard__head">
            <p>Open Program</p>
          </div>
          <div className="ec-inline-wrap">
            <Button size="sm" variant="secondary" onClick={() => router.push(`/w/${slug}/mail`)}>Mail</Button>
            <Button size="sm" variant="secondary" onClick={() => router.push(`/w/${slug}/calendar`)}>Calendar</Button>
            <Button size="sm" variant="secondary" onClick={() => router.push(`/w/${slug}/marketplace`)}>Marketplace</Button>
            <Button size="sm" variant="secondary" onClick={() => router.push(`/w/${slug}/build`)}>Build</Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
