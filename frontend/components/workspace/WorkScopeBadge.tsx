"use client";

import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

const getWorkspaceName = (value?: string | null, fallback?: string | null) => {
  const primary = (value || "").trim();
  if (primary) return primary;
  const secondary = (fallback || "").trim();
  return secondary || "Workspace";
};

const resolveWorkspaceTypeLabel = (value?: string | null) => {
  const normalized = (value || "").toString().trim().toLowerCase();
  return normalized === "personal" ? "Personal" : "Company";
};

export default function WorkScopeBadge() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  if (!workspace) return null;
  const name = getWorkspaceName(workspace.name, workspace.brand?.workspaceLabel);
  const typeLabel = resolveWorkspaceTypeLabel(workspace.type);
  const typeKey = typeLabel.toLowerCase();

  return (
    <div className="workspace-main-panel__scope" aria-label="Workspace scope">
      <span className="workspace-main-panel__scope-label">Scope: {name}</span>
      <span className="workspace-main-panel__scope-type" data-type={typeKey}>
        {typeLabel}
      </span>
    </div>
  );
}
