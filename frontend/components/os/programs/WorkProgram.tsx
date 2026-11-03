"use client";

import Link from "next/link";
import { CalendarDays, FileText, Mail, ListTodo } from "lucide-react";
import { Card } from "@/components/os/primitives";

const workApps = [
  {
    id: "mail",
    label: "Mail",
    summary: "Connect → Inbox → Thread → Suggest Reply → Send",
    route: "mail",
    icon: Mail,
  },
  {
    id: "calendar",
    label: "Calendar",
    summary: "Connect provider → Agenda → Create/Update event",
    route: "calendar",
    icon: CalendarDays,
  },
  {
    id: "docs",
    label: "Docs",
    summary: "Notion today, native docs later",
    route: "docs",
    icon: FileText,
  },
  {
    id: "tasks",
    label: "Planner",
    summary: "Today / Upcoming / Projects with orchestrator",
    route: "planner",
    icon: ListTodo,
  },
];

export default function WorkProgram({ slug }: { slug: string }) {
  return (
    <div className="ec-program-grid">
      <Card>
        <p className="ec-overline">Work</p>
        <h1>Communication & Operations</h1>
        <p>Mail and Calendar are designed for supervised, production-ready workflows.</p>
      </Card>
      <div className="ec-grid-2">
        {workApps.map((app) => {
          const Icon = app.icon;
          return (
            <Link key={app.id} href={`/w/${slug}/${app.route}`} className="ec-card ec-link-card">
              <div className="ec-inline-row">
                <span className="ec-dot"><Icon size={15} /></span>
                <strong>{app.label}</strong>
              </div>
              <p>{app.summary}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
