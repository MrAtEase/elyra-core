import {
  DevTask,
  FeaturePlanInput,
  FeaturePlanResult,
  FeaturePlanStep,
  PlannedSessionConfig,
  PlannedSessionDefaults,
  RepoOverview,
  PlannedTask,
  DevTaskMode,
} from "./devTaskTypes";
import path from "node:path";
import { promises as fs } from "node:fs";

declare const fetch: typeof globalThis.fetch;

export interface CodexCallParams {
  task: DevTask;
  prompt: string;
  selectedCode: string;
}

interface OpenAIOutputContent {
  type: string;
  text?: string;
}

interface OpenAIOutputItem {
  type?: string;
  content?: OpenAIOutputContent[];
}

interface OpenAIResponse {
  output?: OpenAIOutputItem[];
}

/**
 * Ruft das OpenAI-Codex-Modell für eine einzelne Dev-Task auf
 * und gibt NUR den neuen Code für die Selektion zurück.
 */
export async function callCodexForTask(params: CodexCallParams): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set in environment");
  }

  const systemMessage =
    "Du bist ein autonomer Senior-Softwareentwickler (Codex-Agent), der als Worker in einer Tooling-Pipeline läuft. " +
    "Du bekommst eine Aufgabe, einen Modus und einen Codeausschnitt und sollst AUSSCHLIESSLICH den neuen Code für die Selektion zurückgeben. " +
    "Keine Erklärungen, kein Markdown, keine JSON-Struktur. Der erste und letzte Character deiner Ausgabe müssen Code sein.";

  const body = {
    model: "gpt-5.1-codex",
    input: [
      {
        role: "system",
        content: systemMessage,
      },
      {
        role: "user",
        content: params.prompt,
      },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("OpenAI HTTP error:", response.status, text);
    throw new Error(`OpenAI HTTP ${response.status}`);
  }

  let data: OpenAIResponse;
  try {
    data = (await response.json()) as OpenAIResponse;
  } catch (err) {
    console.error("Failed to parse OpenAI JSON response:", err);
    throw new Error("Failed to parse OpenAI JSON response");
  }

  const outputItems = data.output ?? [];
  const messageItem = outputItems.find((item) => item.type === "message");

  if (!messageItem || !Array.isArray(messageItem.content)) {
    console.error("OpenAI response missing message content:", data);
    throw new Error("OpenAI response missing message content");
  }

  const textItem = messageItem.content.find(
    (c) => c.type === "output_text" && typeof c.text === "string",
  );

  if (!textItem || !textItem.text) {
    console.error("OpenAI response missing output_text:", data);
    throw new Error("OpenAI response missing output_text");
  }

  const newCode = textItem.text.trim();

  if (!newCode) {
    throw new Error("OpenAI returned empty code");
  }

  return newCode;
}

function parseJsonFromText(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Failed to parse JSON from LLM response");
  }
}

