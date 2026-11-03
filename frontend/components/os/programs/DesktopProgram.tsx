"use client";

import Link from "next/link";
import { CalendarDays, FileText, Mail, Puzzle, Settings, TerminalSquare, ListTodo } from "lucide-react";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { Badge, Card } from "@/components/os/primitives";
import { classifyWorkspaceScope, normalizeAppRole, roleLabel, workspaceNameLabel, workspaceTypeLabel } from "@/lib/workspace/workspaceModel";

const programs = [
  { id: "mail", label: "Mail", icon: Mail, route: "mail", detail: "Connect, triage, thread, draft, send" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, route: "calendar", detail: "Connect, agenda, create and update" },
  { id: "tasks", label: "Planner", icon: ListTodo, route: "planner", detail: "Action plans and supervised execution" },
  { id: "docs", label: "Docs", icon: FileText, route: "docs", detail: "Notion now, native docs later" },
  { id: "build", label: "Build", icon: TerminalSquare, route: "build", detail: "Coder, repo ops, extensions" },
  { id: "marketplace", label: "Marketplace", icon: Puzzle, route: "marketplace", detail: "Integrations, permissions, quick actions" },
  { id: "settings", label: "Settings", icon: Settings, route: "settings", detail: "User, workspace and policy" },
];

const recentContexts = [
  "Inbox: 3 threads pending owner reply",
  "Calendar: open slot tomorrow 11:00",
  "Build: PR draft pending review",
];

export default function DesktopProgram({ slug }: { slug: string }) {
  const { data, mailStatus, calendarStatus } = useWorkspaceData();
  const scope = classifyWorkspaceScope(data?.activeWorkspace, data?.user?.email);
  const role = normalizeAppRole(data?.membership?.role, data?.user?.email, scope);
  const roleDisplay = roleLabel(role);
  const workspaceType = workspaceTypeLabel(data?.activeWorkspace, data?.user?.email);
  const workspaceName = workspaceNameLabel(data?.activeWorkspace, data?.user?.email);

  return (
    <div className="ec-program-grid ec-desktop-grid">
      <Card>
        <p className="ec-overline">Desktop</p>
        <h1>{workspaceName}</h1>
        <p>Calm OS home with active tasks, recent contexts and pinned programs.</p>
        <div className="ec-inline-row">
          <Badge tone={workspaceType === "Personal" ? "neutral" : "accent"}>{workspaceType}</Badge>
          <Badge tone="accent">{roleDisplay}</Badge>
          <Badge tone={mailStatus === "connected" ? "accent" : "warning"}>{mailStatus === "connected" ? "Mail Ready" : "Mail Setup"}</Badge>
          <Badge tone={calendarStatus === "ready" ? "accent" : "warning"}>{calendarStatus === "ready" ? "Calendar Ready" : "Calendar Setup"}</Badge>
        </div>
      </Card>

      <div className="ec-grid-2">
        <Card>
          <p className="ec-overline">Pinned Apps</p>
          <div className="ec-program-icons">
            {programs.map((program) => {
              const Icon = program.icon;
              return (
                <Link key={program.id} href={`/w/${slug}/${program.route}`} className="ec-program-icon-link">
                  <span><Icon size={18} /></span>
                  <strong>{program.label}</strong>
                  <small>{program.detail}</small>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <p className="ec-overline">Active Tasks</p>
          <div className="ec-plain-list">
            <p>Confirm reply draft for procurement thread</p>
            <p>Create weekly leadership calendar block</p>
            <p>Publish GitHub integration permission update</p>
          </div>
          <p className="ec-overline">Recent Contexts</p>
          <div className="ec-plain-list">
            {recentContexts.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
