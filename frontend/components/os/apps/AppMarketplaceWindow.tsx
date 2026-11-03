"use client";

import { useMemo, useState } from "react";
import type { AppId } from "@/components/os/windowing/windowTypes";

type Category = "Communication" | "Docs" | "Dev" | "Business" | "Automations";
type IntegrationTile = {
  id: string;
  name: string;
  category: Category;
  permissions: string[];
  appId?: AppId;
};

const TILES: IntegrationTile[] = [
  { id: "gmail", name: "Mail", category: "Communication", permissions: ["mail.read", "mail.send"], appId: "mail" },
  { id: "slack", name: "Slack", category: "Communication", permissions: ["chat.read", "chat.write"] },
  { id: "notion", name: "Notion", category: "Docs", permissions: ["docs.read", "docs.write"], appId: "docs" },
  { id: "drive", name: "Drive", category: "Docs", permissions: ["files.read", "files.write"], appId: "files" },
  { id: "github", name: "GitHub", category: "Dev", permissions: ["repo.read", "pull_request.write"], appId: "build" },
  { id: "vscode", name: "VS Code", category: "Dev", permissions: ["editor.read", "workspace.write"], appId: "build" },
  { id: "crm", name: "CRM", category: "Business", permissions: ["contacts.read", "deals.write"] },
  { id: "finance", name: "Finance", category: "Business", permissions: ["billing.read"] },
  { id: "synth-apps", name: "Synth Apps", category: "Automations", permissions: ["extensions.execute"], appId: "build" },
  { id: "extensions-api", name: "Extensions API", category: "Automations", permissions: ["api.invoke"] },
];

const CATEGORIES: Category[] = ["Communication", "Docs", "Dev", "Business", "Automations"];

type AppMarketplaceWindowProps = {
  onOpenApp?: (appId: AppId) => void;
};

export default function AppMarketplaceWindow({ onOpenApp }: AppMarketplaceWindowProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("Communication");
  const [connected, setConnected] = useState<Record<string, boolean>>({
    gmail: false,
    slack: false,
    notion: true,
    drive: true,
    github: true,
    vscode: false,
    crm: false,
    finance: false,
    "synth-apps": true,
    "extensions-api": true,
  });

  const visible = useMemo(() => TILES.filter((tile) => tile.category === activeCategory), [activeCategory]);

  return (
    <section className="h-full p-5 text-white">
      <p className="text-xs uppercase tracking-[0.2em] text-white/45">App Store / Integrations</p>
      <h2 className="mt-1 text-lg font-semibold">Marketplace</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`rounded-full border px-3 py-1 text-xs ${
              activeCategory === category ? "border-cyan-300/70 bg-cyan-300/12" : "border-white/12 bg-white/[0.03]"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="mt-4 grid max-h-[calc(100%-120px)] grid-cols-2 gap-3 overflow-auto pr-1">
        {visible.map((tile) => {
          const isConnected = Boolean(connected[tile.id]);
          return (
            <article key={tile.id} className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{tile.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${isConnected ? "bg-emerald-400/20 text-emerald-100" : "bg-white/10 text-white/65"}`}>
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <p className="text-xs text-white/55">Permissions: {tile.permissions.join(", ")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConnected((prev) => ({ ...prev, [tile.id]: !prev[tile.id] }))}
                  className="rounded-md border border-white/12 bg-white/[0.04] px-2 py-1 text-xs"
                >
                  {isConnected ? "Disconnect" : "Connect"}
                </button>
                <button
                  type="button"
                  disabled={!tile.appId}
                  onClick={() => tile.appId && onOpenApp?.(tile.appId)}
                  className="rounded-md border border-cyan-300/40 bg-cyan-300/20 px-2 py-1 text-xs text-cyan-50 disabled:opacity-40"
                >
                  Open App
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
