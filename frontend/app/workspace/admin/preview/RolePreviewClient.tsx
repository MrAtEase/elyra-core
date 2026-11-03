"use client";

import Link from "next/link";
import { useState } from "react";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import { getWorkspaceAccess } from "@/components/workspace/admin/access";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

const ROLE_PREVIEW_OPTIONS = [
  {
    id: "current",
    label: "Your view",
    summary: "Experience the workspace exactly as you do today.",
    insights: [
      { label: "Focus", value: "Strategy, planning, and trusted automation aligned to your tasks." },
      { label: "Energy", value: "Steady · recovery windows protected for long-form work." },
      { label: "Risk", value: "Balanced signals; manual oversight still in the loop." },
    ],
    note: "No filters applied. You see the full suite of actions tied to your permissions.",
  },
  {
    id: "staff",
    label: "Staff view",
    summary: "See what staff on the floor encounter—priorities, blockers, and energy insights.",
    insights: [
      { label: "Focus", value: "Service handoffs, coverage swaps, and delivery pacing." },
      { label: "Energy", value: "Steady but tight around peak service windows." },
      { label: "Risk", value: "Shift coverage and vendor replies are time-compressed." },
    ],
    note: "Merlin highlights operational work while hiding builder tools and admin actions.",
  },
  {
    id: "sales",
    label: "Sales view",
    summary: "Highlight revenue work: pipeline, meetings, and investor readiness.",
    insights: [
      { label: "Focus", value: "Deals, vendor renewals, and investor alignment." },
      { label: "Energy", value: "Overloaded · demos and syncs back-to-back." },
      { label: "Risk", value: "Follow-ups must land before pipeline slides out." },
    ],
    note: "This lens elevates high-stakes communications while keeping service noise low.",
  },
] as const;

type RolePreviewId = (typeof ROLE_PREVIEW_OPTIONS)[number]["id"];

export default function RolePreviewClient() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);

  const [activeRole, setActiveRole] = useState<RolePreviewId>(ROLE_PREVIEW_OPTIONS[0].id);

  const activeOption =
    ROLE_PREVIEW_OPTIONS.find((option) => option.id === activeRole) ?? ROLE_PREVIEW_OPTIONS[0];

  if (!workspace) {
    return (
      <SettingsPane
        eyebrow="Workspace Admin"
        title="Role preview"
        description="Simulate workspace experiences."
        scope="WORKSPACE"
      >
        <div className="role-preview__locked">
          <p>No workspace selected.</p>
        </div>
      </SettingsPane>
    );
  }

  if (!access.isAdminOrOwner) {
    return (
      <SettingsPane
        eyebrow="Workspace Admin"
        title="Role preview"
        description="Simulate workspace experiences."
        scope="WORKSPACE"
      >
        <div className="role-preview__locked">
          <p>Role preview is reserved for workspace owners and admins.</p>
          <p>Ask an owner to continue.</p>
        </div>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane
      eyebrow="Workspace Admin"
      title="Role preview"
      description="Simulate how different roles encounter Merlin without changing data."
      scope="WORKSPACE"
    >
      <div className="role-preview__controls" role="tablist" aria-label="Role preview options">
        {ROLE_PREVIEW_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`role-preview__option ${option.id === activeRole ? "is-active" : ""}`}
            onClick={() => setActiveRole(option.id)}
            aria-pressed={option.id === activeRole}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="role-preview__intro">
        Toggle a role to see how Merlin surfaces Focus, Energy, and Risk signals for that perspective.
      </p>

      <div className="role-preview__insights">
        {activeOption.insights.map((insight) => (
          <div key={insight.label} className="role-preview__insight">
            <span className="role-preview__insightLabel">{insight.label}</span>
            <span className="role-preview__insightValue">{insight.value}</span>
          </div>
        ))}
      </div>

      {activeOption.note ? <p className="role-preview__note">{activeOption.note}</p> : null}

      <div className="role-preview__actions">
        <Link className="role-preview__action" href="/workspace/admin/members">
          Review roles &amp; permissions
        </Link>
        <p className="role-preview__action role-preview__action--muted">
          Role preview is read-only and scoped to this workspace.
        </p>
      </div>
    </SettingsPane>
  );
}