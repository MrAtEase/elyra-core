"use client";

import { useMemo, useState } from "react";
import { Download, FileImage } from "lucide-react";
import { Badge, Button, Card, ListRow, Toast } from "@/components/os/primitives";

type Doc = {
  id: string;
  title: string;
  tags: string[];
  updatedAt: string;
  body: string;
};

const initialDocs: Doc[] = [
  {
    id: "doc-1",
    title: "Weekly Leadership Update",
    tags: ["leadership", "weekly"],
    updatedAt: new Date().toISOString(),
    body: "# Weekly Leadership Update\n\n- Wins\n- Risks\n- Next actions",
  },
  {
    id: "doc-2",
    title: "Product Launch Plan",
    tags: ["launch", "plan"],
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    body: "# Product Launch Plan\n\n/summary\n/translate de",
  },
];

export default function DocsProgram() {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [activeId, setActiveId] = useState<string>(initialDocs[0]!.id);
  const [toast, setToast] = useState<string | null>(null);

  const activeDoc = useMemo(() => docs.find((doc) => doc.id === activeId) ?? docs[0]!, [docs, activeId]);

  const updateBody = (body: string) => {
    setDocs((current) => current.map((doc) => (doc.id === activeDoc.id ? { ...doc, body, updatedAt: new Date().toISOString() } : doc)));
  };

  const aiAction = (kind: "summarize" | "rewrite" | "translate" | "image") => {
    if (kind === "summarize") {
      updateBody(`${activeDoc.body}\n\n## Summary\n- Key points extracted by AI`);
    } else if (kind === "rewrite") {
      updateBody(`${activeDoc.body}\n\n## Rewrite\nRefined tone and structure for executive audience.`);
    } else if (kind === "translate") {
      updateBody(`${activeDoc.body}\n\n## Translation\n(EN) Translated draft preview.`);
    } else {
      updateBody(`${activeDoc.body}\n\n![Generated concept image](artifact://image/${Date.now()})`);
    }
    setToast(`AI ${kind} completed.`);
    window.setTimeout(() => setToast(null), 1800);
  };

  const exportDoc = () => {
    const blob = new Blob([activeDoc.body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeDoc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const createFromPlan = () => {
    const doc: Doc = {
      id: `doc-${Date.now()}`,
      title: "Doc from Plan",
      tags: ["artifact"],
      updatedAt: new Date().toISOString(),
      body: "# Plan Artifact\n\n1. Understand\n2. Plan\n3. Run",
    };
    setDocs((current) => [doc, ...current]);
    setActiveId(doc.id);
  };

  return (
    <div className="ec-three-col">
      <Card className="ec-panel-scroll">
        <div className="ec-inline-row ec-space-between">
          <p className="ec-overline">Document Hub</p>
          <Button onClick={createFromPlan}>Create from plan</Button>
        </div>
        <div className="ec-list">
          {docs.map((doc) => (
            <ListRow
              key={doc.id}
              className={activeId === doc.id ? "is-selected" : ""}
              title={doc.title}
              description={new Date(doc.updatedAt).toLocaleString()}
              trailing={<small>{doc.tags.join(", ")}</small>}
              onClick={() => setActiveId(doc.id)}
            />
          ))}
        </div>
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">Editor</p>
        <h3>{activeDoc.title}</h3>
        <textarea value={activeDoc.body} onChange={(event) => updateBody(event.target.value)} rows={18} />
      </Card>

      <Card className="ec-panel-scroll">
        <p className="ec-overline">AI Actions</p>
        <div className="ec-stack">
          <Button onClick={() => aiAction("summarize")}>Summarize</Button>
          <Button onClick={() => aiAction("rewrite")} variant="outline">Rewrite</Button>
          <Button onClick={() => aiAction("translate")} variant="outline">Translate</Button>
          <Button onClick={() => aiAction("image")} variant="outline">
            <FileImage size={14} /> Generate image in doc
          </Button>
          <Button onClick={exportDoc} variant="ghost">
            <Download size={14} /> Export artifact
          </Button>
        </div>
        <div className="ec-inline-row">
          <Badge>/summary</Badge>
          <Badge>/rewrite</Badge>
          <Badge>/translate</Badge>
          <Badge>/image</Badge>
        </div>
      </Card>
      <Toast message={toast} />
    </div>
  );
}
