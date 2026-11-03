import { db } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { upsertNode, upsertEdge } from "../db/repos/graph.js";
import { getStepsByRun } from "../db/repos/steps.js";
import type { RunStep } from "../types/run.js";

type IngestRunGraphInput = {
  workspaceId: string;
  userId: string;
  intentId?: string | null;
  runId: string;
};

function normalizeTopics(text: string): string[] {
  if (!text) return [];
  const tokens = new Set<string>();
  for (const raw of text.split(/\W+/)) {
    const cleaned = raw.trim().toLowerCase();
    if (cleaned.length >= 4) {
      tokens.add(cleaned);
      if (tokens.size >= 5) break;
    }
  }
  return Array.from(tokens).slice(0, 5);
}

function extractLocationFromStep(step: RunStep): string | null {
  const locationCandidate = (step.input?.["location"] ?? step.output?.["location"]) ?? null;
  if (typeof locationCandidate !== "string") return null;
  const normalized = locationCandidate.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function ingestRunGraph(input: IngestRunGraphInput): Promise<void> {
  try {
    const workspaceNode = await upsertNode({
      workspaceId: input.workspaceId,
      kind: "workspace",
      key: input.workspaceId,
      label: input.workspaceId,
    });

    const userNode = await upsertNode({
      workspaceId: input.workspaceId,
      kind: "user",
      key: input.userId,
      label: input.userId,
    });

    await upsertEdge({
      workspaceId: input.workspaceId,
      srcId: userNode.id,
      dstId: workspaceNode.id,
      rel: "member_of",
    });

    let intentNode: Awaited<ReturnType<typeof upsertNode>> | null = null;
    let intentText = "";
    let intentDomain: string | null = null;
    if (input.intentId) {
      const { data: intentRow } = await db()
        .from("intents")
        .select("text, context_json")
        .eq("id", input.intentId)
        .maybeSingle<Record<string, unknown>>();
      if (intentRow && typeof intentRow["text"] === "string") {
        intentText = intentRow["text"].trim();
      }
      const contextJson = (intentRow?.["context_json"] as Record<string, unknown> | null) ?? null;
      if (contextJson && typeof contextJson["domain"] === "string") {
        const normalized = contextJson["domain"].trim();
        if (normalized) {
          intentDomain = normalized;
        }
      }
      const intentLabel = intentText ? intentText.slice(0, 120) : input.intentId;
      intentNode = await upsertNode({
        workspaceId: input.workspaceId,
        kind: "intent",
        key: input.intentId,
        label: intentLabel,
      });

      await upsertEdge({
        workspaceId: input.workspaceId,
        srcId: userNode.id,
        dstId: intentNode.id,
        rel: "created",
      });
      await upsertEdge({
        workspaceId: input.workspaceId,
        srcId: intentNode.id,
        dstId: workspaceNode.id,
        rel: "in_workspace",
      });
      if (intentDomain) {
        const domainNode = await upsertNode({
          workspaceId: input.workspaceId,
          kind: "topic",
          key: `domain:${intentDomain.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          label: intentDomain,
        });
        await upsertEdge({
          workspaceId: input.workspaceId,
          srcId: intentNode.id,
          dstId: domainNode.id,
          rel: "about",
        });
      }
    }

    const runNode = await upsertNode({
      workspaceId: input.workspaceId,
      kind: "run",
      key: input.runId,
      label: input.runId,
    });

    if (intentNode) {
      await upsertEdge({
        workspaceId: input.workspaceId,
        srcId: intentNode.id,
        dstId: runNode.id,
        rel: "ran_as",
      });
    }

    const artifactQuery = db()
      .from("artifacts")
      .select("id, title")
      .eq("workspace_id", input.workspaceId);
    if (input.intentId) {
      artifactQuery.or(`run_id.eq.${input.runId},intent_id.eq.${input.intentId}`);
    } else {
      artifactQuery.eq("run_id", input.runId);
    }

    const { data: artifactRows } = await artifactQuery;
    const artifacts = Array.isArray(artifactRows) ? artifactRows : [];
    for (const artifact of artifacts) {
      if (!artifact?.id || !artifact?.title) continue;
      const artifactNode = await upsertNode({
        workspaceId: input.workspaceId,
        kind: "artifact",
        key: artifact.id,
        label: artifact.title,
      });

      if (intentNode) {
        await upsertEdge({
          workspaceId: input.workspaceId,
          srcId: intentNode.id,
          dstId: artifactNode.id,
          rel: "produced",
        });
      }
      await upsertEdge({
        workspaceId: input.workspaceId,
        srcId: runNode.id,
        dstId: artifactNode.id,
        rel: "produced",
      });
    }

    const { data: toolCalls } = await db()
      .from("tool_calls")
      .select("tool_name")
      .eq("workspace_id", input.workspaceId)
      .eq("run_id", input.runId);
    const tools = Array.isArray(toolCalls) ? toolCalls : [];
    const seenTools = new Set<string>();
    for (const tool of tools) {
      const toolName = typeof tool?.tool_name === "string" ? tool.tool_name : null;
      if (!toolName || seenTools.has(toolName)) continue;
      seenTools.add(toolName);
      const appNode = await upsertNode({
        workspaceId: input.workspaceId,
        kind: "app",
        key: toolName,
        label: toolName,
      });
      await upsertEdge({
        workspaceId: input.workspaceId,
        srcId: runNode.id,
        dstId: appNode.id,
        rel: "used_tool",
      });
    }

    const steps = await getStepsByRun(input.runId);
    for (const step of steps) {
      if (!step.toolName.startsWith("weather.")) continue;
      const location = extractLocationFromStep(step);
      if (!location) continue;
      const locationKey = `weather-location:${location.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const locationNode = await upsertNode({
        workspaceId: input.workspaceId,
        kind: "location",
        key: locationKey,
        label: location,
      });
      if (intentNode) {
        await upsertEdge({
          workspaceId: input.workspaceId,
          srcId: intentNode.id,
          dstId: locationNode.id,
          rel: "about",
        });
      }
      await upsertEdge({
        workspaceId: input.workspaceId,
        srcId: runNode.id,
        dstId: locationNode.id,
        rel: "about",
      });
    }

    if (intentNode) {
      const topics = normalizeTopics(intentText);
      for (const topic of topics) {
        const topicNode = await upsertNode({
          workspaceId: input.workspaceId,
          kind: "topic",
          key: topic,
          label: topic,
        });
        await upsertEdge({
          workspaceId: input.workspaceId,
          srcId: intentNode.id,
          dstId: topicNode.id,
          rel: "about",
        });
      }
    }
  } catch (err) {
    logger.warn({ err, runId: input.runId, intentId: input.intentId ?? null }, "Graph ingestion failed");
  }
}
