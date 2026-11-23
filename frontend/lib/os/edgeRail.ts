const EDGE_RAIL_KEY_PREFIX = "elyra:edge-rail-order:";

function keyForWorkspace(workspaceId: string): string {
  return `${EDGE_RAIL_KEY_PREFIX}${workspaceId}`;
}

export function loadEdgeRailOrder(workspaceId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyForWorkspace(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function saveEdgeRailOrder(workspaceId: string, order: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyForWorkspace(workspaceId), JSON.stringify(order));
  } catch {
    // Ignore localStorage failures (private mode / quota).
  }
}

export function reorderEdgeRailIds(order: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return order;
  const withoutDragged = order.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex < 0) return [...withoutDragged, draggedId];
  const next = [...withoutDragged];
  next.splice(targetIndex, 0, draggedId);
  return next;
}
