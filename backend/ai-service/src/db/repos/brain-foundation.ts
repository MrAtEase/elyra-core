import { db } from "../client.js";
import {
  artifactId,
  artifactVersionId,
  behaviorEventId,
  foundationRunId,
  foundationStepId,
  intentId,
  intentMessageId,
} from "../../lib/id.js";
import type {
  ContextArtifact,
  IdentityProfile,
  PersonaMemorySlice,
  WorkspaceKind,
} from "../../types/context.js";

type JsonObject = Record<string, unknown>;

type WorkspaceRow = {
  id: string;
  slug: string | null;
  name: string | null;
  kind: string | null;
};

type IntentStatus = "open" | "running" | "completed" | "failed" | "cancelled";
type RunStatus = "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
type RunStepStatus = "pending" | "running" | "completed" | "failed" | "approval_required" | "skipped";
export type IntentMessageRole = "user" | "assistant" | "system";
export type BehaviorEventType = "approve_step" | "deny_step" | "edit_output" | "run_completed";

export type IntentRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  text: string;
  status: IntentStatus;
  contextJson: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type IntentMessageRecord = {
  id: string;
  intentId: string;
  workspaceId: string;
  role: IntentMessageRole;
  content: string;
  metaJson: JsonObject;
  createdAt: string;
};

