export type ModuleStatus = "connected" | "needs_connect" | "error" | "unknown";

export type ModuleCategory = {
  id: string;
  label: string;
  route: string;
  sort: number;
};

export type ModuleRegistryItem = {
  id: string;
  label: string;
  category: string;
  route: string;
  provider?: string;
  requiresAuth?: boolean;
  sort?: number;
  badge?: string;
  status: ModuleStatus;
};

export const MODULE_CATEGORIES: ModuleCategory[] = [
  { id: "workspace", label: "Dashboard", route: "/workspace", sort: 10 },
  { id: "calendar", label: "Calendar", route: "/workspace/work/calendar", sort: 20 },
  { id: "mail", label: "Mail", route: "/workspace/work/mail", sort: 30 },
  { id: "tasks", label: "Tasks", route: "/workspace/work/tasks", sort: 40 },
  { id: "docs", label: "Docs & Slides", route: "/workspace/work/docs", sort: 50 },
  { id: "sales", label: "Sales", route: "/workspace/business/sales", sort: 60 },
  { id: "hr", label: "HR", route: "/workspace/business/hr", sort: 70 },
  { id: "marketing", label: "Marketing", route: "/workspace/business/marketing", sort: 80 },
  { id: "build", label: "Build", route: "/workspace/build/overview", sort: 90 },
  { id: "automations", label: "Automations", route: "/workspace/build/automations", sort: 100 },
  { id: "reasoning", label: "Reasoning", route: "/workspace/build/reasoning", sort: 110 },
  { id: "integrations", label: "Integrations", route: "/workspace/build/integrations", sort: 120 },
  { id: "marketplace", label: "Marketplace", route: "/workspace/marketplace/discover", sort: 130 },
  { id: "settings", label: "Settings", route: "/workspace/settings", sort: 140 },
  { id: "planner", label: "Planner", route: "/workspace/planner", sort: 200 },
  { id: "comm", label: "Comm", route: "/workspace/comm", sort: 210 },
  { id: "dev", label: "Dev", route: "/workspace/dev", sort: 220 },
  { id: "knowledge", label: "Knowledge", route: "/workspace/knowledge", sort: 230 },
];

