"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureSupabaseToken } from "@/lib/supabase/browser";

type GraphNode = {
  id: string;
  kind: string;
  label: string;
  score: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphEdge = {
  srcId: string;
  dstId: string;
  rel: string;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type GraphNodeDraft = {
  label: string;
  kind: string;
  score: string;
};

const AI_CONTROL_ACTIONS = [
  {
    id: "analyze-visual",
    label: "Analyze Screenshot",
    detail: "Open Code with a multimodal review task.",
    run: () => {
      window.localStorage.setItem("elyra_ai_task_queue", JSON.stringify({
        skill: "custom",
        task: "Analyze the uploaded screenshots or visual assets, identify UI issues, and prepare an implementation plan with concrete fixes.",
      }));
      window.location.assign("/os/code");
    },
  },
  {
    id: "image-video-brief",
    label: "Image / Video Brief",
    detail: "Open Code with a creative generation brief workflow.",
    run: () => {
      window.localStorage.setItem("elyra_ai_task_queue", JSON.stringify({
        skill: "custom",
        task: "Create image and video generation briefs, prompts, shot lists, and asset requirements for the active project.",
      }));
      window.location.assign("/os/code");
    },
  },
  {
    id: "build-process",
    label: "Build Process",
    detail: "Open Builder with an imported quickstart workflow.",
    run: () => {
      window.localStorage.setItem("elyra_builder_quickstart", JSON.stringify({
        title: "Graph-driven AI Process",
        description: "Imported from Graph AI controls",
      }));
      window.location.assign("/os/builder");
    },
  },
  {
    id: "plan-week",
    label: "Plan My Week",
    detail: "Jump into Calendar to organize the week.",
    run: () => window.location.assign("/os/calendar"),
  },
];

const KIND_COLORS: Record<string, string> = {
  user: "#60a5fa",
  workspace: "#a78bfa",
  intent: "#34d399",
  artifact: "#fbbf24",
  app: "#f472b6",
  topic: "#fb923c",
  location: "#22d3ee",
  run: "#94a3b8",
};

const KIND_RADIUS: Record<string, number> = {
  user: 18,
  workspace: 20,
  intent: 10,
  artifact: 12,
  app: 14,
  topic: 10,
  run: 6,
};

type GraphAppProps = {
  workspaceId: string;
  accent?: string;
};

const LOCAL_STORAGE_KEY_PREFIX = "elyra:graph:edits:";

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;
  if (expanded.length !== 6) return `rgba(148, 163, 184, ${alpha})`;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return `rgba(148, 163, 184, ${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toDraft(node: GraphNode | null): GraphNodeDraft {
  if (!node) {
    return {
      label: "",
      kind: "",
      score: "0",
    };
  }

  return {
    label: node.label,
    kind: node.kind,
    score: String(node.score),
  };
}

function loadPersistedEdits(workspaceId: string): Record<string, Partial<GraphNode>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${workspaceId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, Partial<GraphNode>>;
  } catch {
    return {};
  }
}

function persistEdits(workspaceId: string, edits: Record<string, Partial<GraphNode>>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${workspaceId}`, JSON.stringify(edits));
  } catch {
    // Ignore storage failures and keep the in-memory graph responsive.
  }
}

