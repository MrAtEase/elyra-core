"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

export default function WorkspaceRouteSync() {
  const pathname = usePathname();
  const { data, setActiveWorkspace } = useWorkspaceData();

  useEffect(() => {
    if (!pathname?.startsWith("/w/")) return;
    const routeWorkspace = pathname.split("/")[2] ?? "";
    if (!routeWorkspace || routeWorkspace === "active") return;

    const normalized = normalizeWorkspaceId(routeWorkspace) ?? routeWorkspace;
    const activeWorkspaceId = data?.activeWorkspace?.id ?? null;
    if (activeWorkspaceId === normalized) return;

    const candidate = (data?.workspaces ?? []).find(
      (workspace) => workspace.id === normalized || workspace.slug === routeWorkspace
    );
    if (!candidate?.id || candidate.id === activeWorkspaceId) return;
    void setActiveWorkspace(candidate.id);
  }, [pathname, data?.activeWorkspace?.id, data?.workspaces, setActiveWorkspace]);

  return null;
}

