import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import type { OrchestratorAction } from "@/components/orchestrator/types";

type ActionCardShellProps = {
  action: OrchestratorAction;
  onInputChange: (field: string, value: string) => void;
  onConfirm: () => void;
  onRun: () => void;
};

const safetyLabel = (safety: OrchestratorAction["safety"]) => {
  if (safety === "safe") return "No confirmation";
  if (safety === "confirm_cost") return "Needs confirmation (cost)";
  return "Needs confirmation";
};

const statusLabel = (status: OrchestratorAction["status"]) => {
  if (status === "running") return "Running";
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  if (status === "confirmed") return "Confirmed";
  return "Proposed";
};

export default function ActionCardShell({ action, onInputChange, onConfirm, onRun }: ActionCardShellProps) {
  const canRun = action.safety === "safe" || action.status === "confirmed" || action.status === "done";
  const isBusy = action.status === "running";

  return (
    <Card className="orchestratorActionCard">
      <div className="orchestratorActionCard__head">
        <div>
          <p className="orchestratorActionCard__title">{action.title}</p>
          <p className="orchestratorActionCard__what">{action.whatWillHappen}</p>
        </div>
        <div className="orchestratorActionCard__meta">
          <Badge variant={action.safety === "safe" ? "success" : "warning"}>{safetyLabel(action.safety)}</Badge>
          <Badge variant="neutral">{statusLabel(action.status)}</Badge>
        </div>
      </div>

      <div className="orchestratorActionCard__grid">
        <div>
          <p className="orchestratorActionCard__label">Inputs</p>
          <div className="orchestratorActionCard__inputs">
            {Object.entries(action.inputs).map(([field, value]) => (
              <label key={field} className="orchestratorActionCard__inputRow">
                <span>{field}</span>
                <input
                  value={value}
                  onChange={(event) => onInputChange(field, event.target.value)}
                  disabled={isBusy || action.status === "done"}
                />
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="orchestratorActionCard__label">Outputs</p>
          <div className="orchestratorActionCard__outputs">
            {action.outputs.length === 0 ? (
              <p className="orchestratorActionCard__empty">No outputs yet.</p>
            ) : (
              action.outputs.map((output) => (
                <article key={output.id} className="orchestratorActionCard__output">
                  <p>{output.label}</p>
                  <small>{output.value}</small>
                </article>
              ))
            )}
          </div>
        </div>
      </div>

      {action.notes ? <p className="orchestratorActionCard__notes">{action.notes}</p> : null}

      <div className="orchestratorActionCard__controls">
        {action.safety !== "safe" && action.status === "proposed" ? (
          <Button variant="secondary" size="sm" onClick={onConfirm}>
            Confirm
          </Button>
        ) : null}
        <Button size="sm" onClick={onRun} disabled={!canRun || isBusy}>
          {isBusy ? "Running..." : "Run"}
        </Button>
      </div>
    </Card>
  );
}
