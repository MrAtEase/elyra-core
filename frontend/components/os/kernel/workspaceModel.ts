import type { Workspace } from "@/components/os/kernel/types";

export const WORKSPACES: Workspace[] = [
  {
    id: "ws-personal",
    label: "Person",
    kind: "individual",
    accent: "#a78bfa",
  },
  {
    id: "ws-elyra-core",
    label: "Elyra Core",
    kind: "platform",
    accent: "#6C9CFC",
  },
  {
    id: "ws-fish-delish",
    label: "Fish Delish",
    kind: "organization",
    accent: "#f97316",
  },
];

export function getWorkspace(workspaceId: string): Workspace {
  return WORKSPACES.find((ws) => ws.id === workspaceId) ?? WORKSPACES[0]!;
}
