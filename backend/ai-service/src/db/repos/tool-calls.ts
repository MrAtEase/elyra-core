import { db } from "../client.js";
import type { ToolCall } from "../../types/run.js";

export async function createToolCall(tc: ToolCall): Promise<void> {
  const { error } = await db().from("ai_tool_calls").insert({
    id: tc.id,
    step_id: tc.stepId,
    model: tc.model,
    prompt_tokens: tc.promptTokens,
    completion_tokens: tc.completionTokens,
    cost_usd: tc.costUsd,
    duration_ms: tc.durationMs,
  });
  if (error) throw error;
}
