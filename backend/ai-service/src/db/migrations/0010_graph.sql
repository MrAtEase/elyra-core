CREATE TABLE IF NOT EXISTS public.graph_nodes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  score REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, key)
);

CREATE TABLE IF NOT EXISTS public.graph_edges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL,
  src_id TEXT NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  dst_id TEXT NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  rel TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, src_id, dst_id, rel)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace ON public.graph_nodes (workspace_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace_kind ON public.graph_nodes (workspace_id, kind);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_data_json ON public.graph_nodes USING GIN (data_json);

CREATE INDEX IF NOT EXISTS idx_graph_edges_workspace ON public.graph_edges (workspace_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_workspace_rel ON public.graph_edges (workspace_id, rel);
CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON public.graph_edges (src_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_dst ON public.graph_edges (dst_id);
