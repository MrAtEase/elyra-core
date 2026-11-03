"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card } from "@/components/os/primitives";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

type CatalogItem = {
  id: string;
  name: string;
  category: "Work" | "Sales" | "Marketing" | "HR" | "Finance" | "Dev";
  perms: string[];
  actions: string[];
};

const catalog: CatalogItem[] = [
  { id: "gmail", name: "Gmail", category: "Work", perms: ["mail.read", "mail.send"], actions: ["List inbox", "Send draft"] },
  { id: "outlook", name: "Outlook", category: "Work", perms: ["mail.read", "calendar.read"], actions: ["Thread triage", "Event sync"] },
  { id: "notion", name: "Notion", category: "Work", perms: ["docs.read", "docs.write"], actions: ["Create page", "Summarize notes"] },
  { id: "slack", name: "Slack", category: "Marketing", perms: ["channels.read", "chat.write"], actions: ["Post update", "Fetch mentions"] },
  { id: "hubspot", name: "HubSpot", category: "Sales", perms: ["contacts.read", "deals.write"], actions: ["Create lead", "Update stage"] },
  { id: "personio", name: "Personio", category: "HR", perms: ["people.read"], actions: ["List interviews", "Draft recap"] },
  { id: "stripe", name: "Stripe", category: "Finance", perms: ["billing.read"], actions: ["Invoice status", "Revenue summary"] },
  { id: "github", name: "GitHub", category: "Dev", perms: ["repo", "pull_request"], actions: ["Open PR", "List issues"] },
];

const categories: CatalogItem["category"][] = ["Work", "Sales", "Marketing", "HR", "Finance", "Dev"];

export default function MarketplaceProgram() {
  const { data } = useWorkspaceData();
  const [selectedCategory, setSelectedCategory] = useState<CatalogItem["category"]>("Work");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("gmail");
  const [connected, setConnected] = useState<Record<string, boolean>>({ gmail: false, outlook: false, notion: true, slack: false, hubspot: false, personio: false, stripe: false, github: true });

  const visible = useMemo(() => catalog.filter((item) => item.category === selectedCategory), [selectedCategory]);
  const selected = catalog.find((item) => item.id === selectedIntegrationId) ?? visible[0] ?? catalog[0];
  if (!selected) return null;

  return (
    <div className="ec-three-col">
      <Card className="ec-panel-scroll">
        <p className="ec-overline">Marketplace</p>
        <h1>Programs & Integrations</h1>
        <p>Discover integrations, control permissions and run quick actions by category.</p>
        <div className="ec-inline-wrap">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={`ec-chip ${selectedCategory === category ? "is-active" : ""}`}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <small>Workspace: {data?.activeWorkspace?.name ?? "Workspace"}</small>
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">Catalog</p>
        <div className="ec-list">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ec-list-row ${selected.id === item.id ? "is-selected" : ""}`}
              onClick={() => setSelectedIntegrationId(item.id)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.actions.join(" · ")}</small>
              </span>
              <Badge tone={connected[item.id] ? "accent" : "neutral"}>{connected[item.id] ? "Connected" : "Not connected"}</Badge>
            </button>
          ))}
        </div>
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">Integration Overview</p>
        <h3>{selected.name}</h3>
        <p>Permissions: {selected.perms.join(", ")}</p>
        <p>Quick actions: {selected.actions.join(" · ")}</p>
        <div className="ec-inline-row">
          <Button onClick={() => setConnected((prev) => ({ ...prev, [selected.id]: !prev[selected.id] }))}>
            {connected[selected.id] ? "Disconnect" : "Connect"}
          </Button>
          <Button variant="outline">Run quick action</Button>
        </div>
        <p className="ec-overline">Recent Logs</p>
        <div className="ec-plain-list">
          <p>{selected.name}: permission sync checked</p>
          <p>{selected.name}: last action completed successfully</p>
          <p>{selected.name}: no policy conflicts detected</p>
        </div>
      </Card>
    </div>
  );
}
