import { callModel } from "../models/router.js";
import type { OrchestratorPlan } from "../types/plan.js";
import { logger } from "../lib/logger.js";
import { listTools } from "../tools/index.js";

// ── Intent domain keywords (order matters — more specific first) ───────────────

type IntentDomain =
  | "weather"
  | "mail"
  | "calendar"
  | "task"
  | "file"
  | "builder"
  | "slides"
  | "general_chat";

const DOMAIN_KEYWORDS: Record<IntentDomain, string[]> = {
  // Most specific first to avoid misclassification
  slides: [
    "slide", "slides", "pitchdeck", "pitch deck", "pitch-deck",
    "presentation", "präsentation", "ppt", "folien", "deck",
    "keynote", "powerpoint", "marketing deck", "marketingdeck",
  ],
  mail: [
    "mail", "email", "e-mail", "reply", "posteingang", "nachricht senden",
    "inbox", "antwort schreiben", "draft", "absenden",
  ],
  calendar: [
    "calendar", "meeting", "schedule", "termin", "kalender", "agenda",
    "appointment", "besprechung", "treffen buchen",
  ],
  task: [
    "task", "todo", "aufgabe", "erledigen", "to-do",
    "aufgabenliste", "backlog", "ticket erstellen",
  ],
  file: [
    "file", "files", "doc", "dokument", "drive", "ordner",
    "upload", "google drive", "spreadsheet", "tabelle",
    "scan", "repo", "repository", "review", "überblick", "analyse",
    "codebase", "projektdaten",
  ],
  builder: [
    "build", "workflow", "automation", "pipeline", "automatisierung",
    "zap", "make", "zapier",
  ],
  weather: [
    "wetter", "forecast", "temperature", "temperatur", "rain", "regen",
    "morgen früh", "heute nachmittag", "wind", "grad celsius",
    "wie ist das wetter", "wird es regnen",
  ],
  general_chat: [], // catch-all
};

function classifyIntentDomain(text: string): IntentDomain {
  const lowered = text.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[IntentDomain, string[]]>) {
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      return domain;
    }
  }
  return "general_chat";
}

function classifyIntentKind(text: string): "read_only" | "mutation" {
  const READ_ONLY_TERMS = ["summarize", "show", "search", "list", "analyze", "preview"];
  const MUTATION_TERMS = ["send", "delete", "modify", "create", "schedule", "publish", "erstell", "mach", "schreib"];
  const lowered = text.toLowerCase();
  if (MUTATION_TERMS.some((term) => lowered.includes(term))) return "mutation";
  if (READ_ONLY_TERMS.some((term) => lowered.includes(term))) return "read_only";
  return "read_only";
}

