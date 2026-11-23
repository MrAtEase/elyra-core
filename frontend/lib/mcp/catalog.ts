/**
 * Curated MCP catalog shown in Workspace Admin › Marketplace.
 * Remote servers use Streamable HTTP; "oauth" = sign-in in the browser, "token" = API key / personal access token.
 * Endpoints taken from the vendors' own documentation (Nov 2026).
 */
export type CatalogEntry = {
  id: string;
  name: string;
  category: "Wissen & Doku" | "Projekte & Tickets" | "Entwicklung" | "Business & Zahlungen" | "Lokal";
  description: string;
  transport: "http" | "stdio";
  url?: string;
  auth: "oauth" | "token" | "none" | "oauth_or_token";
  tokenLabel?: string;
  tokenHelp?: string;
  command?: string;
  args?: string[];
  argLabel?: string;
  docs?: string;
};

export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "notion", name: "Notion", category: "Wissen & Doku",
    description: "Seiten und Datenbanken suchen, lesen, anlegen und bearbeiten.",
    transport: "http", url: "https://mcp.notion.com/mcp", auth: "oauth",
    docs: "https://developers.notion.com/docs/get-started-with-mcp",
  },
  {
    id: "linear", name: "Linear", category: "Projekte & Tickets",
    description: "Issues, Projekte und Zyklen abfragen und anlegen.",
    transport: "http", url: "https://mcp.linear.app/mcp", auth: "oauth_or_token", tokenLabel: "Linear API-Key (optional statt Anmeldung)",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "github", name: "GitHub", category: "Entwicklung",
    description: "Repos, Issues, Pull Requests und Code durchsuchen und bearbeiten.",
    transport: "http", url: "https://api.githubcopilot.com/mcp/", auth: "token",
    tokenLabel: "GitHub Personal Access Token", tokenHelp: "github.com → Settings → Developer settings → Personal access tokens",
    docs: "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server",
  },
  {
    id: "sentry", name: "Sentry", category: "Entwicklung",
    description: "Fehler, Releases und Performance-Probleme analysieren.",
    transport: "http", url: "https://mcp.sentry.dev/mcp", auth: "oauth",
  },
  {
    id: "stripe", name: "Stripe", category: "Business & Zahlungen",
    description: "Kunden, Rechnungen, Zahlungen und Produkte verwalten.",
    transport: "http", url: "https://mcp.stripe.com", auth: "oauth_or_token", tokenLabel: "Stripe Restricted API Key (optional statt Anmeldung)",
  },
  {
    id: "airtable", name: "Airtable", category: "Wissen & Doku",
    description: "Bases und Tabellen lesen und Einträge pflegen.",
    transport: "http", url: "https://mcp.airtable.com/mcp", auth: "oauth",
  },
  {
    id: "asana", name: "Asana", category: "Projekte & Tickets",
    description: "Aufgaben und Projekte in Asana abfragen und aktualisieren.",
    transport: "http", url: "https://mcp.asana.com/mcp", auth: "oauth",
  },
  {
    id: "intercom", name: "Intercom", category: "Business & Zahlungen",
    description: "Kundengespräche, Tickets und Kontakte durchsuchen.",
    transport: "http", url: "https://mcp.intercom.com/mcp", auth: "oauth",
  },
  {
    id: "deepwiki", name: "DeepWiki", category: "Entwicklung",
    description: "Dokumentation öffentlicher GitHub-Repos befragen – ohne Anmeldung.",
    transport: "http", url: "https://mcp.deepwiki.com/mcp", auth: "none",
  },
  {
    id: "context7", name: "Context7", category: "Entwicklung",
    description: "Aktuelle Doku zu Bibliotheken und Frameworks – ohne Anmeldung.",
    transport: "http", url: "https://mcp.context7.com/mcp", auth: "none",
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "filesystem", name: "Dateien (lokal)", category: "Lokal",
    description: "Dateien in einem Ordner auf deinem Mac lesen und schreiben.",
    transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], argLabel: "Ordner (absoluter Pfad)", auth: "none",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "playwright", name: "Browser (Playwright, lokal)", category: "Lokal",
    description: "Webseiten öffnen, klicken, ausfüllen und auslesen.",
    transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], auth: "none",
    docs: "https://github.com/microsoft/playwright-mcp",
  },
];

export function catalogEntry(id: string | null | undefined): CatalogEntry | undefined {
  return id ? MCP_CATALOG.find((e) => e.id === id) : undefined;
}
