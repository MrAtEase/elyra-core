import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { classifyIntentDomain, parseIntent } from "../engine/intent-parser.js";
import { startRun } from "../engine/run-engine.js";
import { matchMockPlan } from "../mock/responses.js";
import { ValidationError } from "../lib/errors.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import {
  appendIntentMessage,
  createIntent,
  createRun,
  getLatestIntentBundle,
  setRunAiRunId,
} from "../db/repos/brain-foundation.js";
import { assembleContext, summarizeContextForPrompt } from "../kernel/context-assembler.js";

const intentBody = z.object({
  prompt: z.string().min(1).max(2000),
  workspaceId: z.string().optional(),
  openApps: z.array(z.string()).max(12).optional(),
  activeView: z.string().max(120).nullable().optional(),
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().optional(),
    dataBase64: z.string(),
  })).max(4).optional(),
});

export async function intentRoutes(app: FastifyInstance) {
  app.post("/v1/intent", async (request, reply) => {
    const parsed = intentBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { userId, workspaceId: headerWs } = request as AuthenticatedRequest;
    const requestedWorkspaceId = parsed.data.workspaceId ?? headerWs;
    const workspaceId = await resolveAuthorizedWorkspaceId(userId, requestedWorkspaceId);
    if (!workspaceId) {
      throw new ValidationError("workspace_not_accessible");
    }

    const openApps = parsed.data.openApps ?? [];
    const activeView = parsed.data.activeView ?? null;
    const attachments = parsed.data.attachments ?? [];

    const domain = classifyIntentDomain(parsed.data.prompt);
    const contextBundle = await assembleContext({
      workspaceId,
      userId,
      intentText: parsed.data.prompt,
      activeView,
      intentDomain: domain,
      attachments,
    });

    const contextSummary = summarizeContextForPrompt(
      contextBundle,
      parsed.data.prompt,
      openApps,
      activeView,
    );

    const intent = await createIntent(workspaceId, userId, parsed.data.prompt, {
      contextBundle,
      openApps,
      activeView,
      domain,
      attachments,
    });

    await appendIntentMessage(intent.id, "user", parsed.data.prompt);

    const foundationRun = await createRun(intent.id, workspaceId);

    // Fast path: check for mock plan match (no AI call)
    const mockPlan = matchMockPlan(parsed.data.prompt);
    let plan, promptTokens, completionTokens, model;

    if (mockPlan) {
      plan = mockPlan;
      promptTokens = 0;
      completionTokens = 0;
      model = "mock";
    } else {
      const plannerPrompt = `${parsed.data.prompt}\n\nWorkspace context (compact JSON):\n${contextSummary}`;
      const parsedPlan = await parseIntent(plannerPrompt, contextSummary, attachments);
      plan = parsedPlan.plan;
      promptTokens = parsedPlan.promptTokens;
      completionTokens = parsedPlan.completionTokens;
      model = parsedPlan.model;
    }

    const runId = await startRun(
      userId,
      workspaceId,
      parsed.data.prompt,
      plan,
      {
        promptTokens,
        completionTokens,
        model,
      },
      {
        intentId: intent.id,
        foundationRunId: foundationRun.id,
      },
    );

    await setRunAiRunId(foundationRun.id, runId);

    reply.status(201).send({
      runId,
      intentId: intent.id,
      foundationRunId: foundationRun.id,
      plan,
    });
  });

  app.get("/v1/intents/latest", async (request, reply) => {
    const { userId, workspaceId: headerWs } = request as AuthenticatedRequest;
    const query = (request.query ?? {}) as { workspaceId?: string };
    const requestedWorkspaceId = (query.workspaceId && query.workspaceId.trim()) || headerWs;
    const workspaceId = await resolveAuthorizedWorkspaceId(userId, requestedWorkspaceId);

    if (!workspaceId) {
      throw new ValidationError("workspace_not_accessible");
    }

    const bundle = await getLatestIntentBundle(workspaceId, userId);
    reply.send({ workspaceId, bundle });
  });
}
