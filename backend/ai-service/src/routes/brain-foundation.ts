import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { ValidationError, NotFoundError } from "../lib/errors.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import {
  getWorkspaceIdentity,
  getWorkspaceMeta,
  getWorkspaceArtifactById,
  listWorkspaceArtifacts,
  upsertWorkspaceIdentity,
} from "../db/repos/brain-foundation.js";

const workspaceBrainBody = z.object({
  profile: z.object({
    purpose: z.string().max(1200).optional(),
    goals: z.array(z.string().max(240)).max(16).optional(),
    operatingRules: z.array(z.string().max(280)).max(20).optional(),
    preferences: z
      .object({
        language: z.string().max(80).optional(),
        tone: z.string().max(80).optional(),
      })
      .optional(),
    displayName: z.string().max(120).optional(),
    organizationName: z.string().max(180).optional(),
    organisationName: z.string().max(180).optional(),
    roleFocus: z.string().max(180).optional(),
    operatingRhythm: z.string().max(180).optional(),
    platformName: z.string().max(180).optional(),
    governanceMode: z.string().max(180).optional(),
    priority: z.string().max(180).optional(),
  }),
});

const artifactsQuery = z.object({
  workspaceId: z.string().optional(),
  type: z.string().max(80).optional(),
  runId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

function compactProfile(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && value.length === 0) return;

    if (key === "organisationName") {
      if (typeof input.organizationName !== "string" || !input.organizationName.trim()) {
        output.organizationName = value;
      }
      return;
    }

    output[key] = value;
  });

  return output;
}

async function resolveWorkspaceId(
  request: AuthenticatedRequest,
  fallbackWorkspaceId: string,
): Promise<string> {
  const requestedWorkspaceId =
    ((request.query as { workspaceId?: string } | undefined)?.workspaceId ?? fallbackWorkspaceId).trim();
  const workspaceId = await resolveAuthorizedWorkspaceId(request.userId, requestedWorkspaceId);

  if (!workspaceId) {
    throw new ValidationError("workspace_not_accessible");
  }

  return workspaceId;
}

export async function brainFoundationRoutes(app: FastifyInstance) {
  app.get("/v1/workspace-brain", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const workspaceId = await resolveWorkspaceId(authRequest, authRequest.workspaceId);

    const [workspace, profile] = await Promise.all([
      getWorkspaceMeta(workspaceId),
      getWorkspaceIdentity(workspaceId),
    ]);

    reply.send({
      workspace,
      profile: profile ?? {
        kind: workspace.kind,
      },
    });
  });

  app.put("/v1/workspace-brain", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const parsed = workspaceBrainBody.safeParse(request.body);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const workspaceId = await resolveWorkspaceId(authRequest, authRequest.workspaceId);
    const normalizedProfile = compactProfile(parsed.data.profile as Record<string, unknown>);
    const profile = await upsertWorkspaceIdentity(workspaceId, normalizedProfile);

    reply.send({
      workspaceId,
      profile,
    });
  });

  app.get("/v1/artifacts", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const parsed = artifactsQuery.safeParse(request.query ?? {});

    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const requestedWorkspaceId = parsed.data.workspaceId ?? authRequest.workspaceId;
    const workspaceId = await resolveAuthorizedWorkspaceId(authRequest.userId, requestedWorkspaceId);
    if (!workspaceId) {
      throw new ValidationError("workspace_not_accessible");
    }

    const artifacts = await listWorkspaceArtifacts(workspaceId, {
      type: parsed.data.type,
      runId: parsed.data.runId,
      limit: parsed.data.limit,
    });

    reply.send({
      workspaceId,
      artifacts,
    });
  });

  app.get("/v1/artifacts/:artifactId", async (request, reply) => {
    const authRequest = request as AuthenticatedRequest;
    const params = request.params as { artifactId: string };
    const query = request.query as { workspaceId?: string } | undefined;
    const requestedWorkspaceId = query?.workspaceId ?? authRequest.workspaceId;
    const workspaceId = await resolveAuthorizedWorkspaceId(authRequest.userId, requestedWorkspaceId);

    if (!workspaceId) {
      throw new ValidationError("workspace_not_accessible");
    }

    const artifact = await getWorkspaceArtifactById(workspaceId, params.artifactId);
    if (!artifact) {
      throw new NotFoundError("Artifact");
    }

    reply.send({
      workspaceId,
      artifact,
    });
  });
}