const MODULES: ModuleRegistryItem[] = [
  {
    id: "gmail",
    label: "Gmail",
    category: "comm",
    route: "/workspace/comm/gmail",
    provider: "Google",
    requiresAuth: true,
    sort: 10,
    status: "needs_connect",
    badge: "Connect",
  },
  {
    id: "slack",
    label: "Slack",
    category: "comm",
    route: "/workspace/comm/slack",
    provider: "Slack",
    requiresAuth: true,
    sort: 20,
    status: "connected",
  },
  {
    id: "hubspot",
    label: "HubSpot",
    category: "comm",
    route: "/workspace/comm/hubspot",
    provider: "HubSpot",
    requiresAuth: true,
    sort: 30,
    status: "error",
    badge: "Audit",
  },
  {
    id: "planner-crm",
    label: "CRM",
    category: "planner",
    route: "/workspace/planner/crm",
    provider: "HubSpot",
    requiresAuth: true,
    sort: 10,
    status: "connected",
    badge: "Beta",
  },
  {
    id: "planner-initiatives",
    label: "Initiatives",
    category: "planner",
    route: "/workspace/planner/initiatives",
    sort: 20,
    status: "unknown",
  },
  {
    id: "work-calendar",
    label: "Calendar",
    category: "calendar",
    route: "/workspace/work/calendar",
    sort: 10,
    status: "connected",
  },
  {
    id: "work-mail",
    label: "Mail",
    category: "mail",
    route: "/workspace/work/mail",
    sort: 20,
    status: "connected",
  },
  {
    id: "work-tasks",
    label: "Tasks",
    category: "tasks",
    route: "/workspace/work/tasks",
    sort: 30,
    status: "connected",
  },
  {
    id: "work-docs",
    label: "Docs & Slides",
    category: "docs",
    route: "/workspace/work/docs",
    sort: 40,
    status: "connected",
  },
  {
    id: "business-sales",
    label: "Sales Pipeline",
    category: "sales",
    route: "/workspace/business/sales",
    sort: 10,
    status: "connected",
  },
  {
    id: "business-hr",
    label: "People Operations",
    category: "hr",
    route: "/workspace/business/hr",
    sort: 10,
    status: "needs_connect",
    badge: "Connect",
  },
  {
    id: "business-marketing",
    label: "Marketing Pulse",
    category: "marketing",
    route: "/workspace/business/marketing",
    sort: 10,
    status: "connected",
  },
  {
    id: "build-overview",
    label: "Build Console",
    category: "build",
    route: "/workspace/build/overview",
    sort: 10,
    status: "connected",
  },
  {
    id: "build-automations",
    label: "Automations",
    category: "automations",
    route: "/workspace/build/automations",
    sort: 10,
    status: "connected",
  },
  {
    id: "build-reasoning",
    label: "Reasoning Studio",
    category: "reasoning",
    route: "/workspace/build/reasoning",
    sort: 10,
    status: "unknown",
  },
  {
    id: "build-integrations",
    label: "Integrations",
    category: "integrations",
    route: "/workspace/build/integrations",
    sort: 10,
    status: "connected",
  },
  {
    id: "marketplace-discover",
    label: "Marketplace",
    category: "marketplace",
    route: "/workspace/marketplace/discover",
    sort: 10,
    status: "unknown",
  },
  {
    id: "calendar-google",
    label: "Google Calendar",
    category: "calendar",
    route: "/workspace/calendar/google",
    provider: "Google",
    requiresAuth: true,
    sort: 10,
    status: "needs_connect",
    badge: "Connect",
  },
  {
    id: "calendar-outlook",
    label: "Outlook",
    category: "calendar",
    route: "/workspace/calendar/outlook",
    provider: "Microsoft",
    sort: 20,
    status: "unknown",
  },
  {
    id: "dev-github",
    label: "GitHub",
    category: "dev",
    route: "/workspace/dev/github",
    provider: "GitHub",
    requiresAuth: true,
    sort: 10,
    status: "connected",
  },
  {
    id: "dev-vercel",
    label: "Vercel",
    category: "dev",
    route: "/workspace/dev/vercel",
    provider: "Vercel",
    sort: 20,
    status: "needs_connect",
  },
  {
    id: "knowledge-notion",
    label: "Notion",
    category: "knowledge",
    route: "/workspace/knowledge/notion",
    provider: "Notion",
    requiresAuth: true,
    sort: 10,
    status: "needs_connect",
  },
  {
    id: "knowledge-docs",
    label: "Docs Vault",
    category: "knowledge",
    route: "/workspace/knowledge/docs-vault",
    sort: 20,
    status: "connected",
  },
  {
    id: "knowledge-hr",
    label: "HR Hub",
    category: "knowledge",
    route: "/workspace/knowledge/hr",
    provider: "FishDelish HR",
    sort: 30,
    status: "unknown",
  },
  {
    id: "finance-ledger",
    label: "Finance",
    category: "settings",
    route: "/workspace/settings/finance",
    provider: "Plaid",
    sort: 10,
    status: "needs_connect",
    badge: "Connect",
  },
  {
    id: "settings-billing",
    label: "Billing",
    category: "settings",
    route: "/workspace/settings/billing",
    sort: 20,
    status: "connected",
  },
];

export const MODULE_REGISTRY = MODULES.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

export function getModulesByCategory(category: string) {
  if (category === "work") {
    const workCategories = new Set(["calendar", "mail", "tasks", "docs"]);
    return MODULE_REGISTRY.filter((entry) => workCategories.has(entry.category));
  }
  if (category === "build") {
    const buildCategories = new Set(["build", "automations", "reasoning", "integrations"]);
    return MODULE_REGISTRY.filter((entry) => buildCategories.has(entry.category));
  }
  return MODULE_REGISTRY.filter((entry) => entry.category === category);
}

export function getModuleByRoute(route: string) {
  return MODULE_REGISTRY.find((entry) => entry.route === route);
}

export function getCategoryById(id: string) {
  return MODULE_CATEGORIES.find((category) => category.id === id);
}
