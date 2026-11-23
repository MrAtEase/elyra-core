"use client";

import { useMemo, useState } from "react";
import WizardShell from "@/components/os/wizards/WizardShell";

type TasksBatchWizardProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (summary: string) => void;
};

const STEPS = ["Task List", "Review"];

export default function TasksBatchWizard({ open, onClose, onConfirm }: TasksBatchWizardProps) {
  const [step, setStep] = useState(0);
  const [lines, setLines] = useState("Write launch brief\nFinalize campaign sequence\nRun QA checklist");

  const parsed = useMemo(
    () => lines.split("\n").map((line) => line.trim()).filter(Boolean),
    [lines]
  );

  const canProceed = step === 0 ? parsed.length > 0 : true;

  const next = () => {
    if (step === 0) {
      setStep(1);
      return;
    }
    onConfirm(`Created ${parsed.length} tasks from your batch.`);
    setStep(0);
  };

  return (
    <WizardShell
      open={open}
      title="Task Batch"
      stepTitle={STEPS[step] ?? "Tasks"}
      currentStep={step}
      totalSteps={STEPS.length}
      canGoBack={step > 0}
      canProceed={canProceed}
      onBack={() => setStep((prev) => Math.max(0, prev - 1))}
      onNext={next}
      onClose={onClose}
      proceedLabel={step === STEPS.length - 1 ? "Confirm" : "Next"}
    >
      {step === 0 ? (
        <textarea
          value={lines}
          onChange={(event) => setLines(event.target.value)}
          className="h-44 w-full resize-none rounded-lg border border-white/15 bg-white/[0.03] p-3 text-sm text-white/90 outline-none"
        />
      ) : null}
      {step === 1 ? (
        <ul className="space-y-1">
          {parsed.map((task) => (
            <li key={task} className="rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white/85">
              {task}
            </li>
          ))}
        </ul>
      ) : null}
    </WizardShell>
  );
}
