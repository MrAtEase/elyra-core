export type WindowType = "runs" | "approvals" | "files" | "admin" | "settings";

export type OSWindow = {
  id: string;
  type: WindowType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
};

export type LayoutV1 = {
  version: 1;
  windows: OSWindow[];
};

const RUNS_DEFAULT_WIDTH = 920;
const RUNS_DEFAULT_HEIGHT = 560;

export function createDefaultLayout(viewport?: { width: number; height: number }): LayoutV1 {
  const width = viewport?.width ?? 1280;
  const height = viewport?.height ?? 760;
  const w = Math.min(RUNS_DEFAULT_WIDTH, Math.max(540, width - 80));
  const h = Math.min(RUNS_DEFAULT_HEIGHT, Math.max(360, height - 180));

  return {
    version: 1,
    windows: [
      {
        id: "runs",
        type: "runs",
        title: "Runs",
        x: Math.max(24, Math.round((width - w) / 2)),
        y: Math.max(72, Math.round((height - h) / 2) - 24),
        w,
        h,
        z: 1,
        minimized: false,
      },
    ],
  };
}

export function isLayoutV1(value: unknown): value is LayoutV1 {
  if (!value || typeof value !== "object") return false;
  const layout = value as Record<string, unknown>;
  return layout.version === 1 && Array.isArray(layout.windows);
}
