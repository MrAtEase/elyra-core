"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Badge, Button, Card, ListRow } from "@/components/os/primitives";

type PlannerTask = {
  id: string;
  title: string;
  section: "today" | "upcoming" | "projects";
  priority: number;
};

const seedTasks: PlannerTask[] = [
  { id: "t1", title: "Reply to top customer threads", section: "today", priority: 3 },
  { id: "t2", title: "Finalize Q2 hiring calendar", section: "upcoming", priority: 2 },
  { id: "t3", title: "Prepare CRM pipeline automation", section: "projects", priority: 4 },
];

const sections: PlannerTask["section"][] = ["today", "upcoming", "projects"];

export default function TasksProgram() {
  const [tasks, setTasks] = useState<PlannerTask[]>(seedTasks);

  const grouped = useMemo(() => {
    return {
      today: tasks.filter((task) => task.section === "today"),
      upcoming: tasks.filter((task) => task.section === "upcoming"),
      projects: tasks.filter((task) => task.section === "projects"),
    };
  }, [tasks]);

  const turnPlanIntoTasks = () => {
    setTasks((current) => [
      { id: `t-${Date.now()}`, title: "Plan step: Send confirmation email", section: "today", priority: 5 },
      { id: `t-${Date.now()}-2`, title: "Plan step: Create review doc", section: "upcoming", priority: 4 },
      ...current,
    ]);
  };

  const prioritize = () => {
    setTasks((current) => [...current].sort((a, b) => b.priority - a.priority));
  };

  const createCrmPipeline = () => {
    setTasks((current) => [
      { id: `crm-${Date.now()}`, title: "CRM pipeline: qualify leads", section: "projects", priority: 5 },
      { id: `crm-${Date.now()}-2`, title: "CRM pipeline: outreach sequence", section: "projects", priority: 4 },
      ...current,
    ]);
  };

  return (
    <div className="ec-program-grid">
      <Card>
        <p className="ec-overline">Planner AI</p>
        <h1>Today, Upcoming, Projects</h1>
        <div className="ec-inline-row">
          <Button onClick={turnPlanIntoTasks}>Turn plan into tasks</Button>
          <Button variant="outline" onClick={prioritize}>
            <ArrowUpDown size={14} /> Prioritize
          </Button>
          <Button variant="ghost" onClick={createCrmPipeline}>Create CRM pipeline</Button>
        </div>
      </Card>
      <div className="ec-grid-3">
        {sections.map((section) => (
          <Card key={section}>
            <div className="ec-inline-row ec-space-between">
              <strong>{section.toUpperCase()}</strong>
              <Badge>{grouped[section].length}</Badge>
            </div>
            <div className="ec-list">
              {grouped[section].map((task) => (
                <ListRow
                  key={task.id}
                  title={task.title}
                  description={`Priority ${task.priority}`}
                  trailing={<Badge tone={task.priority >= 4 ? "warning" : "neutral"}>P{task.priority}</Badge>}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
