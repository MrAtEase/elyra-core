import { NextRequest, NextResponse } from "next/server";
import type { WhoamiResponse } from "@/types/whoami";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import { resolveUiModel } from "@/lib/orb-os/contracts/rendering";
import { uiBootstrapContractSchema } from "@/lib/orb-os/contracts/types";
import { buildExampleBootstrapContract } from "@/lib/orb-os/contracts/examples";
import { getWorkspaceId, resolveCanonicalWorkspaceId } from "@/lib/api/workspaceRequest";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import { fetchWhoamiPayload, getWhoamiUserId } from "@/lib/api/whoamiClient";
import { createServerTimingTrace } from "@/lib/api/serverTiming";

const BOOTSTRAP_CACHE_TTL_MS = 60_000;

type BootstrapSuccessPayload =
  | {
      ok: true;
      contract: ReturnType<typeof buildExampleBootstrapContract>;
      ui: ReturnType<typeof resolveUiModel>;
      degraded_mode?: true;
    }
  | {
      ok: true;
      contract: Awaited<ReturnType<typeof buildBootstrapContractFromDb>>;
      ui: ReturnType<typeof resolveUiModel>;
      degraded_mode?: true;
    };

const bootstrapCache = new Map<string, { expiresAt: number; payload: BootstrapSuccessPayload }>();
const bootstrapInflight = new Map<string, Promise<BootstrapSuccessPayload>>();

class RouteResponseError extends Error {
  constructor(public readonly response: NextResponse) {
    super("route_response");
    this.name = "RouteResponseError";
  }
}

function resolveWorkspaceId(request: NextRequest, payload: WhoamiResponse): string | null {
  const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
  const resolved = getWorkspaceId(request, false);
  const requested = resolved.ok ? (resolved.workspaceId ?? "") : "";

  // Resolve canonical frontend IDs (ws-personal, ws-elyra-core) to real UUIDs
  if (requested) {
    const realId = resolveCanonicalWorkspaceId(requested, workspaces);
    if (realId) return realId;
  }

  // whoami payload from lightweight auth services can omit workspaces[].
  // In that case we still trust explicitly requested workspace scope.
  const normalizedRequested = normalizeWorkspaceId(requested) ?? requested;
  if (normalizedRequested && workspaces.length === 0) {
    return normalizedRequested;
  }

  const fallback =
    payload.activeWorkspace?.id ||
    payload.session?.activeWorkspaceId ||
    payload.workspaceId ||
    payload.userSettings?.defaultWorkspaceId ||
    workspaces[0]?.id ||
    null;
  return fallback ?? null;
}

export async function GET(request: NextRequest) {
  const timing = createServerTimingTrace("api/os/bootstrap");
  const respond = (response: NextResponse, meta?: Record<string, unknown>) => {
    timing.log(meta);
    return timing.apply(response) as NextResponse;
  };

  const requestWorkspace = getWorkspaceId(request, false);
  if (!requestWorkspace.ok) {
    return respond(NextResponse.json(
      { ok: false, error: requestWorkspace.error, reason: requestWorkspace.reason, hint: requestWorkspace.hint },
      { status: requestWorkspace.status }
    ));
  }

  const { response, payload } = await timing.measure("whoami", fetchWhoamiPayload(request), "worker auth");
  if (!response.ok || !payload) {
    return respond(NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status }));
  }

  const workspaceId = resolveWorkspaceId(request, payload);
  const role = (payload.membership?.role || "member").toLowerCase();
  if (!workspaceId) {
    return respond(NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 }));
  }

  try {
    const cacheKey = `${workspaceId}::${role}`;
    const cached = bootstrapCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      timing.mark("cache", "hit");
      return respond(NextResponse.json(cached.payload), { workspaceId, cache: "hit" });
    }

    const pending =
      bootstrapInflight.get(cacheKey) ??
      (async () => {
        const userId = getWhoamiUserId(payload);
        const contract = await timing.measure(
          "contract",
          buildBootstrapContractFromDb(workspaceId, { userId, seedIfMissing: true }),
          "supabase bootstrap"
        );
        const parsed = uiBootstrapContractSchema.safeParse(contract);
        if (!parsed.success) {
          throw new RouteResponseError(
            NextResponse.json(
              {
                ok: false,
                error: "INVALID_BOOTSTRAP_CONTRACT",
                details: parsed.error.issues,
              },
              { status: 500 }
            )
          );
        }

        const nextPayload: BootstrapSuccessPayload = {
          ok: true,
          contract: parsed.data,
          ui: await timing.measure(
            "ui",
            Promise.resolve(resolveUiModel(parsed.data, { role })),
            "render ui model"
          ),
        };
        bootstrapCache.set(cacheKey, {
          expiresAt: Date.now() + BOOTSTRAP_CACHE_TTL_MS,
          payload: nextPayload,
        });
        bootstrapInflight.delete(cacheKey);
        return nextPayload;
      })().catch((error) => {
        bootstrapInflight.delete(cacheKey);
        throw error;
      });

    if (!bootstrapInflight.has(cacheKey)) {
      bootstrapInflight.set(cacheKey, pending);
    }

    return respond(NextResponse.json(await pending), { workspaceId, cache: "miss" });
  } catch (error) {
    if (error instanceof RouteResponseError) {
      return respond(error.response, { workspaceId, mode: "route_error" });
    }
    if (process.env.NODE_ENV !== "production") {
      console.error("[api/os/bootstrap] failed to load DB-backed contract; using fallback contract", {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const contract = buildExampleBootstrapContract(workspaceId);
    const fallbackPayload: BootstrapSuccessPayload = {
      ok: true,
      contract,
      ui: resolveUiModel(contract, { role }),
      degraded_mode: true,
    };
    bootstrapCache.set(`${workspaceId}::${role}`, {
      expiresAt: Date.now() + BOOTSTRAP_CACHE_TTL_MS,
      payload: fallbackPayload,
    });
    return respond(NextResponse.json(fallbackPayload), { workspaceId, degradedMode: true });
  }
}
