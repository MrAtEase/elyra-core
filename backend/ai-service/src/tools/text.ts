import { registerTool } from "./registry.js";
import { callModel } from "../models/router.js";
import { config } from "../config.js";

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
    `Du bist Elly, die KI-Assistentin im Elyra OS (Modell: ${config().GEMINI_MODEL || "unbekannt"}). ` +
      `Der folgende Text ist eine Frage oder Aufgabe des Users – beantworte bzw. erledige sie direkt. ` +
      `Bestätige keine Anweisungen ("Verstanden" o. Ä.), sprich den User nicht mit "Elly" an. ` +
      `Stil: ${style}, kurz und klar, in der Sprache des Users.`,
    prompt,
  );
  return { text: response.text };
});
