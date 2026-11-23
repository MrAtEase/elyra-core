import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { PlanStep } from "@/components/orchestrator/types";

type PlanStepCardProps = {
  step: PlanStep;
  children: ReactNode;
};

const stepBadgeVariant = (status: PlanStep["status"]) => {
  if (status === "done") return "success" as const;
  if (status === "running") return "info" as const;
  if (status === "blocked") return "warning" as const;
  return "neutral" as const;
};

export default function PlanStepCard({ step, children }: PlanStepCardProps) {
  return (
    <Card className="planStepCard">
      <header className="planStepCard__header">
        <div>
          <p className="planStepCard__title">{step.title}</p>
          <p className="planStepCard__description">{step.description}</p>
        </div>
        <div className="planStepCard__meta">
          <Badge variant="neutral">{step.tool}</Badge>
          <Badge variant={stepBadgeVariant(step.status)}>{step.status}</Badge>
        </div>
      </header>
      <div className="planStepCard__body">{children}</div>
    </Card>
  );
}
