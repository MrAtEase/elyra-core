import ActionCardShell from "@/components/orchestrator/actions/ActionCardShell";
import type { OrchestratorAction } from "@/components/orchestrator/types";

type ActionProps = {
  action: OrchestratorAction;
  onInputChange: (field: string, value: string) => void;
  onConfirm: () => void;
  onRun: () => void;
};

export default function CreateDocAction({ action, onInputChange, onConfirm, onRun }: ActionProps) {
  return (
    <ActionCardShell
      action={action}
      onInputChange={onInputChange}
      onConfirm={onConfirm}
      onRun={onRun}
    />
  );
}
