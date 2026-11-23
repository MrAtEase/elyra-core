/** Agenten-Team: gemeinsame Typen für Orchestrator, Agenten und API. */

export type AgentId =
  | "marketing" | "copy" | "design" | "presentation" | "coding"
  | "sea" | "reporting" | "seo" | "social" | "leads" | "competitor" | "tracking"
  | "application" | "mail" | "authority" | "research" | "coach"
  | "review" | "qa";

export type AgentCategory = "marketing" | "creative" | "personal" | "dev";

export type AgentStatus = "queued" | "running" | "done" | "failed";

/** Folien im Format der Slides-App (siehe frontend SlidesWindow DeckSlide). */
export type DeckSlide = {
  title: string;
  body: string;
  layout?: "title" | "bullets" | "two-col" | "stats" | "comparison" | "timeline" | "quote";
  bullets?: string[];
  stats?: Array<{ value: string; label: string }>;
  columns?: Array<{ heading: string; points: string[] }>;
  steps?: Array<{ label: string; detail?: string }>;
  quote?: { text: string; author?: string };
  notes?: string;
};

export type LogoVariant = { name: string; idea: string; svg: string };

export type DesignSpec = {
  /** Was geliefert wird: Logo-Entwürfe oder ein Seiten-/Anzeigen-Entwurf */
  deliverable: "logo" | "hero";
  palette: Array<{ name: string; hex: string }>;
  fonts: { heading: string; body: string };
  principles: string[];
  /** Eigenständiges HTML-Snippet (ohne Skripte) – wird im Frontend in einer Sandbox angezeigt. Leer bei Logos. */
  html: string;
  /** Vektor-Entwürfe (bereinigtes SVG) – nur bei deliverable "logo" */
  logos: LogoVariant[];
  /** Englische Prompts für das Bildmodell (Elyra Bilder-App) – nur bei deliverable "logo" */
  imagePrompts: string[];
};

export type CodeFile = { path: string; language: string; content: string };

export type AgentOutput =
  | { kind: "markdown"; markdown: string }
  | { kind: "design"; markdown: string; design: DesignSpec }
  | { kind: "deck"; markdown: string; deck: { title: string; slides: DeckSlide[] } }
  | { kind: "code"; markdown: string; files: CodeFile[] };

export type AgentTask = {
  agent: AgentId;
  /** Auftrag des Orchestrators an diesen Agenten */
  brief: string;
};

export type AgentState = {
  agent: AgentId;
  name: string;
  brief: string;
  phase: 1 | 2;
  status: AgentStatus;
  startedAt: string | null;
  finishedAt: string | null;
  model: string | null;
  /** "model" = KI-Ergebnis, "template" = Vorlage ohne KI (kein Modell erreichbar) */
  source: "model" | "template" | null;
  output: AgentOutput | null;
  error: string | null;
  revisions: number;
};

export type TeamRunStatus = "planning" | "running" | "merging" | "done" | "failed";

export type TeamRun = {
  id: string;
  /** "single" = ein Agent direkt beauftragt (ohne Planer/Zusammenführung), "team" = Orchestrator verteilt */
  mode: "single" | "team";
  /** Geprüfter Workspace (für lesende Werkzeuge wie Mail & Kalender) */
  workspaceId: string | null;
  task: string;
  context: string | null;
  status: TeamRunStatus;
  createdAt: string;
  plan: { summary: string; source: "model" | "rules" } | null;
  agents: AgentState[];
  final: { markdown: string; source: "model" | "rules" } | null;
  error: string | null;
};
