import type {
  ActionSafety,
  ActionType,
  IntentAttachment,
  OrchestratorAction,
  OrchestratorPlan,
  PlanStep,
  WorkspaceViewMode,
} from "@/components/orchestrator/types";

const uid = () => Math.random().toString(36).slice(2, 9);

const toAction = (config: {
  type: ActionType;
  title: string;
  whatWillHappen: string;
  safety?: ActionSafety;
  inputs?: Record<string, string>;
  notes?: string;
  toolHint?: string;
}): OrchestratorAction => {
  const action: OrchestratorAction = {
    id: `act_${uid()}`,
    type: config.type,
    title: config.title,
    whatWillHappen: config.whatWillHappen,
    safety: config.safety ?? "confirm",
    status: "proposed",
    inputs: config.inputs ?? {},
    outputs: [],
  };
  if (config.notes) {
    action.notes = config.notes;
  }
  if (config.toolHint) {
    action.toolHint = config.toolHint;
  }
  return action;
};

const toStep = (config: {
  title: string;
  description: string;
  tool: string;
  actions: OrchestratorAction[];
}): PlanStep => ({
  id: `step_${uid()}`,
  title: config.title,
  description: config.description,
  tool: config.tool,
  status: "ready",
  actions: config.actions,
});

const inferFromSlashCommand = (text: string) => {
  const command = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (command === "/translate") {
    return "translate" as const;
  }
  if (command === "/image") {
    return "image" as const;
  }
  if (command === "/doc") {
    return "doc" as const;
  }
  if (command === "/email") {
    return "email" as const;
  }
  if (command === "/task") {
    return "task" as const;
  }
  if (command === "/calendar") {
    return "calendar" as const;
  }
  if (command === "/build") {
    return "build" as const;
  }
  return null;
};

