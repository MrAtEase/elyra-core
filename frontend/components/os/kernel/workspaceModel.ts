import { useSyncExternalStore } from "react";
import type { Workspace } from "@/components/os/kernel/types";

/**
 * Built-in workspace slots. The server decides which of them a user actually has:
 * - "ws-personal"   → the user's own personal workspace
 * - "ws-elyra-core" → the system workspace, platform owner only
 * Company workspaces are added with their real id and name (see buildVisibleWorkspaces).
 */
export const WORKSPACES: Workspace[] = [
  { id: "ws-personal", label: "Persönlich", kind: "individual", accent: "#a78bfa" },
  { id: "ws-elyra-core", label: "Elyra Core", kind: "platform", accent: "#6C9CFC" },
];

const PERSONAL = WORKSPACES[0]!;
const SYSTEM = WORKSPACES[1]!;
const COMPANY_ACCENTS = ["#f97316", "#14b8a6", "#e879f9", "#facc15"];

type ServerWorkspace = { id?: string | null; slug?: string | null; type?: string | null; name?: string | null };

/** Turns the workspaces the server returned for this user into the switcher list. */
export function buildVisibleWorkspaces(server: ServerWorkspace[] | null | undefined): Workspace[] {
  const list: Workspace[] = [];
  let companyIndex = 0;
  for (const ws of server ?? []) {
    const type = (ws.type ?? "").toLowerCase();
    const name = (ws.name ?? "").trim();
    if (type === "personal" || type === "individual") {
      if (!list.some((w) => w.id === PERSONAL.id)) {
        list.push({ ...PERSONAL, label: name && name !== "Personal" ? name : PERSONAL.label });
      }
    } else if (type === "system_platform") {
      if (ws.slug === SYSTEM.id && !list.some((w) => w.id === SYSTEM.id)) list.push(SYSTEM);
    } else if (ws.id) {
      list.push({
        id: ws.id,
        label: name || ws.slug || "Workspace",
        kind: "organization",
        accent: COMPANY_ACCENTS[companyIndex++ % COMPANY_ACCENTS.length]!,
      });
    }
  }
  if (!list.some((w) => w.id === PERSONAL.id)) list.unshift(PERSONAL);
  // Order: personal first, then companies, the system workspace last.
  const rank = (w: Workspace) => (w.kind === "individual" ? 0 : w.kind === "platform" ? 2 : 1);
  return list.sort((a, b) => rank(a) - rank(b));
}

// Small store so every part of the shell shows the same, server-backed list.
let visible: Workspace[] = [PERSONAL];
const listeners = new Set<() => void>();

export function setVisibleWorkspaces(next: Workspace[]): void {
  const same =
    next.length === visible.length && next.every((w, i) => w.id === visible[i]?.id && w.label === visible[i]?.label);
  if (same) return;
  visible = next;
  listeners.forEach((listener) => listener());
}

export function getVisibleWorkspaces(): Workspace[] {
  return visible;
}

export function useVisibleWorkspaces(): Workspace[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visible,
    () => visible,
  );
}

export function getWorkspace(workspaceId: string): Workspace {
  return visible.find((ws) => ws.id === workspaceId) ?? WORKSPACES.find((ws) => ws.id === workspaceId) ?? visible[0] ?? PERSONAL;
}

// Whether the signed-in user operates this instance (controls owner-only apps like Code).
// UI hint only: the server enforces the same rule on every owner-only route.
let platformOwner = false;
const ownerListeners = new Set<() => void>();

export function setPlatformOwner(next: boolean): void {
  if (next === platformOwner) return;
  platformOwner = next;
  ownerListeners.forEach((listener) => listener());
}

export function usePlatformOwner(): boolean {
  return useSyncExternalStore(
    (listener) => {
      ownerListeners.add(listener);
      return () => ownerListeners.delete(listener);
    },
    () => platformOwner,
    () => platformOwner,
  );
}