export default function GraphApp({ workspaceId, accent = "#60a5fa" }: GraphAppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animationRef = useRef<number>(0);

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [persistedEdits, setPersistedEdits] = useState<Record<string, Partial<GraphNode>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GraphNodeDraft>(toDraft(null));
  const [editMode, setEditMode] = useState(false);

  const applyNodePatch = useCallback((nodeId: string, patch: Partial<GraphNode>) => {
    setGraph((current) => {
      if (!current) return current;
      const nextNodes = current.nodes.map((node) => (
        node.id === nodeId
          ? { ...node, ...patch }
          : node
      ));
      nodesRef.current = nextNodes;
      return {
        ...current,
        nodes: nextNodes,
      };
    });
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    const canvas = canvasRef.current;
    const width = canvas?.clientWidth ?? 800;
    const height = canvas?.clientHeight ?? 520;
    applyNodePatch(nodeId, {
      x: width / 2,
      y: height / 2,
      vx: 0,
      vy: 0,
    });
    setSelectedNodeId(nodeId);
    setEditMode(false);
  }, [applyNodePatch]);

  useEffect(() => {
    setPersistedEdits(loadPersistedEdits(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const token = await ensureSupabaseToken();
        const base = process.env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:8788";
        const response = await fetch(
          `${base}/v1/graph/summary?workspaceId=${encodeURIComponent(workspaceId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = (await response.json()) as {
          nodes?: Array<Record<string, unknown>>;
          edges?: Array<Record<string, unknown>>;
        };

        if (cancelled) return;

        const localEdits = loadPersistedEdits(workspaceId);
        const nodes: GraphNode[] = (json.nodes ?? []).map((node) => {
          const id = String(node.id ?? "");
          const patch = localEdits[id] ?? {};
          return {
            id,
            kind: String(patch.kind ?? node.kind ?? "unknown"),
            label: String(patch.label ?? node.label ?? "").slice(0, 40),
            score: typeof patch.score === "number"
              ? patch.score
              : typeof node.score === "number"
                ? node.score
                : 0,
            x: 400 + (Math.random() - 0.5) * 300,
            y: 250 + (Math.random() - 0.5) * 220,
            vx: 0,
            vy: 0,
          };
        });

        const edges: GraphEdge[] = (json.edges ?? []).map((edge) => ({
          srcId: String(edge.src_id ?? edge.srcId ?? ""),
          dstId: String(edge.dst_id ?? edge.dstId ?? ""),
          rel: String(edge.rel ?? ""),
        }));

        nodesRef.current = nodes;
        edgesRef.current = edges;
        setPersistedEdits(localEdits);
        setGraph({ nodes, edges });
        setSelectedNodeId((current) => current ?? nodes[0]?.id ?? null);
        setLoading(false);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load graph");
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const selectedNode = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );

  useEffect(() => {
    setDraft(toDraft(selectedNode));
  }, [selectedNode]);

  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    const term = search.trim().toLowerCase();
    if (!term) return graph.nodes;
    return graph.nodes.filter((node) => (
      node.label.toLowerCase().includes(term) ||
      node.kind.toLowerCase().includes(term) ||
      node.id.toLowerCase().includes(term)
    ));
  }, [graph, search]);

  const matchIds = useMemo(
    () => (search.trim() ? new Set(filteredNodes.map((node) => node.id)) : new Set<string>()),
    [filteredNodes, search]
  );

  const saveDraft = useCallback(() => {
    if (!selectedNode) return;
    const score = Number(draft.score);
    const normalizedPatch: Partial<GraphNode> = {
      label: draft.label.trim().slice(0, 40) || selectedNode.label,
      kind: draft.kind.trim() || selectedNode.kind,
      score: Number.isFinite(score) ? score : selectedNode.score,
    };
    applyNodePatch(selectedNode.id, normalizedPatch);
    setPersistedEdits((current) => {
      const next = {
        ...current,
        [selectedNode.id]: {
          ...(current[selectedNode.id] ?? {}),
          ...normalizedPatch,
        },
      };
      persistEdits(workspaceId, next);
      return next;
    });
    setEditMode(false);
  }, [applyNodePatch, draft, selectedNode, workspaceId]);

  useEffect(() => {
    if (!graph || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    const nodeMap = new Map<string, GraphNode>();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const tick = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const activeSearch = search.trim().toLowerCase();

      nodeMap.clear();
      for (const node of nodes) nodeMap.set(node.id, node);

      for (const node of nodes) {
        node.vx += (width / 2 - node.x) * 0.001;
        node.vy += (height / 2 - node.y) * 0.001;
      }

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 800 / (dist * dist);
          dx = (dx / dist) * force;
          dy = (dy / dist) * force;
          a.vx -= dx;
          a.vy -= dy;
          b.vx += dx;
          b.vy += dy;
        }
      }

      for (const edge of edges) {
        const src = nodeMap.get(edge.srcId);
        const dst = nodeMap.get(edge.dstId);
        if (!src || !dst) continue;

        const dx = dst.x - src.x;
        const dy = dst.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.005;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        src.vx += fx;
        src.vy += fy;
        dst.vx -= fx;
        dst.vy -= fy;
      }

      for (const node of nodes) {
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(28, Math.min(width - 28, node.x));
        node.y = Math.max(28, Math.min(height - 28, node.y));
      }

      context.clearRect(0, 0, width, height);

      context.lineWidth = 0.6;
      context.strokeStyle = "rgba(255,255,255,0.12)";
      for (const edge of edges) {
        const src = nodeMap.get(edge.srcId);
        const dst = nodeMap.get(edge.dstId);
        if (!src || !dst) continue;
        context.beginPath();
        context.moveTo(src.x, src.y);
        context.lineTo(dst.x, dst.y);
        context.stroke();
      }

      for (const node of nodes) {
        const radius = KIND_RADIUS[node.kind] ?? 8;
        const color = KIND_COLORS[node.kind] ?? "#94a3b8";
        const isSelected = node.id === selectedNodeId;
        const isMatch = !activeSearch || node.label.toLowerCase().includes(activeSearch) || node.kind.toLowerCase().includes(activeSearch);

        context.beginPath();
        context.arc(node.x, node.y, radius + (isSelected ? 6 : 3), 0, Math.PI * 2);
        context.fillStyle = isSelected
          ? withAlpha(accent, 0.28)
          : isMatch
            ? withAlpha(color, 0.24)
            : withAlpha(color, 0.12);
        context.fill();

        context.beginPath();
        context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();

        context.fillStyle = isSelected ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.72)";
        context.font = isSelected ? "600 10px system-ui" : "10px system-ui";
        context.textAlign = "center";
        context.fillText(node.label, node.x, node.y + radius + 13);
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationRef.current);
      resizeObserver.disconnect();
    };
  }, [accent, graph, search, selectedNodeId]);

  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const closest = nodesRef.current
      .map((node) => {
        const radius = KIND_RADIUS[node.kind] ?? 8;
        const distance = Math.hypot(node.x - x, node.y - y);
        return { node, distance, hitRadius: radius + 10 };
      })
      .filter((entry) => entry.distance <= entry.hitRadius)
      .sort((left, right) => left.distance - right.distance)[0];

    if (!closest) return;
    focusNode(closest.node.id);
  }, [focusNode]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/45">
        Loading knowledge graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rose-300/70">
        Graph error: {error}
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
        <p className="text-sm">No knowledge graph data yet.</p>
        <p className="text-xs">Use Elli to create intents and the graph will grow.</p>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="relative min-h-[320px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/30 px-3 py-2 backdrop-blur-xl">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search nodes..."
            className="h-9 min-w-[13rem] flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/45"
          />
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-white/60">
            {graph.nodes.length} nodes
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-white/60">
            {graph.edges.length} edges
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className="h-full w-full pt-14"
          onClick={handleCanvasClick}
        />

        <div className="absolute bottom-3 left-3 right-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[10px] text-white/60 backdrop-blur-xl">
            Click a node to inspect it. Search highlights matches and the result list jumps the graph to that node.
          </div>
          <div
            className="relative h-24 overflow-hidden rounded-xl border border-white/10 bg-black/30 px-2 py-2 backdrop-blur-xl"
            style={{ boxShadow: `0 0 0 1px ${withAlpha(accent, 0.18)} inset` }}
          >
            {graph.nodes.map((node) => {
              const left = `${Math.max(4, Math.min(92, (node.x / 800) * 100))}%`;
              const top = `${Math.max(6, Math.min(86, (node.y / 520) * 100))}%`;
              const showLabel = node.id === selectedNodeId || matchIds.has(node.id);
              return (
                <button
                  key={node.id}
                  type="button"
                  title={node.label}
                  onClick={() => focusNode(node.id)}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left,
                    top,
                    background: node.id === selectedNodeId ? accent : (KIND_COLORS[node.kind] ?? "#94a3b8"),
                    boxShadow: node.id === selectedNodeId ? `0 0 0 2px ${withAlpha(accent, 0.24)}` : "none",
                  }}
                >
                  {showLabel ? (
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-black/70 px-1 py-0.5 text-[9px] text-white/70">
                      {node.label}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3">
        <section className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            AI Controls
          </p>
          <div className="mt-3 space-y-2">
            {AI_CONTROL_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.run}
                className="flex w-full items-start justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.08]"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-white/90">{action.label}</span>
                  <span className="block text-[11px] text-white/45">{action.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Search Results
          </p>
          <div className="mt-3 max-h-40 space-y-2 overflow-auto">
            {filteredNodes.slice(0, 12).map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => focusNode(node.id)}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.08]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/90">{node.label}</span>
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-white/45">{node.kind}</span>
                </span>
                <span className="ml-3 text-[11px] text-white/35">{node.score}</span>
              </button>
            ))}
            {filteredNodes.length === 0 ? (
              <p className="text-sm text-white/45">No matching nodes.</p>
            ) : null}
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
                Inspector
              </p>
              <p className="mt-1 text-xs text-white/45">
                {selectedNode ? "Changes save locally immediately. No graph write API is exposed in this repo." : "Select a node to inspect it."}
              </p>
            </div>
            {selectedNode ? (
              <button
                type="button"
                onClick={() => setEditMode((current) => !current)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/75 transition hover:bg-white/[0.08]"
              >
                {editMode ? "Cancel" : "Edit"}
              </button>
            ) : null}
          </div>

          {selectedNode ? (
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
                <p className="text-sm font-semibold text-white/95">{selectedNode.label}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-white/45">{selectedNode.kind}</p>
                <p className="mt-2 text-xs text-white/55">Node ID: {selectedNode.id}</p>
                <p className="text-xs text-white/55">Score: {selectedNode.score}</p>
              </div>

              {editMode ? (
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
                  <label className="block text-xs text-white/55">
                    Label
                    <input
                      value={draft.label}
                      onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="block text-xs text-white/55">
                    Kind
                    <input
                      value={draft.kind}
                      onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                    />
                  </label>
                  <label className="block text-xs text-white/55">
                    Score
                    <input
                      value={draft.score}
                      onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={saveDraft}
                    className="w-full rounded-xl border px-3 py-2 text-sm font-medium text-white"
                    style={{
                      background: withAlpha(accent, 0.22),
                      borderColor: withAlpha(accent, 0.3),
                    }}
                  >
                    Save changes
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white/70">
                  <p>Click Edit to update the label, type, or score.</p>
                  <p className="mt-2 text-xs text-white/45">
                    Selecting a node from the minimap or search results recenters it in the main graph.
                  </p>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-white/55">
                <p className="font-semibold uppercase tracking-[0.12em] text-white/45">Persisted local edits</p>
                <pre className="mt-2 whitespace-pre-wrap break-words">
                  {JSON.stringify(persistedEdits[selectedNode.id] ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
