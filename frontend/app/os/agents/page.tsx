import { Suspense } from "react";
import AgentTeamWindow from "@/components/os/apps/agent-team/AgentTeamWindow";

export default function OsAgentsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/30">Lade Agenten-Team…</div>}>
      <AgentTeamWindow />
    </Suspense>
  );
}
