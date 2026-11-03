export type MerlinScope = "mail" | "tasks" | "calendar";

export type MerlinIntentId =
  | "summarize_mail"
  | "draft_reply"
  | "extract_tasks";

export type MerlinIntent = {
  id: MerlinIntentId;
  label: string;
  description?: string;
  scope: MerlinScope;
};

export const MAIL_INTENTS: MerlinIntent[] = [
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
