import { registerTool } from "./registry.js";
import { callModel } from "../models/router.js";

registerTool("text.summarize", async (input) => {
  const text = input["text"] as string;
  const response = await callModel(
    "You are a concise summarizer. Summarize the following text in 2-3 sentences.",
    text,
  );
  return { text: response.text };
});

registerTool("text.draft", async (input) => {
  const prompt = input["prompt"] as string;
  const style = (input["style"] as string) ?? "professional";
  const response = await callModel(
    `You are a helpful writing assistant. Write in a ${style} style. Be concise and clear.`,
    prompt,
  );
  return { text: response.text };
});
