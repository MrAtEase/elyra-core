import type { AppCategory } from "@/components/os/kernel/types";
import { TEMPLATES } from "@/lib/marketplace/templates";

/** Template categories → app categories used in the launcher and the Apps tab. */
const TEMPLATE_TO_APP: Record<string, AppCategory> = {
  Finanzen: "utility",
  Gesundheit: "utility",
  Zuhause: "utility",
  Reisen: "utility",
  Freizeit: "utility",
  Arbeit: "productivity",
  Lernen: "insights",
  Schreiben: "create",
};

const KEYWORDS: Array<[AppCategory, RegExp]> = [
  ["marketing", /\b(ads?|kampagne|seo|sea|marketing|leads?|newsletter|social|conversion|shop|feed|kunden)/i],
  ["productivity", /\b(aufgabe|projekt|kanban|termin|kalender|bewerbung|team|meeting|crm|planer|tracker|bericht)/i],
  ["insights", /\b(lern|karteikarte|prüfung|wissen|recherche|quiz|vokabel)/i],
  ["create", /\b(schreib|text|buch|tagebuch|design|bild|präsentation|story)/i],
];

/** Which launcher category a mini-app belongs to (template first, then keywords). */
export function miniAppCategory(app: { name: string; description?: string | null }): AppCategory {
  const name = app.name.trim().toLowerCase();
  const template = TEMPLATES.find((t) => t.name.trim().toLowerCase() === name);
  if (template) return TEMPLATE_TO_APP[template.category] ?? "utility";
  const text = `${app.name} ${app.description ?? ""}`;
  for (const [category, pattern] of KEYWORDS) if (pattern.test(text)) return category;
  return "utility";
}
