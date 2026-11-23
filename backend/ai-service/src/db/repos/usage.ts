import { db } from "../client.js";

export async function incrementUsage(
  workspaceId: string,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Upsert daily usage
  const { error } = await db().rpc("ai_increment_usage", {
    p_workspace_id: workspaceId,
    p_date: today,
    p_prompt_tokens: promptTokens,
    p_completion_tokens: completionTokens,
    p_cost_usd: costUsd,
  });

  // Fallback: if RPC doesn't exist yet, do manual upsert
  if (error) {
    await db()
      .from("ai_usage_daily")
      .upsert(
        {
          workspace_id: workspaceId,
          date: today,
          total_prompt_tokens: promptTokens,
          total_completion_tokens: completionTokens,
          total_cost_usd: costUsd,
          request_count: 1,
        },
        { onConflict: "workspace_id,date" },
      );
  }
}
