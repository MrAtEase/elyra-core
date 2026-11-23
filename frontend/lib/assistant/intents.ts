export type EllyScope = "mail" | "tasks" | "calendar";

export type EllyIntentId =
  | "summarize_mail"
  | "draft_reply"
  | "extract_tasks";

export type EllyIntent = {
  id: EllyIntentId;
  label: string;
  description?: string;
  scope: EllyScope;
};

export const MAIL_INTENTS: EllyIntent[] = [
  {
    id: "summarize_mail",
    label: "Zusammenfassen",
    description: "Kurze Zusammenfassung der Mail",
    scope: "mail",
  },
  {
    id: "draft_reply",
    label: "Antwort entwerfen",
    description: "Professionelle Antwort vorschlagen",
    scope: "mail",
  },
  {
    id: "extract_tasks",
    label: "Aufgaben extrahieren",
    description: "To-dos aus der Mail ableiten",
    scope: "mail",
  },
];
