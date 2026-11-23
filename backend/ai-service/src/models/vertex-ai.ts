import { VertexAI } from "@google-cloud/vertexai";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { IntentAttachment } from "../types/context.js";

export type ModelResponse = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
};

let _vertex: VertexAI | null = null;

function getClient(): VertexAI {
  if (_vertex) return _vertex;
  const { GCP_PROJECT_ID, GCP_LOCATION } = config();
  _vertex = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_LOCATION });
  return _vertex;
}

export async function callVertexAI(
  systemPrompt: string,
  userMessage: string,
  options?: { json?: boolean; attachments?: IntentAttachment[] },
): Promise<ModelResponse> {
  const { VERTEX_MODEL } = config();
  const model = getClient().getGenerativeModel({
    model: VERTEX_MODEL,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      ...(options?.json ? { responseMimeType: "application/json" } : {}),
    },
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
  });

  const attachmentParts = (options?.attachments ?? []).map((attachment) => {
    return {
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.dataBase64,
      },
    };
  });

  const start = Date.now();
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: userMessage }, ...attachmentParts] }],
  });

  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage = response.usageMetadata;

  logger.debug({ model: VERTEX_MODEL, durationMs: Date.now() - start }, "vertex-ai call");

  return {
    text,
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
    model: VERTEX_MODEL,
  };
}
