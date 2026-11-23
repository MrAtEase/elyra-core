import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, ValidationError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { getGraphSummary } from "../db/repos/graph.js";

const graphSummaryQuery = z.object({
  workspaceId: z.string().min(1),
  q: z.string().optional(),
});

export function graphRoutes(app: FastifyInstance) {
  app.get("/v1/graph/summary", async (request, reply) => {
    const parsed = graphSummaryQuery.safeParse(request.query as Record<string, unknown>);
    if (!parsed.success) {
      throw new ValidationError("invalid_graph_summary_query");
    }

    const authRequest = request as AuthenticatedRequest;
    const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(
      authRequest.userId,
      parsed.data.workspaceId,
    );
    if (!authorizedWorkspaceId) {
      throw new AppError("workspace_not_accessible", 403, "workspace_not_accessible");
    }

    const summary = await getGraphSummary({
      workspaceId: authorizedWorkspaceId,
      queryText: parsed.data.q,
    });

    reply.send(summary);
  });
}