const buildPlanFromIntent = (intent: string, mode: WorkspaceViewMode): OrchestratorPlan => {
  const normalized = intent.trim().toLowerCase();
  const slashKind = inferFromSlashCommand(intent);

  if (slashKind === "translate" || normalized.includes("übersetz") || normalized.includes("translate")) {
    return {
      intent,
      reason: "Ich glaube, du willst denselben Inhalt in einer anderen Sprache mit passendem Ton nutzen.",
      assumptions: ["Zielsprache ist Englisch, wenn nicht anders angegeben."],
      steps: [
        toStep({
          title: "Text erfassen",
          description: "Input sammeln und Sprachrichtung validieren.",
          tool: "Translate",
          actions: [
            toAction({
              type: "translate",
              title: "TranslateAction",
              whatWillHappen: "Ich übersetze den Inhalt in die gewünschte Sprache und halte den gewünschten Ton.",
              safety: "safe",
              inputs: { source: intent, targetLanguage: "English", tone: "Investor Update" },
              notes: "Connect to executor later",
            }),
          ],
        }),
        toStep({
          title: "Dokument bereitstellen",
          description: "Optional ein sharebares Draft-Dokument erzeugen.",
          tool: "Docs",
          actions: [
            toAction({
              type: "create_doc",
              title: "CreateDocAction",
              whatWillHappen: "Ich erstelle ein Draft-Dokument mit der übersetzten Version.",
              safety: "safe",
              inputs: { format: "Markdown", title: "Translated Draft" },
              notes: "Connect to executor later",
            }),
          ],
        }),
      ],
    };
  }

  if (slashKind === "image" || normalized.includes("bild") || normalized.includes("image") || normalized.includes("logo")) {
    return {
      intent,
      reason: "Ich glaube, du willst visuelle Varianten erzeugen und danach auswählen.",
      assumptions: ["Kostenpflichtige Bildgenerierung braucht Freigabe."],
      steps: [
        toStep({
          title: "Prompt vorbereiten",
          description: "Stil, Zweck und Format festlegen.",
          tool: "Image",
          actions: [
            toAction({
              type: "create_image",
              title: "CreateImageAction",
              whatWillHappen: "Ich generiere 3 Bildvarianten mit konsistentem Stil.",
              safety: "confirm_cost",
              inputs: { prompt: intent, size: "1792x1024", variants: "3" },
            }),
          ],
        }),
      ],
    };
  }

  if (slashKind === "email" || normalized.includes("e-mail") || normalized.includes("email") || normalized.includes("mail")) {
    return {
      intent,
      reason: "Ich glaube, du willst aus den Inputs eine sendefertige Kommunikation vorbereiten.",
      assumptions: ["Senden erfolgt erst nach Bestätigung."],
      steps: [
        toStep({
          title: "Draft schreiben",
          description: "Ton, Zielgruppe und CTA in eine klare Mailstruktur umsetzen.",
          tool: "Text",
          actions: [
            toAction({
              type: "create_text",
              title: "CreateTextAction",
              whatWillHappen: "Ich erzeuge einen professionellen E-Mail-Entwurf.",
              safety: "safe",
              inputs: { format: "email", tone: "professional", source: intent },
              notes: "Draft output local",
            }),
            toAction({
              type: "email",
              title: "EmailAction",
              whatWillHappen: "Ich lege den Entwurf im Mail-Modul als Draft ab.",
              safety: "confirm",
              inputs: { mode: "draft", mailbox: "primary" },
            }),
          ],
        }),
      ],
    };
  }

  if (slashKind === "calendar" || slashKind === "task" || normalized.includes("woche") || normalized.includes("calendar") || normalized.includes("task")) {
    return {
      intent,
      reason: "Ich glaube, du willst Prioritäten aus Aufgaben und Terminen in einen umsetzbaren Wochenplan bringen.",
      assumptions: ["Kalender- und Task-Zugriff muss verbunden sein."],
      steps: [
        toStep({
          title: "Kontext lesen",
          description: "Offene Aufgaben und nächste Termine laden.",
          tool: "Work",
          actions: [
            toAction({
              type: "task",
              title: "TaskAction",
              whatWillHappen: "Ich lese relevante offene Tasks und priorisiere sie.",
              safety: "safe",
              inputs: { mode: "prioritize" },
              notes: "Connect to executor later",
            }),
            toAction({
              type: "calendar",
              title: "CalendarAction",
              whatWillHappen: "Ich hole Zeitfenster und erkenne Konflikte.",
              safety: "safe",
              inputs: { mode: "suggest_times" },
              notes: "Connect to executor later",
            }),
          ],
        }),
        toStep({
          title: "Plan anwenden",
          description: "Neue Termine/Aufgaben als Vorschlag erzeugen.",
          tool: "Work",
          actions: [
            toAction({
              type: "calendar",
              title: "CalendarAction",
              whatWillHappen: "Ich erstelle oder verschiebe Events nach deiner Freigabe.",
              safety: "confirm",
              inputs: { mode: "create_or_move" },
            }),
            toAction({
              type: "task",
              title: "TaskAction",
              whatWillHappen: "Ich plane priorisierte Aufgaben in der Woche ein.",
              safety: "confirm",
              inputs: { mode: "schedule" },
            }),
          ],
        }),
      ],
    };
  }

  if (slashKind === "build" || normalized.includes("build") || normalized.includes("pr") || normalized.includes("spec")) {
    return {
      intent,
      reason: "Ich glaube, du willst Build-Arbeit strukturieren und direkt ausführbar machen.",
      assumptions: ["Build-Executor ist aktuell ein Placeholder."],
      steps: [
        toStep({
          title: "Build Scope klären",
          description: "Ziel, Constraints und Output definieren.",
          tool: "Build",
          actions: [
            toAction({
              type: "build",
              title: "BuildAction",
              whatWillHappen: "Ich erzeuge Spec + PR-Checklist als Draft.",
              safety: "safe",
              inputs: { mode: "generate_spec", output: "PR checklist" },
              notes: "Placeholder action",
            }),
          ],
        }),
      ],
    };
  }

  const workspaceHint = mode === "business" ? "im Team-Kontext" : "im privaten Kontext";

  return {
    intent,
    reason: `Ich glaube, du willst ${workspaceHint} ein Ergebnis ohne Tool-Konfiguration verlieren.`,
    assumptions: ["Ich starte mit einem editierbaren Vorschlag."],
    steps: [
      toStep({
        title: "Entwurf erzeugen",
        description: "Klares Ergebnis als lokales Draft vorbereiten.",
        tool: "Text",
        actions: [
          toAction({
            type: "create_text",
            title: "CreateTextAction",
            whatWillHappen: "Ich erstelle einen präzisen Textentwurf auf Basis deiner Anfrage.",
            safety: "safe",
            inputs: { source: intent, format: "snippet" },
            notes: "Draft output local",
          }),
        ],
      }),
    ],
  };
};

export const QUICK_COMMANDS = [
  { id: "text", label: "Text", command: "/text " },
  { id: "image", label: "Bild", command: "/image " },
  { id: "translate", label: "Uebersetzen", command: "/translate " },
  { id: "doc", label: "Dokument", command: "/doc " },
  { id: "email", label: "Mail", command: "/email " },
  { id: "calendar", label: "Kalender", command: "/calendar " },
  { id: "task", label: "Task", command: "/task " },
  { id: "build", label: "Build", command: "/build " },
] as const;

export const DEFAULT_ATTACHMENTS: IntentAttachment[] = [
  { id: "email-thread", label: "Use this email thread" },
  { id: "doc", label: "Use this doc" },
  { id: "calendar", label: "Use calendar" },
];

export const buildMockPlan = (intent: string, mode: WorkspaceViewMode) =>
  buildPlanFromIntent(intent, mode);
