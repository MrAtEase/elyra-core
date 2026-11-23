"use client";

import TeamPanel from "@/components/os/apps/settings/TeamPanel";

/** "Team & Rechte": members, roles and invitations of the active workspace. */
export default function AdminSettingsWindow({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <TeamPanel workspaceId={workspaceId} />
    </div>
  );
}
