import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRun, listRuns, reviseAgent, startTeamRun } from "../agent-team/orchestrator.js";
import { AGENTS, AGENT_ORDER } from "../agent-team/roster.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import type { AgentId } from "../agent-team/types.js";

const agentEnum = z.enum(AGENT_ORDER as [AgentId, ...AgentId[]]);

const startBody = z.object({
  task: z.string().min(5).max(4000),
  context: z.string().max(20_000).optional(),
  agents: z.array(agentEnum).max(8).optional(),
  adsCsv: z.string().max(5_000_000).optional(),
  hoursCsv: z.string().max(5_000_000).optional(),
  mode: z.enum(["single", "team"]).optional(),
  workspaceId: z.string().max(120).optional(),
});

const reviseBody = z.object({ feedback: z.string().min(3).max(2000) });

/** Agenten-Team: mehrere Spezial-Agenten arbeiten parallel an einem Auftrag, ein Mensch gibt frei. */
export async function agentTeamRoutes(app: FastifyInstance) {
  app.get("/v1/agent-team/agents", async () => ({
    agents: AGENT_ORDER.map((id) => ({ id, name: AGENTS[id].name, role: AGENTS[id].role, category: AGENTS[id].category, phase: AGENTS[id].phase, preferredProvider: AGENTS[id].preferredProvider, tools: AGENTS[id].gather || AGENTS[id].call ? true : false })),
  }));

  app.get("/v1/agent-team/runs", async () => ({ runs: listRuns() }));

  app.post("/v1/agent-team/runs", async (request, reply) => {
    const parsed = startBody.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(", "));
    // Workspace nur übernehmen, wenn der Nutzer Zugriff hat (für lesende Werkzeuge wie Mail & Kalender)
    let workspaceId: string | null = null;
    try {
      const { userId, workspaceId: headerWs } = request as AuthenticatedRequest;
      if (userId) workspaceId = (await resolveAuthorizedWorkspaceId(userId, parsed.data.workspaceId ?? headerWs)) ?? null;
    } catch {
      workspaceId = null;
    }
    try {
      const run = startTeamRun({
        workspaceId,
        task: parsed.data.task,
        context: parsed.data.context ?? null,
        agents: parsed.data.agents ?? null,
        adsCsv: parsed.data.adsCsv ?? null,
        hoursCsv: parsed.data.hoursCsv ?? null,
        mode: parsed.data.mode ?? "team",
      });
      reply.status(201);
      return run;
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
  });

  app.get("/v1/agent-team/runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    const run = getRun(id);
    if (!run) throw new NotFoundError("Team-Auftrag");
    return run;
  });

  app.post("/v1/agent-team/runs/:id/agents/:agent/revise", async (request) => {
    const { id, agent } = request.params as { id: string; agent: string };
    const agentParsed = agentEnum.safeParse(agent);
    const body = reviseBody.safeParse(request.body ?? {});
    if (!agentParsed.success) throw new ValidationError("Unbekannter Agent");
    if (!body.success) throw new ValidationError(body.error.issues.map((i) => i.message).join(", "));
    try {
      return reviseAgent(id, agentParsed.data, body.data.feedback);
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
  });
}
