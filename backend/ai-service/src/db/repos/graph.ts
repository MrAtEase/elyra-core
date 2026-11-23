import { db } from "../client.js";

type GraphNodeRecord = {
  id: string;
  workspace_id: string;
  kind: string;
  key: string;
  label: string;
  data_json: Record<string, unknown>;
  score: number;
  created_at: string;
  updated_at: string;
};

type GraphEdgeRecord = {
  id: string;
  workspace_id: string;
  src_id: string;
  dst_id: string;
  rel: string;
  weight: number;
  data_json: Record<string, unknown>;
  created_at: string;
};

export type GraphSummary = {
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    score: number;
  }>;
  edges: Array<{
    src_id: string;
    dst_id: string;
    rel: string;
  }>;
};

export async function upsertNode(input: {
  workspaceId: string;
  kind: string;
  key: string;
  label: string;
  dataJson?: Record<string, unknown>;
  score?: number;
}): Promise<GraphNodeRecord> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("graph_nodes")
    .upsert(
      {
        workspace_id: input.workspaceId,
        kind: input.kind,
        key: input.key,
        label: input.label,
        data_json: input.dataJson ?? {},
        score: typeof input.score === "number" ? input.score : 0,
        updated_at: now,
      },
      { onConflict: "workspace_id,kind,key" },
    )
    .select("*")
    .single<GraphNodeRecord>();
  if (error || !data) {
    throw error ?? new Error("Failed to upsert graph node");
  }
  return data;
}

export async function upsertEdge(input: {
  workspaceId: string;
  srcId: string;
  dstId: string;
  rel: string;
  weight?: number;
  dataJson?: Record<string, unknown>;
}): Promise<GraphEdgeRecord> {
  const { data, error } = await db()
    .from("graph_edges")
    .upsert(
      {
        workspace_id: input.workspaceId,
        src_id: input.srcId,
        dst_id: input.dstId,
        rel: input.rel,
        weight: typeof input.weight === "number" ? input.weight : 1,
        data_json: input.dataJson ?? {},
      },
      { onConflict: "workspace_id,src_id,dst_id,rel" },
    )
    .select("*")
    .single<GraphEdgeRecord>();
  if (error || !data) {
    throw error ?? new Error("Failed to upsert graph edge");
  }
  return data;
}

function tokensFromText(text?: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();
  for (const raw of normalized.split(/\W+/)) {
    const cleaned = raw.replace(/[^a-z0-9]/g, "");
    if (cleaned.length >= 3) {
      tokens.add(cleaned);
      if (tokens.size >= 8) break;
    }
  }
  return Array.from(tokens).slice(0, 8);
}

export async function getGraphSummary(input: {
  workspaceId: string;
  queryText?: string;
  limitNodes?: number;
  limitEdges?: number;
}): Promise<GraphSummary> {
  const limitNodes = input.limitNodes ?? 12;
  const limitEdges = input.limitEdges ?? 20;
  let nodes: GraphNodeRecord[] = [];

  const tokens = tokensFromText(input.queryText);
  if (tokens.length > 0) {
    const clause = tokens
      .map((token) => `label.ilike.*${token}*,key.ilike.*${token}*`)
      .join(",");
    if (clause) {
      const { data } = await db()
        .from("graph_nodes")
        .select("*")
        .eq("workspace_id", input.workspaceId)
        .or(clause)
        .limit(limitNodes);
      nodes = (data ?? []) as GraphNodeRecord[];
    }
  }

  if (nodes.length === 0) {
    const { data } = await db()
      .from("graph_nodes")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(limitNodes);
    nodes = (data ?? []) as GraphNodeRecord[];
  }

  if (nodes.length === 0) return { nodes: [], edges: [] };

  const nodeIds = Array.from(new Set(nodes.map((node) => node.id)));
  const idsClause = nodeIds.join(",");
  let edges: GraphEdgeRecord[] = [];
  if (idsClause) {
    const { data } = await db()
      .from("graph_edges")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .or(`src_id.in.(${idsClause}),dst_id.in.(${idsClause})`)
      .limit(limitEdges);
    edges = (data ?? []) as GraphEdgeRecord[];
  }

  const referencedIds = new Set<string>(nodeIds);
  edges.forEach((edge) => {
    referencedIds.add(edge.src_id);
    referencedIds.add(edge.dst_id);
  });

  const allNodeIds = Array.from(referencedIds);
  const { data: nodeData } = await db()
    .from("graph_nodes")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .in("id", allNodeIds)
    .limit(Math.max(limitNodes, allNodeIds.length));
  const dedupedNodes = (nodeData ?? []) as GraphNodeRecord[];

  return {
    nodes: dedupedNodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      score: typeof node.score === "number" ? node.score : 0,
    })),
    edges: edges.map((edge) => ({
      src_id: edge.src_id,
      dst_id: edge.dst_id,
      rel: edge.rel,
    })),
  };
}