function extractWeatherLocation(text: string): string | null {
  // More precise: only match explicit weather location patterns
  const patterns = [
    /(?:wetter|forecast|weather)\s+(?:in|für|für die|im)\s+([A-Za-zäöüÄÖÜß]{2,30})/i,
    /(?:in|im)\s+([A-Za-zäöüÄÖÜß]{2,30})\s+(?:wetter|regnet|grad|forecast)/i,
    /(?:für die Stadt|für)\s+([A-Za-zäöüÄÖÜß]{2,30})\s+(?:wetter|forecast)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

// ── System prompt for LLM-based plan generation ────────────────────────────────

function buildSystemPrompt(domain: IntentDomain, contextSummary?: string): string {
  const contextBlock = contextSummary
    ? `\nWorkspace context:\n${contextSummary}\n`
    : "";

  return `You are Elly, the Elyra OS AI orchestrator. The user's request domain is: ${domain}.
${contextBlock}
Available tools:
- calendar.list — List calendar events (params: timeMin, timeMax)
- calendar.create — Create a calendar event (params: summary, start, end, description?)
- gmail.list — List email threads (params: query?, maxResults?)
- gmail.send — Send an email (params: to, subject, body)
- gmail.reply — Reply to an email thread (params: threadId, body)
- tasks.list — List tasks (params: status?)
- tasks.create — Create a task (params: title, dueDate?, description?)
- drive.list — List files in Google Drive (params: query?, maxResults?)
- drive.create — Create a file in Google Drive (params: name, content, mimeType?)
- slides.create — Create a Google Slides presentation (params: title, slides[{title, bullets}])
- text.summarize — Summarize or analyze text (params: text)
- text.draft — Draft or generate text content (params: prompt, style?)
- weather.getForecast — ONLY for actual weather requests (params: location)

IMPORTANT RULES:
- For presentations/pitchdeck: use slides.create with meaningful slide content, NOT weather
- For simple questions/chat: use text.draft with the answer directly
- For "plan" in the context of business planning: use slides.create or text.draft
- NEVER use weather.getForecast unless the user explicitly asks about weather conditions
- German requests: understand "erstell" = create, "zeig" = show, "schreib" = write
- Keep plans to 1-3 steps maximum
- Set requiresApproval: true only for: send email, delete, publish publicly

Respond with valid JSON ONLY:
{
  "summary": "Brief description of what you will do",
  "steps": [
    {
      "index": 0,
      "toolName": "tool.action",
      "label": "Human-readable step label in the user's language",
      "input": { ...tool params... },
      "requiresApproval": false
    }
  ]
}`;
}

const WEATHER_TOOL_NAME = "weather.getForecast";

// ── General chat — direct answer, summary IS the response ─────────────────────

async function buildDirectChatPlan(prompt: string, attachments: any[] = []): Promise<OrchestratorPlan> {
  const CHAT_SYSTEM = `Du bist Elly, die KI-Assistentin im Elyra OS. Antworte direkt, präzise und hilfreich auf Deutsch (oder der Sprache des Users). Keine unnötigen Einleitungen. Sei kurz und hilfreich.`;
  try {
    const response = await callModel(CHAT_SYSTEM, prompt, { attachments });
    return {
      // summary becomes the final displayed text when steps is empty
      summary: response.text.trim(),
      steps: [],
    };
  } catch {
    return {
      summary: "Entschuldigung, ich konnte keine Antwort generieren. Bitte versuche es erneut.",
      steps: [],
    };
  }
}

// ── Main intent parser ────────────────────────────────────────────────────────

export async function parseIntent(
  prompt: string,
  contextSummary?: string,
  attachments: any[] = [],
): Promise<{ plan: OrchestratorPlan; promptTokens: number; completionTokens: number; model: string }> {
  const domain = classifyIntentDomain(prompt);
  const availableTools = new Set(listTools());

  // ── General chat: answer directly, no planning ──────────────────────────────
  if (domain === "general_chat") {
    const plan = await buildDirectChatPlan(prompt, attachments);
    return { plan, promptTokens: 0, completionTokens: 0, model: "direct_chat" };
  }

  // ── Weather: fast-path with location extraction ────────────────────────────
  if (domain === "weather") {
    if (!availableTools.has(WEATHER_TOOL_NAME)) {
      return {
        plan: {
          summary: "Wetter-Tool nicht aktiv",
          steps: [],
        },
        promptTokens: 0,
        completionTokens: 0,
        model: "weather",
      };
    }
    const location = extractWeatherLocation(prompt);
    if (!location) {
      // No clear location → ask user
      return {
        plan: {
          summary: "Für welche Stadt möchtest du das Wetter wissen?",
          steps: [],
        },
        promptTokens: 0,
        completionTokens: 0,
        model: "weather",
      };
    }
    return {
      plan: {
        summary: `Wetter für ${location}`,
        steps: [{
          index: 0,
          toolName: WEATHER_TOOL_NAME,
          label: `Wetter in ${location}`,
          input: { location },
          requiresApproval: false,
        }],
      },
      promptTokens: 0,
      completionTokens: 0,
      model: "weather",
    };
  }

  // ── All other domains: LLM-generated plan ─────────────────────────────────
  const systemPrompt = buildSystemPrompt(domain, contextSummary);
  const response = await callModel(systemPrompt, prompt, { json: true, attachments });

  let plan: OrchestratorPlan;
  try {
    const raw = response.text.trim();
    // Strip markdown code fences if present
    const jsonStr = raw.startsWith("```") ? raw.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim() : raw;
    plan = JSON.parse(jsonStr) as OrchestratorPlan;

    // Safety: reject weather steps (domain is never "weather" here — handled above)
    plan.steps = plan.steps.filter((s) => s.toolName !== "weather.getForecast");

    // If all steps got filtered out and it wasn't intentional, add a text.draft fallback
    if (plan.steps.length === 0 && !plan.summary.includes("?")) {
      plan.steps = [{
        index: 0,
        toolName: "text.draft",
        label: "Antwort generieren",
        input: { prompt },
        requiresApproval: false,
      }];
    }
  } catch {
    logger.warn({ text: response.text }, "Failed to parse plan JSON, using text.draft fallback");
    plan = {
      summary: "Deine Anfrage wird bearbeitet",
      steps: [{
        index: 0,
        toolName: "text.draft",
        label: "Antwort generieren",
        input: { prompt },
        requiresApproval: false,
      }],
    };
  }

  return {
    plan,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    model: response.model,
  };
}

export { classifyIntentDomain };
