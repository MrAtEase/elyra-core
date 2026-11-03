import { apiClient } from "@/lib/api/client";
import { createDefaultLayout, isLayoutV1, type LayoutV1 } from "@/lib/os/layoutTypes";

const WINDOW_LAYOUT_PATH = "/v1/window-layout";

type LayoutResponse = {
  ok: boolean;
  layout: LayoutV1 | null;
  updatedAt: number | null;
};

function buildLayoutPath(workspaceId?: string | null): string {
  if (!workspaceId) {
    return WINDOW_LAYOUT_PATH;
  }
  const query = new URLSearchParams({ workspaceId });
  return `${WINDOW_LAYOUT_PATH}?${query.toString()}`;
}

export async function loadLayout(
  viewport?: { width: number; height: number },
  workspaceId?: string | null
): Promise<LayoutV1> {
  try {
    const response = await apiClient<LayoutResponse>(buildLayoutPath(workspaceId), { method: "GET" });
    if (response.layout && isLayoutV1(response.layout)) {
      return response.layout;
    }
  } catch {
    // Fallback to default layout when API is unavailable.
  }

  return createDefaultLayout(viewport);
}

export async function saveLayout(layout: LayoutV1, workspaceId?: string | null): Promise<void> {
  await apiClient(buildLayoutPath(workspaceId), {
    method: "PUT",
    body: JSON.stringify({ layout }),
  });
}

export function serializeLayout(layout: LayoutV1): string {
  return JSON.stringify(layout);
}

export function createDebouncedSave(
  saveFn: (layout: LayoutV1) => Promise<void>,
  delayMs = 700
): {
  schedule: (layout: LayoutV1) => void;
  cancel: () => void;
} {
  let timer: number | null = null;

  return {
    schedule(layout: LayoutV1) {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        void saveFn(layout);
      }, delayMs);
    },
    cancel() {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
