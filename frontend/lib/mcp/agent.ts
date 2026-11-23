/**
 * MCP assistant: Gemini plans and calls tools of the connected MCP servers (function calling).
 * Tools that are not marked read-only need the user's approval, unless "allowWrites" is set.
 */
import { getAiSettingsCached } from "@/lib/admin/controlCenter";
import { listServers, withClient } from "@/lib/mcp/store";
import { isReadOnlyTool, resultToText, type McpTool } from "@/lib/mcp/protocol";

export type AgentStep = { server: string; tool: string; args: Record<string, unknown>; ok: boolean; output: string };
export type PendingCall = { serverId: string; serverName: string; tool: string; args: Record<string, unknown>; reason: string };
export type AgentResult = { answer: string; steps: AgentStep[]; pending?: PendingCall; model: string };

type Fn = { serverId: string; serverName: string; tool: McpTool; fnName: string };

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
type Content = { role: "user" | "model"; parts: Part[] };

function cleanSchema(schema: unknown): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "$schema" || k === "$id" || k === "$comment") continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  const s = (strip(schema ?? {}) as Record<string, unknown>) ?? {};
  if (s.type !== "object") return { type: "object", properties: {} };
  return s;
}


async function gemini(model: string, system: string, contents: Content[], fns: Fn[], temperature: number) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY fehlt in .env.local");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(fns.length
        ? {
            tools: [{
              functionDeclarations: fns.map((f) => ({
                name: f.fnName,
                description: `[${f.serverName}] ${(f.tool.description ?? f.tool.title ?? f.tool.name).slice(0, 900)}`,
                parametersJsonSchema: cleanSchema(f.tool.inputSchema),
              })),
            }],
          }
        : {}),
      generationConfig: { temperature, maxOutputTokens: 4096 },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: Array<{ content?: Content }> };
  if (!res.ok || data.error) {
    const err = new Error(data.error?.message ?? `Gemini HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data.candidates?.[0]?.content ?? { role: "model" as const, parts: [] };
}

export async function runMcpAgent(input: {
  workspaceId: string;
  prompt: string;
  serverIds?: string[];
  allowWrites?: boolean;
  approvedCall?: { serverId: string; tool: string; args: Record<string, unknown> };
}): Promise<AgentResult> {
  const servers = (await listServers(input.workspaceId)).filter(
    (s) => s.enabled && s.status === "connected" && s.tools.length > 0 && (!input.serverIds?.length || input.serverIds.includes(s.id)),
  );
  if (servers.length === 0) throw new Error("Kein verbundener MCP-Server ausgewählt. Verbinde zuerst einen Dienst unter Workspace Admin › Marketplace.");

  const fns: Fn[] = [];
  servers.forEach((s, si) => {
    for (const tool of s.tools) {
      const fnName = `s${si}_${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
      fns.push({ serverId: s.id, serverName: s.name, tool, fnName });
    }
  });
  const limited = fns.slice(0, 128);

  const ai = await getAiSettingsCached(input.workspaceId).catch(() => null);
  const models = [ai?.model, process.env.GEMINI_MODEL, ...(process.env.GEMINI_FALLBACK_MODELS ?? "").split(",")]
    .map((m) => m?.trim())
    .filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);
  if (models.length === 0) models.push("gemini-3.5-flash-lite");

  const steps: AgentStep[] = [];
  const contents: Content[] = [];
  let userText = input.prompt;

  if (input.approvedCall) {
    const fn = limited.find((f) => f.serverId === input.approvedCall!.serverId && f.tool.name === input.approvedCall!.tool);
    const serverName = fn?.serverName ?? "MCP";
    try {
      const out = await withClient(input.workspaceId, input.approvedCall.serverId, (c) => c.callTool(input.approvedCall!.tool, input.approvedCall!.args));
      const text = resultToText(out, 8000);
      steps.push({ server: serverName, tool: input.approvedCall.tool, args: input.approvedCall.args, ok: !out.isError, output: text });
      userText += `\n\n[Vom Nutzer freigegeben und ausgeführt: ${input.approvedCall.tool}. Ergebnis:\n${text}]\nFahre fort und fasse das Ergebnis zusammen.`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ server: serverName, tool: input.approvedCall.tool, args: input.approvedCall.args, ok: false, output: message });
      userText += `\n\n[Die freigegebene Aktion ${input.approvedCall.tool} ist fehlgeschlagen: ${message}]`;
    }
  }
  contents.push({ role: "user", parts: [{ text: userText }] });

  const system = `Du bist Elly, die Assistentin in Elyra Core. Du hast Zugriff auf Werkzeuge verbundener Dienste (${servers.map((s) => s.name).join(", ")}).
Nutze die Werkzeuge, um die Aufgabe wirklich zu erledigen – erst suchen/lesen, dann handeln. Erfinde keine IDs; hole sie über Such-Werkzeuge.
Antworte am Ende knapp auf Deutsch in Markdown mit dem Ergebnis und, falls etwas angelegt wurde, den Links.
Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;

  let modelIdx = 0;
  for (let round = 0; round < 8; round++) {
    let reply: Content;
    try {
      reply = await gemini(models[modelIdx]!, system, contents, limited, ai?.temperature ?? 0.3);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if ((status === 429 || status === 503 || status === 404) && modelIdx < models.length - 1) { modelIdx++; round--; continue; }
      throw err;
    }
    contents.push({ role: "model", parts: reply.parts ?? [] });
    const calls = (reply.parts ?? []).filter((p) => p.functionCall);
    if (calls.length === 0) {
      const answer = (reply.parts ?? []).map((p) => p.text ?? "").join("").trim();
      return { answer: answer || "Fertig.", steps, model: models[modelIdx]! };
    }

    const responses: Part[] = [];
    for (const part of calls) {
      const call = part.functionCall!;
      const fn = limited.find((f) => f.fnName === call.name);
      const args = call.args ?? {};
      if (!fn) {
        responses.push({ functionResponse: { name: call.name, response: { error: "Unbekanntes Werkzeug" } } });
        continue;
      }
      if (!isReadOnlyTool(fn.tool) && !input.allowWrites) {
        const before = (reply.parts ?? []).map((p) => p.text ?? "").join("").trim();
        return {
          answer: before || `Ich möchte **${fn.tool.title ?? fn.tool.name}** in ${fn.serverName} ausführen. Bitte bestätige.`,
          steps,
          pending: { serverId: fn.serverId, serverName: fn.serverName, tool: fn.tool.name, args, reason: fn.tool.annotations?.destructiveHint ? "Löscht oder überschreibt Daten" : "Ändert Daten im Dienst" },
          model: models[modelIdx]!,
        };
      }
      try {
        const out = await withClient(input.workspaceId, fn.serverId, (c) => c.callTool(fn.tool.name, args));
        const text = resultToText(out, 12_000);
        steps.push({ server: fn.serverName, tool: fn.tool.name, args, ok: !out.isError, output: text });
        responses.push({ functionResponse: { name: call.name, response: out.isError ? { error: text } : { result: text } } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ server: fn.serverName, tool: fn.tool.name, args, ok: false, output: message });
        responses.push({ functionResponse: { name: call.name, response: { error: message } } });
      }
    }
    contents.push({ role: "user", parts: responses });
  }
  return { answer: "Abgebrochen: zu viele Schritte. Bitte die Aufgabe genauer beschreiben.", steps, model: models[modelIdx]! };
}