export type RunRecord = {
  id: string;
  aiRunId: string | null;
  intentId: string;
  workspaceId: string;
  status: RunStatus;
  summary: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  metaJson: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type RunStepRecord = {
  id: string;
  runId: string;
  workspaceId: string;
  stepKey: string;
  title: string;
  detail: string | null;
  status: RunStepStatus;
  requiresApproval: boolean;
  outputJson: JsonObject | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ArtifactRecord = {
  id: string;
  workspaceId: string;
  intentId: string | null;
  runId: string | null;
  kind: string;
  title: string;
  path: string | null;
  latestVersion: number;
  metaJson: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactVersionRecord = {
  id: string;
  artifactId: string;
  workspaceId: string;
  version: number;
  contentJson: JsonObject;
  createdBy: string | null;
  createdAt: string;
};

export type BehaviorEventRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  intentId: string | null;
  runId: string | null;
  eventType: BehaviorEventType;
  fieldName: string | null;
  metadataJson: JsonObject;
  createdAt: string;
};

export type PersonaSnapshotRecord = {
  workspaceId: string;
  userId: string;
  confirmations: number;
  denials: number;
  verbosityPreference: PersonaMemorySlice["verbosityPreference"];
  snapshotJson: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMeta = {
  id: string;
  slug: string | null;
  name: string;
  kind: WorkspaceKind;
};

const EMPTY_JSON: JsonObject = {};

function toObject(value: unknown): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") return EMPTY_JSON;
  return value as JsonObject;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toBooleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function truncate(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function normalizeWorkspaceKind(raw: unknown): WorkspaceKind {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "individual" || value === "personal" || value === "private" || value === "privat") {
    return "individual";
  }
  if (
    value === "organization" ||
    value === "organisation" ||
    value === "org" ||
    value === "team" ||
    value === "company" ||
    value === "business"
  ) {
    return "organization";
  }
  if (value === "platform" || value === "system" || value === "system_platform") return "platform";
  return "organization";
}

function normalizeStringList(value: unknown, maxItems: number, maxChars = 120): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => truncate(item, maxChars))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBrainPreferences(value: unknown): { language?: string; tone?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const language = truncate(record["language"], 64);
  const tone = truncate(record["tone"], 64);
  if (!language && !tone) return undefined;
  return {
    ...(language ? { language } : {}),
    ...(tone ? { tone } : {}),
  };
}

function normalizeIdentityProfile(kind: WorkspaceKind, profileJson: JsonObject): IdentityProfile {
  const shared = {
    purpose: truncate(profileJson["purpose"], 260),
    goals: normalizeStringList(profileJson["goals"], 8, 140),
    operatingRules: normalizeStringList(profileJson["operatingRules"], 10, 180),
    preferences: normalizeBrainPreferences(profileJson["preferences"]),
  };

  if (kind === "individual") {
    return {
      kind,
      ...shared,
      displayName: truncate(profileJson["displayName"]),
    };
  }

  if (kind === "platform") {
    return {
      kind,
      ...shared,
      platformName: truncate(profileJson["platformName"]),
      governanceMode: truncate(profileJson["governanceMode"]),
      priority: truncate(profileJson["priority"]),
    };
  }

  return {
    kind,
    ...shared,
    organizationName: truncate(profileJson["organizationName"] ?? profileJson["organisationName"]),
    roleFocus: truncate(profileJson["roleFocus"]),
    operatingRhythm: truncate(profileJson["operatingRhythm"]),
  };
}

function mapIntent(row: Record<string, unknown>): IntentRecord {
  return {
    id: toStringValue(row["id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    userId: toStringValue(row["user_id"]),
    text: toStringValue(row["text"]),
    status: toStringValue(row["status"]) as IntentStatus,
    contextJson: toObject(row["context_json"]),
    createdAt: toStringValue(row["created_at"]),
    updatedAt: toStringValue(row["updated_at"]),
  };
}

function mapIntentMessage(row: Record<string, unknown>): IntentMessageRecord {
  return {
    id: toStringValue(row["id"]),
    intentId: toStringValue(row["intent_id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    role: toStringValue(row["role"]) as IntentMessageRole,
    content: toStringValue(row["content"]),
    metaJson: toObject(row["meta_json"]),
    createdAt: toStringValue(row["created_at"]),
  };
}

function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: toStringValue(row["id"]),
    aiRunId: toNullableString(row["ai_run_id"]),
    intentId: toStringValue(row["intent_id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    status: toStringValue(row["status"]) as RunStatus,
    summary: toNullableString(row["summary"]),
    startedAt: toStringValue(row["started_at"]),
    completedAt: toNullableString(row["completed_at"]),
    durationMs: typeof row["duration_ms"] === "number" ? row["duration_ms"] : null,
    error: toNullableString(row["error"]),
    metaJson: toObject(row["meta_json"]),
    createdAt: toStringValue(row["created_at"]),
    updatedAt: toStringValue(row["updated_at"]),
  };
}

function mapRunStep(row: Record<string, unknown>): RunStepRecord {
  return {
    id: toStringValue(row["id"]),
    runId: toStringValue(row["run_id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    stepKey: toStringValue(row["step_key"]),
    title: toStringValue(row["title"]),
    detail: toNullableString(row["detail"]),
    status: toStringValue(row["status"]) as RunStepStatus,
    requiresApproval: toBooleanValue(row["requires_approval"]),
    outputJson: row["output_json"] ? toObject(row["output_json"]) : null,
    createdAt: toStringValue(row["created_at"]),
    updatedAt: toStringValue(row["updated_at"]),
    completedAt: toNullableString(row["completed_at"]),
  };
}

function mapArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: toStringValue(row["id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    intentId: toNullableString(row["intent_id"]),
    runId: toNullableString(row["run_id"]),
    kind: toStringValue(row["kind"]),
    title: toStringValue(row["title"]),
    path: toNullableString(row["path"]),
    latestVersion: toNumberValue(row["latest_version"]),
    metaJson: toObject(row["meta_json"]),
    createdAt: toStringValue(row["created_at"]),
    updatedAt: toStringValue(row["updated_at"]),
  };
}

function mapArtifactVersion(row: Record<string, unknown>): ArtifactVersionRecord {
  return {
    id: toStringValue(row["id"]),
    artifactId: toStringValue(row["artifact_id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    version: toNumberValue(row["version"]),
    contentJson: toObject(row["content_json"]),
    createdBy: toNullableString(row["created_by"]),
    createdAt: toStringValue(row["created_at"]),
  };
}

function mapBehaviorEvent(row: Record<string, unknown>): BehaviorEventRecord {
  return {
    id: toStringValue(row["id"]),
    workspaceId: toStringValue(row["workspace_id"]),
    userId: toStringValue(row["user_id"]),
    intentId: toNullableString(row["intent_id"]),
    runId: toNullableString(row["run_id"]),
    eventType: toStringValue(row["event_type"]) as BehaviorEventType,
    fieldName: toNullableString(row["field_name"]),
    metadataJson: toObject(row["metadata_json"]),
    createdAt: toStringValue(row["created_at"]),
  };
}

function mapPersonaSnapshot(row: Record<string, unknown>): PersonaSnapshotRecord {
  return {
    workspaceId: toStringValue(row["workspace_id"]),
    userId: toStringValue(row["user_id"]),
    confirmations: toNumberValue(row["confirmations"]),
    denials: toNumberValue(row["denials"]),
    verbosityPreference: (toStringValue(row["verbosity_preference"]) as PersonaMemorySlice["verbosityPreference"]) || "normal",
    snapshotJson: toObject(row["snapshot_json"]),
    createdAt: toStringValue(row["created_at"]),
    updatedAt: toStringValue(row["updated_at"]),
  };
}

async function resolveWorkspaceMeta(workspaceId: string): Promise<WorkspaceMeta> {
  const { data, error } = await db()
    .from("workspaces")
    .select("id,slug,name,kind")
    .eq("id", workspaceId)
    .maybeSingle<WorkspaceRow>();

  if (error) throw error;

  if (!data) {
    return {
      id: workspaceId,
      slug: null,
      name: "Workspace",
      kind: workspaceId === "elyra-core" ? "platform" : "organization",
    };
  }

  return {
    id: data.id,
    slug: data.slug,
    name: data.name || "Workspace",
    kind: normalizeWorkspaceKind(data.kind),
  };
}

export async function getWorkspaceMeta(workspaceId: string): Promise<WorkspaceMeta> {
  return resolveWorkspaceMeta(workspaceId);
}

export async function getWorkspaceIdentity(workspaceId: string): Promise<IdentityProfile | null> {
  const [{ data: identityRow, error }, workspace] = await Promise.all([
    db()
      .from("workspace_identity")
      .select("profile_json")
      .eq("workspace_id", workspaceId)
      .maybeSingle<{ profile_json: JsonObject | null }>(),
    resolveWorkspaceMeta(workspaceId),
  ]);

  if (error) throw error;
  if (!identityRow?.profile_json) return null;

  return normalizeIdentityProfile(workspace.kind, toObject(identityRow.profile_json));
}

export async function upsertWorkspaceIdentity(
  workspaceId: string,
  profileJson: JsonObject,
): Promise<IdentityProfile> {
  const now = new Date().toISOString();
  const { error } = await db().from("workspace_identity").upsert(
    {
      workspace_id: workspaceId,
      profile_json: profileJson,
      updated_at: now,
    },
    { onConflict: "workspace_id" },
  );

  if (error) throw error;

  const workspace = await resolveWorkspaceMeta(workspaceId);
  return normalizeIdentityProfile(workspace.kind, profileJson);
}

export async function getWorkspacePolicySnapshot(workspaceId: string): Promise<JsonObject> {
  const { data, error } = await db()
    .from("workspace_policies")
    .select("policy_json")
    .eq("workspace_id", workspaceId)
    .maybeSingle<{ policy_json: JsonObject | null }>();

  if (error) throw error;
  return toObject(data?.policy_json);
}

export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle<{ role: string | null }>();

  if (error) throw error;
  return data?.role ?? null;
}

export async function createIntent(
  workspaceId: string,
  userId: string,
  text: string,
  contextJson: JsonObject = EMPTY_JSON,
): Promise<IntentRecord> {
  const now = new Date().toISOString();
  const payload = {
    id: intentId(),
    workspace_id: workspaceId,
    user_id: userId,
    text,
    status: "open" as IntentStatus,
    context_json: contextJson,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await db().from("intents").insert(payload).select("*").single<Record<string, unknown>>();
  if (error) throw error;
  return mapIntent(data);
}

export async function updateIntentStatus(intentIdValue: string, status: IntentStatus): Promise<void> {
  const { error } = await db()
    .from("intents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", intentIdValue);

  if (error) throw error;
}

export async function appendIntentMessage(
  intentIdValue: string,
  role: IntentMessageRole,
  content: string,
  metaJson: JsonObject = EMPTY_JSON,
): Promise<IntentMessageRecord> {
  const { data: intentRow, error: intentError } = await db()
    .from("intents")
    .select("workspace_id")
    .eq("id", intentIdValue)
    .maybeSingle<{ workspace_id: string | null }>();

  if (intentError) throw intentError;
  if (!intentRow?.workspace_id) {
    throw new Error(`Intent ${intentIdValue} not found`);
  }

  const payload = {
    id: intentMessageId(),
    intent_id: intentIdValue,
    workspace_id: intentRow.workspace_id,
    role,
    content,
    meta_json: metaJson,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("intent_messages")
    .insert(payload)
    .select("*")
    .single<Record<string, unknown>>();

  if (error) throw error;
  return mapIntentMessage(data);
}

export async function listIntentMessages(intentIdValue: string): Promise<IntentMessageRecord[]> {
  const { data, error } = await db()
    .from("intent_messages")
    .select("*")
    .eq("intent_id", intentIdValue)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map(mapIntentMessage);
}

export async function createRun(intentIdValue: string, workspaceId: string): Promise<RunRecord> {
  const now = new Date().toISOString();
  const payload = {
    id: foundationRunId(),
    intent_id: intentIdValue,
    workspace_id: workspaceId,
    status: "pending" as RunStatus,
    started_at: now,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await db().from("runs").insert(payload).select("*").single<Record<string, unknown>>();
  if (error) throw error;
  return mapRun(data);
}

export async function setRunAiRunId(runIdValue: string, aiRunId: string): Promise<void> {
  const { error } = await db()
    .from("runs")
    .update({ ai_run_id: aiRunId, updated_at: new Date().toISOString() })
    .eq("id", runIdValue);

  if (error) throw error;
}

export async function getRunByAiRunId(aiRunId: string): Promise<RunRecord | null> {
  const { data, error } = await db()
    .from("runs")
    .select("*")
    .eq("ai_run_id", aiRunId)
    .maybeSingle<Record<string, unknown>>();

  if (error) throw error;
  if (!data) return null;
  return mapRun(data);
}

export async function setRunStatus(
  runIdValue: string,
  status: RunStatus,
  options: {
    summary?: string | null;
    error?: string | null;
    durationMs?: number | null;
    completedAt?: string | null;
    metaJson?: JsonObject;
  } = {},
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (options.summary !== undefined) update["summary"] = options.summary;
  if (options.error !== undefined) update["error"] = options.error;
  if (options.durationMs !== undefined) update["duration_ms"] = options.durationMs;
  if (options.completedAt !== undefined) update["completed_at"] = options.completedAt;
  if (options.metaJson !== undefined) update["meta_json"] = options.metaJson;

  const { error } = await db().from("runs").update(update).eq("id", runIdValue);
  if (error) throw error;
}

export type AddRunStepInput = {
  workspaceId?: string;
  stepKey: string;
  title: string;
  detail?: string | null;
  status: RunStepStatus;
  requiresApproval?: boolean;
  outputJson?: JsonObject | null;
  completedAt?: string | null;
};

export async function addRunStep(runIdValue: string, input: AddRunStepInput): Promise<RunStepRecord> {
  let workspaceId = input.workspaceId;
  if (!workspaceId) {
    const { data: runRow, error: runError } = await db()
      .from("runs")
      .select("workspace_id")
      .eq("id", runIdValue)
      .maybeSingle<{ workspace_id: string | null }>();

    if (runError) throw runError;
    workspaceId = runRow?.workspace_id ?? undefined;
  }

  if (!workspaceId) {
    throw new Error(`Run ${runIdValue} has no workspace_id`);
  }

  const { data: existing, error: existingError } = await db()
    .from("run_steps")
    .select("id")
    .eq("run_id", runIdValue)
    .eq("step_key", input.stepKey)
    .maybeSingle<{ id: string | null }>();

  if (existingError) throw existingError;

  const now = new Date().toISOString();

  if (existing?.id) {
    const updatePayload: Record<string, unknown> = {
      title: input.title,
      detail: input.detail ?? null,
      status: input.status,
      requires_approval: input.requiresApproval ?? false,
      output_json: input.outputJson ?? null,
      updated_at: now,
    };

    if (input.completedAt !== undefined) {
      updatePayload["completed_at"] = input.completedAt;
    } else if (input.status === "completed" || input.status === "failed" || input.status === "skipped") {
      updatePayload["completed_at"] = now;
    }

    const { data, error } = await db()
      .from("run_steps")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single<Record<string, unknown>>();

    if (error) throw error;
    return mapRunStep(data);
  }

  const insertPayload = {
    id: foundationStepId(),
    run_id: runIdValue,
    workspace_id: workspaceId,
    step_key: input.stepKey,
    title: input.title,
    detail: input.detail ?? null,
    status: input.status,
    requires_approval: input.requiresApproval ?? false,
    output_json: input.outputJson ?? null,
    created_at: now,
    updated_at: now,
    completed_at:
      input.completedAt !== undefined
        ? input.completedAt
        : input.status === "completed" || input.status === "failed" || input.status === "skipped"
          ? now
          : null,
  };

  const { data, error } = await db()
    .from("run_steps")
    .insert(insertPayload)
    .select("*")
    .single<Record<string, unknown>>();

  if (error) throw error;
  return mapRunStep(data);
}

export async function listRunSteps(runIdValue: string): Promise<RunStepRecord[]> {
  const { data, error } = await db()
    .from("run_steps")
    .select("*")
    .eq("run_id", runIdValue)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map(mapRunStep);
}

export type LogBehaviorEventInput = {
  workspaceId: string;
  userId: string;
  eventType: BehaviorEventType;
  intentId?: string | null;
  runId?: string | null;
  fieldName?: string | null;
  metadata?: JsonObject;
};

export async function logBehaviorEvent(input: LogBehaviorEventInput): Promise<BehaviorEventRecord> {
  const payload = {
    id: behaviorEventId(),
    workspace_id: input.workspaceId,
    user_id: input.userId,
    intent_id: input.intentId ?? null,
    run_id: input.runId ?? null,
    event_type: input.eventType,
    field_name: input.fieldName ?? null,
    metadata_json: input.metadata ?? EMPTY_JSON,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await db()
    .from("behavior_events")
    .insert(payload)
    .select("*")
    .single<Record<string, unknown>>();

  if (error) throw error;
  return mapBehaviorEvent(data);
}

export type UpsertArtifactInput = {
  workspaceId: string;
  kind: string;
  title: string;
  path?: string | null;
  intentId?: string | null;
  runId?: string | null;
  metaJson?: JsonObject;
};

export async function upsertArtifact(input: UpsertArtifactInput): Promise<ArtifactRecord> {
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await db()
    .from("artifacts")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("kind", input.kind)
    .eq("title", input.title)
    .maybeSingle<Record<string, unknown>>();

  if (lookupError) throw lookupError;

  if (existing) {
    const updatePayload = {
      path: input.path ?? null,
      intent_id: input.intentId ?? null,
      run_id: input.runId ?? null,
      meta_json: input.metaJson ?? toObject(existing["meta_json"]),
      updated_at: now,
    };

    const { data, error } = await db()
      .from("artifacts")
      .update(updatePayload)
      .eq("id", toStringValue(existing["id"]))
      .select("*")
      .single<Record<string, unknown>>();

    if (error) throw error;
    return mapArtifact(data);
  }

  const insertPayload = {
    id: artifactId(),
    workspace_id: input.workspaceId,
    intent_id: input.intentId ?? null,
    run_id: input.runId ?? null,
    kind: input.kind,
    title: input.title,
    path: input.path ?? null,
    latest_version: 0,
    meta_json: input.metaJson ?? EMPTY_JSON,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await db()
    .from("artifacts")
    .insert(insertPayload)
    .select("*")
    .single<Record<string, unknown>>();

  if (error) throw error;
  return mapArtifact(data);
}

export type AddArtifactVersionInput = {
  artifactId: string;
  workspaceId: string;
  contentJson: JsonObject;
  createdBy?: string | null;
};

export async function addArtifactVersion(input: AddArtifactVersionInput): Promise<ArtifactVersionRecord> {
  const { data: latestRows, error: latestError } = await db()
    .from("artifact_versions")
    .select("version")
    .eq("artifact_id", input.artifactId)
    .order("version", { ascending: false })
    .limit(1);

  if (latestError) throw latestError;

  const currentVersion = toNumberValue((latestRows as Array<{ version?: number }> | null)?.[0]?.version, 0);
  const nextVersion = currentVersion + 1;
  const now = new Date().toISOString();

  const payload = {
    id: artifactVersionId(),
    artifact_id: input.artifactId,
    workspace_id: input.workspaceId,
    version: nextVersion,
    content_json: input.contentJson,
    created_by: input.createdBy ?? null,
    created_at: now,
  };

  const { data, error } = await db()
    .from("artifact_versions")
    .insert(payload)
    .select("*")
    .single<Record<string, unknown>>();

  if (error) throw error;

  const { error: artifactError } = await db()
    .from("artifacts")
    .update({ latest_version: nextVersion, updated_at: now })
    .eq("id", input.artifactId);

  if (artifactError) throw artifactError;

  return mapArtifactVersion(data);
}

async function countBehaviorEvents(
  workspaceId: string,
  userId: string,
  eventType: BehaviorEventType,
): Promise<number> {
  const { count, error } = await db()
    .from("behavior_events")
    .select("id", { head: true, count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("event_type", eventType);

  if (error) throw error;
  return count ?? 0;
}

export async function getPersonaSnapshot(
  workspaceId: string,
  userId: string,
): Promise<PersonaSnapshotRecord | null> {
  const { data, error } = await db()
    .from("persona_snapshots")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle<Record<string, unknown>>();

  if (error) throw error;
  if (!data) return null;
  return mapPersonaSnapshot(data);
}

export async function computePersonaSnapshot(
  workspaceId: string,
  userId: string,
): Promise<PersonaSnapshotRecord> {
  const [confirmations, denials] = await Promise.all([
    countBehaviorEvents(workspaceId, userId, "approve_step"),
    countBehaviorEvents(workspaceId, userId, "deny_step"),
  ]);

  let verbosityPreference: PersonaMemorySlice["verbosityPreference"] = "normal";
  if (confirmations - denials >= 3) {
    verbosityPreference = "high";
  } else if (denials > confirmations) {
    verbosityPreference = "low";
  }

  const now = new Date().toISOString();
  const snapshotJson = {
    confirmations,
    denials,
    score: confirmations - denials,
  };

  const { data, error } = await db()
    .from("persona_snapshots")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        confirmations,
        denials,
        verbosity_preference: verbosityPreference,
        snapshot_json: snapshotJson,
        updated_at: now,
      },
      { onConflict: "workspace_id,user_id" },
    )
    .select("*")
    .single<Record<string, unknown>>();

  if (error) throw error;
  return mapPersonaSnapshot(data);
}

export async function listTopArtifacts(workspaceId: string, limit = 10): Promise<ContextArtifact[]> {
  const clamped = Math.max(1, Math.min(10, Math.floor(limit)));
  const { data, error } = await db()
    .from("artifacts")
    .select("id,kind,title,latest_version,updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(clamped);

  if (error) throw error;

  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    id: toStringValue(row["id"]),
    kind: toStringValue(row["kind"]),
    title: toStringValue(row["title"]),
    latestVersion: toNumberValue(row["latest_version"]),
    updatedAt: toStringValue(row["updated_at"]),
  }));
}

export type WorkspaceArtifactItem = {
  id: string;
  workspaceId: string;
  intentId: string | null;
  runId: string | null;
  type: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  latestVersion: number;
  payloadRef: string | null;
  payloadJson: JsonObject;
};

export type WorkspaceArtifactDetail = WorkspaceArtifactItem & {
  versions: ArtifactVersionRecord[];
};

async function listArtifactVersions(
  artifactIdValue: string,
  limit = 5,
): Promise<ArtifactVersionRecord[]> {
  const clamped = Math.max(1, Math.min(10, Math.floor(limit)));
  const { data, error } = await db()
    .from("artifact_versions")
    .select("*")
    .eq("artifact_id", artifactIdValue)
    .order("version", { ascending: false })
    .limit(clamped);

  if (error) throw error;
  return ((data as Record<string, unknown>[] | null) ?? []).map(mapArtifactVersion);
}

function toWorkspaceArtifactItem(
  artifact: ArtifactRecord,
  latestVersionRecord: ArtifactVersionRecord | null,
): WorkspaceArtifactItem {
  return {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    intentId: artifact.intentId,
    runId: artifact.runId,
    type: artifact.kind,
    title: artifact.title,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    createdBy: latestVersionRecord?.createdBy ?? null,
    latestVersion: artifact.latestVersion,
    payloadRef: artifact.path,
    payloadJson: latestVersionRecord?.contentJson ?? EMPTY_JSON,
  };
}

export async function listWorkspaceArtifacts(
  workspaceId: string,
  options: {
    type?: string;
    runId?: string;
    limit?: number;
  } = {},
): Promise<WorkspaceArtifactItem[]> {
  const clamped = Math.max(1, Math.min(40, Math.floor(options.limit ?? 20)));
  let query = db()
    .from("artifacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(clamped);

  if (options.type && options.type.trim()) {
    query = query.eq("kind", options.type.trim());
  }
  if (options.runId && options.runId.trim()) {
    query = query.eq("run_id", options.runId.trim());
  }

  const { data, error } = await query;
  if (error) throw error;

  const artifacts = ((data as Record<string, unknown>[] | null) ?? []).map(mapArtifact);
  if (artifacts.length === 0) return [];

  const versionLists = await Promise.all(
    artifacts.map((artifact) => listArtifactVersions(artifact.id, 1)),
  );

  return artifacts.map((artifact, index) =>
    toWorkspaceArtifactItem(artifact, versionLists[index]?.[0] ?? null),
  );
}

export async function getWorkspaceArtifactById(
  workspaceId: string,
  artifactIdValue: string,
): Promise<WorkspaceArtifactDetail | null> {
  const { data, error } = await db()
    .from("artifacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", artifactIdValue)
    .maybeSingle<Record<string, unknown>>();

  if (error) throw error;
  if (!data) return null;

  const artifact = mapArtifact(data);
  const versions = await listArtifactVersions(artifact.id, 10);
  const detail = toWorkspaceArtifactItem(artifact, versions[0] ?? null);
  return {
    ...detail,
    versions,
  };
}

export type LatestIntentBundle = {
  intent: IntentRecord;
  messages: IntentMessageRecord[];
  run: RunRecord | null;
  steps: RunStepRecord[];
};

export async function getLatestIntentBundle(
  workspaceId: string,
  userId: string,
): Promise<LatestIntentBundle | null> {
  const { data: intentRow, error: intentError } = await db()
    .from("intents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Record<string, unknown>>();

  if (intentError) throw intentError;
  if (!intentRow) return null;

  const intent = mapIntent(intentRow);

  const [messages, run] = await Promise.all([
    listIntentMessages(intent.id),
    db()
      .from("runs")
      .select("*")
      .eq("intent_id", intent.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Record<string, unknown>>(),
  ]);

  if (run.error) throw run.error;

  const mappedRun = run.data ? mapRun(run.data) : null;
  const steps = mappedRun ? await listRunSteps(mappedRun.id) : [];

  return {
    intent,
    messages,
    run: mappedRun,
    steps,
  };
}
