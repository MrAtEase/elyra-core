"use client";

import { useState } from "react";
import { Badge, Button, Card, ListRow } from "@/components/os/primitives";

const files = [
  "app/w/[slug]/mail/page.tsx",
  "components/os/programs/MailProgram.tsx",
  "components/nav/WorkspaceShell.tsx",
  "lib/workspace/workspaceModel.ts",
];

const extensionSeed = [
  { id: "ext-github", name: "GitHub Actions Bridge", perms: ["repo.read", "pull_request.write"], actions: ["Create branch", "Open PR"] },
  { id: "ext-vscode", name: "VS Code Synth", perms: ["editor.read", "workspace.write"], actions: ["Apply patch", "Run tests"] },
  { id: "ext-api", name: "API Synth Runtime", perms: ["api.invoke"], actions: ["Generate endpoint", "Validate contract"] },
];

export default function BuildProgram() {
  const [code, setCode] = useState(`export async function run() {\n  return { ok: true };\n}`);
  const [manifest, setManifest] = useState({
    name: "Synth App",
    actions: "createBranch,openPR,applyPatch",
    scopes: "repo.read,pull_request.write,workspace.write",
    apiBase: "vscode://elyra/synth",
  });
  const [installed, setInstalled] = useState<Record<string, boolean>>({ "ext-github": true, "ext-vscode": true, "ext-api": false });

  return (
    <div className="ec-three-col">
      <Card className="ec-panel-scroll">
        <p className="ec-overline">Coder Surface</p>
        <div className="ec-list">
          {files.map((file) => (
            <ListRow key={file} title={file} description="Tracked in active workspace" />
          ))}
        </div>
        <div className="ec-inline-row">
          <Button>Create branch</Button>
          <Button variant="outline">Open PR</Button>
        </div>
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">Editor</p>
        <textarea value={code} onChange={(event) => setCode(event.target.value)} rows={16} />
        <div className="ec-inline-row">
          <Button>Generate patch</Button>
          <Button variant="outline">Refactor</Button>
          <Button variant="ghost">Run tests</Button>
        </div>
        <small>Execution path: Reason → Plan → Confirm → Apply</small>
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">Extensions / Synth Apps</p>
        <label>
          Name
          <input value={manifest.name} onChange={(event) => setManifest((prev) => ({ ...prev, name: event.target.value }))} />
        </label>
        <label>
          Exposed actions
          <input value={manifest.actions} onChange={(event) => setManifest((prev) => ({ ...prev, actions: event.target.value }))} />
        </label>
        <label>
          Permissions
          <input value={manifest.scopes} onChange={(event) => setManifest((prev) => ({ ...prev, scopes: event.target.value }))} />
        </label>
        <label>
          VS Code API endpoint
          <input value={manifest.apiBase} onChange={(event) => setManifest((prev) => ({ ...prev, apiBase: event.target.value }))} />
        </label>

        <p className="ec-overline">Installed</p>
        <div className="ec-list">
          {extensionSeed.map((extension) => (
            <article key={extension.id} className="ec-list-row">
              <span>
                <strong>{extension.name}</strong>
                <small>{extension.actions.join(" · ")}</small>
              </span>
              <div className="ec-inline-row">
                <Badge tone={installed[extension.id] ? "accent" : "neutral"}>{installed[extension.id] ? "Installed" : "Available"}</Badge>
                <Button variant="ghost" onClick={() => setInstalled((prev) => ({ ...prev, [extension.id]: !prev[extension.id] }))}>
                  {installed[extension.id] ? "Disable" : "Enable"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
