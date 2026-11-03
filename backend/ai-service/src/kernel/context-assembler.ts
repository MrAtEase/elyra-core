import {
  getPersonaSnapshot,
  getWorkspaceIdentity,
  getWorkspaceMeta,
  getWorkspacePolicySnapshot,
  getWorkspaceRole,
  listTopArtifacts,
} from "../db/repos/brain-foundation.js";
import { db } from "../db/client.js";
import { getGraphSummary, type GraphSummary } from "../db/repos/graph.js";
import type { AssembleContextInput, ContextBundle } from "../types/context.js";

function truncateText(value: string, max = 280): string {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function compactObject(value: Record<string, unknown>, maxEntries = 12): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  Object.entries(value)
    .slice(0, maxEntries)
    .forEach(([key, raw]) => {
      if (typeof raw === "string") {
        output[key] = truncateText(raw, 160);
        return;
      }
      if (Array.isArray(raw)) {
        output[key] = raw.slice(0, 6);
        return;
      }
      output[key] = raw;
    });
  return output;
}

async function fetchLastWeatherLocation(workspaceId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("graph_nodes")
    .select("label")
    .eq("workspace_id", workspaceId)
    .eq("kind", "location")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const label = data[0]?.label;
  return typeof label === "string" && label.trim().length > 0 ? label.trim() : null;
}

type MembershipRow = {
  workspace_id: string | null;
  role: string | null;
};

type WorkspaceSummaryRow = {
  id: string;
  name: string | null;
  kind: string | null;
};

type WorkspaceIdentityRow = {
  workspace_id: string;
  profile_json: Record<string, unknown> | null;
};

function toGoalList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export async function assembleCrossWorkspaceContext(userId: string): Promise<string> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return "";

  const { data: membershipRows, error: membershipsError } = await db()
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", normalizedUserId);

  if (membershipsError) return "";

  const memberships = ((membershipRows as MembershipRow[] | null) ?? []).filter(
    (row): row is { workspace_id: string; role: string | null } =>
      typeof row.workspace_id === "string" && row.workspace_id.trim().length > 0,
  );

  if (memberships.length <= 1) return "";

  const workspaceIds = [...new Set(memberships.map((membership) => membership.workspace_id))];

  const [workspacesResult, identitiesResult] = await Promise.all([
    db()
      .from("workspaces")
      .select("id, name, kind")
      .in("id", workspaceIds),
    db()
      .from("workspace_identity")
      .select("workspace_id, profile_json")
      .in("workspace_id", workspaceIds),
  ]);

  const workspaceById = new Map<string, WorkspaceSummaryRow>();
  if (!workspacesResult.error) {
    ((workspacesResult.data as WorkspaceSummaryRow[] | null) ?? []).forEach((workspace) => {
      workspaceById.set(workspace.id, workspace);
    });
  }

  const identityByWorkspaceId = new Map<string, Record<string, unknown>>();
  if (!identitiesResult.error) {
    ((identitiesResult.data as WorkspaceIdentityRow[] | null) ?? []).forEach((identity) => {
      if (!identity?.workspace_id) return;
      if (!identity.profile_json || Array.isArray(identity.profile_json)) return;
      identityByWorkspaceId.set(identity.workspace_id, identity.profile_json);
    });
  }

  const summaries = memberships.map((membership) => {
    const workspace = workspaceById.get(membership.workspace_id);
    const profile = identityByWorkspaceId.get(membership.workspace_id) ?? {};
    const purpose = typeof profile["purpose"] === "string" ? profile["purpose"].trim() : "";
    const goals = toGoalList(profile["goals"]);
    const goalSummary = goals.length > 0 ? `. Key goals: ${goals.join(", ")}` : "";
    const role = membership.role?.trim() || "member";
    const workspaceName = workspace?.name?.trim() || membership.workspace_id;
    const workspaceKind = workspace?.kind?.trim() || "unknown";

    return `- ${workspaceName} (${workspaceKind}, role: ${role})${purpose ? `: ${purpose}` : ""}${goalSummary}`;
  });

  return summaries.length > 1 ? `\nUSER'S WORKSPACES:\n${summaries.join("\n")}` : "";
}

export async function assembleContext(input: AssembleContextInput): Promise<ContextBundle> {
  const [workspace, identity, policySnapshot, personaSnapshot, artifacts, role] = await Promise.all([
    getWorkspaceMeta(input.workspaceId),
    getWorkspaceIdentity(input.workspaceId),
    getWorkspacePolicySnapshot(input.workspaceId),
    getPersonaSnapshot(input.workspaceId, input.userId),
    listTopArtifacts(input.workspaceId, 10),
    getWorkspaceRole(input.workspaceId, input.userId),
  ]);

  const graphSummary = await getGraphSummary({
    workspaceId: input.workspaceId,
    queryText: input.intentText,
  });
  let weatherHint: string | undefined;
  if (input.intentDomain === "weather") {
    const lastLocation = await fetchLastWeatherLocation(input.workspaceId);
    if (lastLocation) {
      weatherHint = `Letzte bekannte Wetter-Location: ${lastLocation}`;
    }
  }

  return {
    workspace,
    identitySlice: identity ?? { kind: workspace.kind },
    memorySlice: personaSnapshot
      ? {
          confirmations: personaSnapshot.confirmations,
          denials: personaSnapshot.denials,
          verbosityPreference: personaSnapshot.verbosityPreference,
        }
      : {},
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      title: truncateText(artifact.title, 80),
    })),
    permissions: {
      role,
    },
    policySnapshot: compactObject(policySnapshot),
    graphSummary,
    weatherHint,
    attachments: input.attachments,
  };
}

export function summarizeContextForPrompt(bundle: ContextBundle, intentText: string, openApps: string[], activeView: string | null): string {
  const compact = {
    workspace: bundle.workspace,
    identity: bundle.identitySlice,
    memory: bundle.memorySlice,
    permissions: bundle.permissions,
    policy: bundle.policySnapshot,
    artifacts: bundle.artifacts,
    runtime: {
      intent: truncateText(intentText, 240),
      openApps: openApps.slice(0, 6),
      activeView,
      attachments: bundle.attachments,
    },
  };

  const graphSummaryText = buildGraphSummaryText(bundle.graphSummary);
  const hint = bundle.weatherHint ? `\n${bundle.weatherHint}` : "";
  return JSON.stringify(compact) + graphSummaryText + hint;
}

function buildGraphSummaryText(summary?: GraphSummary): string {
  if (!summary) return "";
  const nodes = summary.nodes.slice(0, 8);
  if (nodes.length === 0) return "";

  const nodeSnippets = nodes.map((node) => `${node.kind}:${node.label}`);
  const nodeById = new Map(summary.nodes.map((node) => [node.id, node]));
  const edges = summary.edges
    .slice(0, 12)
    .map((edge) => {
      const src = nodeById.get(edge.src_id);
      const dst = nodeById.get(edge.dst_id);
      if (!src || !dst) return null;
      return `${src.kind}:${src.label} —${edge.rel}→ ${dst.kind}:${dst.label}`;
    })
    .filter((line): line is string => Boolean(line));

  if (nodeSnippets.length === 0 && edges.length === 0) return "";
  const lines = [`LONG-TERM MEMORY (graph):`, nodeSnippets.join("; ")];
  if (edges.length > 0) {
    lines.push(...edges);
  }
  return `\n${lines.join("\n")}`;
}