export async function planFeatureDevTasks(input: FeaturePlanInput): Promise<FeaturePlanResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set in environment");
  }

  const systemMessage =
    "You are a senior software planner for a monorepo called elyra-core (Next.js frontend, worker agent, dashboard). " +
    "Given a feature description, produce a concise JSON plan of development steps. Each step should map cleanly to a DevTask with file hints.";

  const userPrompt = [
    `Feature ID: ${input.id}`,
    `Feature Name: ${input.featureName}`,
    `Description: ${input.description}`,
    `Project Root: ${input.projectRoot}`,
    `Default Mode: ${input.defaultMode ?? "refactor"}`,
    "",
    "Return ONLY JSON with shape:",
    `{"featureId": "...","featureName": "...","description": "...","steps":[{"id":"step-1","title":"...","description":"...","targetFile":"...","mode":"refactor","estimatedRisk":"low"}]}`,
    "Use ISO timestamp for createdAt. Keep steps short and actionable.",
  ].join("\n");

  const body = {
    model: "gpt-5.1-codex",
    input: [
      { role: "system", content: systemMessage },
      { role: "user", content: userPrompt },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  const outputItems = json.output ?? [];
  const messageItem = outputItems.find((item: any) => item.type === "message");
  const textItem = messageItem?.content?.find(
    (c: any) => c.type === "output_text" && typeof c.text === "string"
  );
  if (!textItem?.text) {
    throw new Error("LLM plan response missing text");
  }

  let planRaw: any;
  try {
    planRaw = parseJsonFromText(textItem.text.trim());
  } catch (err) {
    throw new Error(`Failed to parse feature plan JSON: ${(err as Error).message}`);
  }

  const plan: FeaturePlanResult = {
    featureId: planRaw.featureId || input.id,
    featureName: planRaw.featureName || input.featureName,
    description: planRaw.description || input.description,
    steps: Array.isArray(planRaw.steps) ? (planRaw.steps as FeaturePlanStep[]) : [],
    createdAt: planRaw.createdAt || new Date().toISOString(),
  };

  return plan;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "session";
}

function pickMode(goal: string, defaults?: PlannedSessionDefaults): DevTaskMode {
  if (defaults?.mode) return defaults.mode;
  const lower = goal.toLowerCase();
  if (lower.includes("fix") || lower.includes("bug")) return "fix";
  if (lower.includes("test")) return "tests";
  if (lower.includes("doc")) return "docs";
  if (lower.includes("feature")) return "feature";
  if (lower.includes("refactor")) return "refactor";
  return "mini";
}

export async function planDevSession(
  goal: string,
  repo: RepoOverview,
  defaults?: PlannedSessionDefaults
): Promise<PlannedSessionConfig> {
  const sessionId = `${slugify(goal)}-${Date.now()}`;
  const mode = pickMode(goal, defaults);
  const files = repo.files
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .slice(0, 12);

  const tasks: PlannedTask[] = files.slice(0, 6).map((file, idx) => ({
    id: `${slugify(path.basename(file)) || "task"}-${idx + 1}`,
    file,
    goal: `Update ${file} to support: ${goal}`,
    mode,
  }));

  if (tasks.length === 0) {
    tasks.push({
      id: "general-1",
      file: "README.md",
      goal: `Plan task based on goal: ${goal}`,
      mode,
    });
  }

  return {
    sessionId,
    projectRoot: repo.projectRoot,
    defaults: { mode, ...defaults },
    tasks,
  };
}

export async function generatePlanFromDescription(description: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  const sessionId = `plan-${Date.now()}`;

  const systemMessage =
    "You are a senior engineer creating Dev Plans for the elyra-core monorepo. " +
    "A Dev Plan is a JSON file with fields: id, label, projectRoot, writeMode, safetyLevel, git, steps[]. " +
    "Each step is either {type:\"session\", id, label, sessionConfigPath} or {type:\"check\", id, label, check:{command, cwd, continueOnFail}}. " +
    "Return ONLY JSON, no markdown, no code fences.";

  const userMessage = [
    `Description: ${description}`,
    "Default projectRoot: /Users/paulodak/Projects/elyra-core",
    "Default writeMode: preview",
    "Default safetyLevel: strict",
    "Produce 2-4 steps mixing sessions (existing configs under worker/sessions/) and checks (npm test, npm run lint, npx tsc).",
  ].join("\n");

  if (!apiKey) {
    // Fallback: create a deterministic stub plan
    return {
      id: sessionId,
      label: description.slice(0, 60) || "Generated Plan",
      projectRoot: "/Users/paulodak/Projects/elyra-core",
      writeMode: "preview",
      safetyLevel: "strict",
      steps: [
        {
          type: "session",
          id: "auto-session-1",
          label: "Autogenerated session",
          sessionConfigPath: "worker/sessions/example-hardening.json",
        },
        {
          type: "check",
          id: "auto-check-1",
          label: "npm test",
          check: { command: "npm test", cwd: "frontend", continueOnFail: false },
        },
      ],
      git: { autoCommit: false },
    };
  }

  const body = {
    model: "gpt-5.1-codex",
    input: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  const outputItems = json.output ?? [];
  const messageItem = outputItems.find((item: any) => item.type === "message");
  const textItem = messageItem?.content?.find(
    (c: any) => c.type === "output_text" && typeof c.text === "string"
  );
  if (!textItem?.text) {
    throw new Error("LLM plan response missing text");
  }
  const raw = textItem.text.trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Failed to parse plan JSON from LLM output");
    parsed = JSON.parse(match[0]);
  }
  parsed.id = parsed.id || sessionId;
  parsed.projectRoot = parsed.projectRoot || "/Users/paulodak/Projects/elyra-core";
  parsed.writeMode = parsed.writeMode || "preview";
  parsed.safetyLevel = parsed.safetyLevel || "strict";
  return parsed;
}
