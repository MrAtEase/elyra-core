type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

type EnvLike = {
  ASSISTANT_DB: D1Database;
};

type ResolvedSessionLike = {
  session: { id: string; active_workspace_id: string | null };
  user: { id: string };
};

type LayoutV1 = {
  version: 1;
  windows: Array<{
    id: string;
    type: "runs" | "approvals" | "files" | "admin" | "settings";
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    z: number;
    minimized: boolean;
  }>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isLayoutV1(value: unknown): value is LayoutV1 {
  if (!value || typeof value !== "object") return false;
  const layout = value as Record<string, unknown>;
  if (layout.version !== 1 || !Array.isArray(layout.windows)) return false;

  return layout.windows.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const windowEntry = entry as Record<string, unknown>;
    return (
      typeof windowEntry.id === "string" &&
      (windowEntry.type === "runs" ||
        windowEntry.type === "approvals" ||
        windowEntry.type === "files" ||
        windowEntry.type === "admin" ||
        windowEntry.type === "settings") &&
      typeof windowEntry.title === "string" &&
      typeof windowEntry.x === "number" &&
      typeof windowEntry.y === "number" &&
      typeof windowEntry.w === "number" &&
      typeof windowEntry.h === "number" &&
      typeof windowEntry.z === "number" &&
      typeof windowEntry.minimized === "boolean"
    );
  });
}

async function resolveWorkspaceId(db: D1Database, resolved: ResolvedSessionLike): Promise<string | null> {
  const activeWorkspaceId = resolved.session.active_workspace_id;

  if (activeWorkspaceId) {
    const activeMembership = await db
      .prepare("SELECT workspace_id FROM memberships WHERE user_id = ?1 AND workspace_id = ?2 LIMIT 1")
      .bind(resolved.user.id, activeWorkspaceId)
      .first<{ workspace_id: string }>();

    if (activeMembership?.workspace_id) {
      return activeMembership.workspace_id;
    }
  }

  const fallbackMembership = await db
    .prepare("SELECT workspace_id FROM memberships WHERE user_id = ?1 ORDER BY created_at ASC LIMIT 1")
    .bind(resolved.user.id)
    .first<{ workspace_id: string }>();

  const workspaceId = fallbackMembership?.workspace_id ?? null;
  if (!workspaceId) {
    return null;
  }

  if (resolved.session.active_workspace_id !== workspaceId) {
    await db
      .prepare("UPDATE sessions SET active_workspace_id = ?1 WHERE id = ?2")
      .bind(workspaceId, resolved.session.id)
      .run();
  }

  return workspaceId;
}

async function handleGetWindowLayout(env: EnvLike, resolved: ResolvedSessionLike): Promise<Response> {
  const workspaceId = await resolveWorkspaceId(env.ASSISTANT_DB, resolved);
  if (!workspaceId) {
    return json({ ok: false, error: "WORKSPACE_NOT_FOUND", message: "No active workspace." }, 404);
  }

  const row = await env.ASSISTANT_DB
    .prepare("SELECT layout_json, updated_at FROM window_layouts WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1")
    .bind(workspaceId, resolved.user.id)
    .first<{ layout_json: string; updated_at: number }>();

  let parsedLayout: unknown = null;
  if (row?.layout_json) {
    try {
      parsedLayout = JSON.parse(row.layout_json);
    } catch {
      parsedLayout = null;
    }
  }

  return json({
    ok: true,
    layout: isLayoutV1(parsedLayout) ? parsedLayout : null,
    updatedAt: row?.updated_at ?? null,
  });
}

async function handlePutWindowLayout(request: Request, env: EnvLike, resolved: ResolvedSessionLike): Promise<Response> {
  const workspaceId = await resolveWorkspaceId(env.ASSISTANT_DB, resolved);
  if (!workspaceId) {
    return json({ ok: false, error: "WORKSPACE_NOT_FOUND", message: "No active workspace." }, 404);
  }

  let body: { layout?: unknown };
  try {
    body = (await request.json()) as { layout?: unknown };
  } catch {
    return json({ ok: false, error: "INVALID_BODY", message: "Body must be valid JSON." }, 400);
  }

  if (!isLayoutV1(body.layout)) {
    return json({ ok: false, error: "INVALID_LAYOUT", message: "layout must be { version: 1, windows: [] }." }, 400);
  }

  const updatedAt = Date.now();

  await env.ASSISTANT_DB
    .prepare(
      "INSERT INTO window_layouts (id, workspace_id, user_id, layout_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(workspace_id, user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at"
    )
    .bind(crypto.randomUUID(), workspaceId, resolved.user.id, JSON.stringify(body.layout), updatedAt)
    .run();

  return json({ ok: true, updatedAt });
}

export async function handleWindowLayoutRoute(
  request: Request,
  env: EnvLike,
  resolved: ResolvedSessionLike
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/window-layout") {
    return null;
  }

  if (request.method === "GET") {
    return handleGetWindowLayout(env, resolved);
  }

  if (request.method === "PUT") {
    return handlePutWindowLayout(request, env, resolved);
  }

  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
