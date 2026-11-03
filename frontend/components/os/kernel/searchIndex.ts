import type { SearchItem, WorkspaceKind } from "@/components/os/kernel/types";

const BASE_DATA: SearchItem[] = [
  {
    id: "mail-1",
    workspaceId: "elyra-core",
    appId: "mail",
    type: "mail",
    title: "Dinner with Ana this Friday",
    body: "Can we move to 20:00?",
    timestamp: Date.now() - 1000 * 60 * 60,
  },
  {
    id: "event-1",
    workspaceId: "elyra-core",
    appId: "calendar",
    type: "event",
    title: "Supplier sync — Thursday 11:00",
    body: "Cold-chain and route updates",
    timestamp: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    id: "task-1",
    workspaceId: "elyra-core",
    appId: "tasks",
    type: "task",
    title: "Finalize policy resolver contract",
    body: "Ship review doc before Friday",
    timestamp: Date.now() - 1000 * 60 * 40,
  },
  {
    id: "file-1",
    workspaceId: "elyra-core",
    appId: "files",
    type: "file",
    title: "Pricing-Model-Q2.xlsx",
    body: "Draft margin scenarios",
    timestamp: Date.now() - 1000 * 60 * 15,
  },
];

export function querySearchIndex(
  workspaceId: string,
  query: string,
  workspaceKind: WorkspaceKind
): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const allowUnified = workspaceKind === "platform";
  return BASE_DATA.filter((item) => {
    if (!allowUnified && item.workspaceId !== workspaceId) {
      return false;
    }
    const blob = `${item.title} ${item.body ?? ""}`.toLowerCase();
    return blob.includes(q);
  }).slice(0, 6);
}
