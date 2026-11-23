import type { IntentRouteResult } from "@/components/os/kernel/types";
import { routeGoldenPathIntent } from "@/lib/demo/goldenPath";

const READ_ONLY_TERMS = ["summarize", "show", "search", "list", "analyze", "preview"];
const MUTATION_TERMS = ["send", "delete", "modify", "create", "schedule", "publish"];

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
  weather: ["wetter", "forecast", "temperature", "rain", "morgen", "today", "tomorrow", "wind", "grad", "surf", "swell", "wellen", "tide"],
  mail: ["mail", "email", "inbox", "posteingang", "nachricht", "reply", "antwort"],
  calendar: ["calendar", "meeting", "schedule", "termin", "kalender", "agenda", "besprechung"],
  task: ["task", "todo", "aufgabe", "todo-liste", "erledigen", "plan", "tasklist"],
  file: ["file", "files", "datei", "dokument", "drive", "ablage", "ordner"],
  builder: ["build", "workflow", "automation", "pipeline"],
  slides: ["slide", "deck", "presentation", "ppt", "folien"],
  general_chat: [],
};

function classifyDomain(text: string): IntentDomain {
  const lowered = text.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[IntentDomain, string[]]>) {
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      return domain;
    }
  }
  return "general_chat";
}

function classifyIntentKind(text: string): "read_only" | "mutation" {
  const lowered = text.toLowerCase();
  if (MUTATION_TERMS.some((term) => lowered.includes(term))) return "mutation";
  if (READ_ONLY_TERMS.some((term) => lowered.includes(term))) return "read_only";
  return "read_only";
}

function toTimeline(
  prefix: string,
  requiresConfirmation = false,
): IntentRouteResult["timeline"] {
  return [
    { id: `${prefix}-plan`, label: "PLAN", detail: "Understand scope and choose path." },
    { id: `${prefix}-gather`, label: "GATHER", detail: "Collect relevant workspace context." },
    {
      id: `${prefix}-draft`,
      label: requiresConfirmation ? "CONFIRM" : "DRAFT",
      detail: requiresConfirmation
        ? "Await approval before applying mutation."
        : "Prepare read-only output for review.",
      requiresConfirmation,
    },
  ];
}

export function routeIntent(text: string): IntentRouteResult {
  const demo = routeGoldenPathIntent(text);
  if (demo) return demo;

  const intentKind = classifyIntentKind(text);
  const requiresConfirmation = intentKind === "mutation";
  const domain = classifyDomain(text);

  if (domain === "weather") {
    return {
      intentKind,
      openApp: "weather",
      assistantText:
        "Oeffne die Wetter-App -- Surf-Forecast, Gezeitenzeiten und Wind fuer deinen Standort.\n\nFalls kein Standort gesetzt ist, wird Lissabon / Costa da Caparica als Standard verwendet.",
      timeline: toTimeline("weather", requiresConfirmation),
    };
  }

  if (domain === "mail") {
    return {
      intentKind,
      openApp: "mail",
      assistantText:
        intentKind === "mutation"
          ? "I prepared reply drafts. Confirm send to execute the mutation."
          : "I summarized unread threads and prepared reply drafts in Mail.",
      actionCards:
        intentKind === "mutation"
          ? [
              { id: "mail-1", title: "Review Draft Replies", detail: "Check tone and recipients." },
              { id: "mail-2", title: "Confirm Send", detail: "Send selected drafts." },
            ]
          : [
              { id: "mail-draft-1", title: "Draft: Client update", detail: "Concise progress update." },
              { id: "mail-draft-2", title: "Draft: Follow-up", detail: "Action items and next steps." },
            ],
      timeline: toTimeline("mail", requiresConfirmation),
    };
  }

  if (domain === "calendar") {
    const actionCards =
      intentKind === "mutation"
        ? [
            { id: "cal-1", title: "Check availability", detail: "This week, 45-minute slot." },
            { id: "cal-2", title: "Confirm event creation", detail: "Create event with attendees." },
          ]
        : null;
    return {
      intentKind,
      openApp: "calendar",
      assistantText:
        intentKind === "mutation"
          ? "I prepared scheduling details. Confirm before creating events."
          : "I analyzed availability and suggested open slots.",
      timeline: toTimeline("calendar", requiresConfirmation),
      ...(actionCards ? { actionCards } : {}),
    };
  }

  if (domain === "task") {
    const actionCards =
      intentKind === "mutation"
        ? [
            { id: "task-1", title: "Review task list", detail: "Today + upcoming buckets." },
            { id: "task-2", title: "Confirm task update", detail: "Apply changes to workspace tasks." },
          ]
        : null;
    return {
      intentKind,
      openApp: "tasks",
      assistantText:
        intentKind === "mutation"
          ? "I prepared a task plan. Confirm to write changes."
          : "I translated your request into a prioritized checklist.",
      timeline: toTimeline("tasks", requiresConfirmation),
      ...(actionCards ? { actionCards } : {}),
    };
  }

  if (domain === "builder") {
    const actionCards =
      intentKind === "mutation"
        ? [
            { id: "build-1", title: "Select trigger", detail: "Inbox event, schedule, or manual." },
            { id: "build-2", title: "Confirm workflow creation", detail: "Create workflow chain." },
          ]
        : null;
    return {
      intentKind,
      openApp: "builder",
      assistantText:
        intentKind === "mutation"
          ? "Workflow scaffold is ready. Confirm to create it."
          : "I prepared a workflow preview in Builder.",
      timeline: toTimeline("builder", requiresConfirmation),
      ...(actionCards ? { actionCards } : {}),
    };
  }

  if (domain === "slides") {
    const actionCards =
      intentKind === "mutation"
        ? [
            { id: "slides-1", title: "Review generated deck", detail: "Inspect structure and narrative." },
            { id: "slides-2", title: "Confirm publish", detail: "Save artifact and share." },
          ]
        : [
            { id: "slides-preview", title: "Open recent deck", detail: "See latest generated slides." },
          ];
    return {
      intentKind,
      openApp: "slides",
      assistantText:
        intentKind === "mutation"
          ? "I prepared a slide deck draft. Confirm before publishing."
          : "I generated a slide deck draft and opened Slides.",
      timeline: toTimeline("slides", requiresConfirmation),
      actionCards,
    };
  }

  if (domain === "file") {
    const actionCards =
      intentKind === "mutation"
        ? [
            { id: "files-1", title: "Find relevant docs", detail: "Filter by recency and owner." },
            { id: "files-2", title: "Confirm file operation", detail: "Apply mutation." },
          ]
        : null;
    return {
      intentKind,
      openApp: "files",
      assistantText:
        intentKind === "mutation"
          ? "I prepared a file operation. Confirm to continue."
          : "I opened Files and prepared a read-only review summary.",
      timeline: toTimeline("files", requiresConfirmation),
      ...(actionCards ? { actionCards } : {}),
    };
  }

  return {
    intentKind,
    assistantText: "Ich kann dir hier direkt antworten. Sag mir einfach, was du brauchst.",
    timeline: toTimeline("general", requiresConfirmation),
  };
}
