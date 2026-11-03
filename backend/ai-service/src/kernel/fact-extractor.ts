import { callModel } from "../models/router.js";
import { db } from "../db/client.js";
import { logger } from "../lib/logger.js";

type ExtractedFact = {
  category: string;
  fact: string;
  confidence: number;
};

/**
 * Analyze a conversation turn and extract any noteworthy facts.
 * Runs asynchronously after each chat response — does NOT block the response.
 */
export async function extractFactsFromChat(
  workspaceId: string,
  userId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  try {
    const response = await callModel(
      `You extract factual information from conversations to build a knowledge base.
Given a user message and assistant response, extract any NEW facts about:
- People (names, roles, relationships)
- Dates/deadlines (when things happen)
- Preferences (likes, dislikes, habits)
- Decisions (choices made, plans confirmed)
- Business info (partners, suppliers, clients)

Respond with a JSON array of facts. Each fact: { "category": "...", "fact": "...", "confidence": 0.0-1.0 }
Categories: "person", "date", "preference", "decision", "business", "technical", "general"

If there are NO new facts worth storing, respond with an empty array: []
Only extract facts that would be useful to remember for future conversations.
Do NOT extract trivial facts like "user asked about calendar".`,
      `User: ${userMessage}\n\nAssistant: ${assistantResponse}`,
      { json: true },
    );

    let facts: ExtractedFact[];
    try {
      const parsed = JSON.parse(response.text);
      facts = Array.isArray(parsed) ? parsed : [];
    } catch {
      return; // No valid facts extracted
    }

    if (facts.length === 0) return;

    // Store facts
    const rows = facts
      .filter((f) => f.fact && f.fact.length > 3 && f.confidence >= 0.5)
      .slice(0, 5) // Max 5 facts per turn
      .map((f) => ({
        workspace_id: workspaceId,
        user_id: userId,
        category: f.category || "general",
        fact: f.fact.trim().slice(0, 500),
        confidence: Math.min(1, Math.max(0, f.confidence)),
        source_type: "chat",
      }));

    if (rows.length > 0) {
      const { error } = await db().from("knowledge_facts").insert(rows);
      if (error) {
        logger.warn({ error }, "Failed to store knowledge facts");
      } else {
        logger.info({ count: rows.length, workspaceId }, "Stored knowledge facts");
      }
    }
  } catch (err) {
    // Never fail the main flow — fact extraction is best-effort
    logger.warn({ err }, "Fact extraction failed");
  }
}

/**
 * Retrieve relevant facts for a workspace to include in context.
 */
export async function getRelevantFacts(
  workspaceId: string,
  userId: string,
  limit: number = 20,
): Promise<string> {
  try {
    const { data } = await db()
      .from("knowledge_facts")
      .select("category, fact, confidence")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .order("confidence", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return "";

    const grouped: Record<string, string[]> = {};
    for (const row of data) {
      const cat = (row.category as string) || "general";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(row.fact as string);
    }

    const lines = Object.entries(grouped)
      .map(([category, facts]) => `${category}: ${facts.join("; ")}`)
      .join("\n");

    return `\nKNOWLEDGE BASE (facts Elli has learned):\n${lines}`;
  } catch {
    return "";
  }
}
