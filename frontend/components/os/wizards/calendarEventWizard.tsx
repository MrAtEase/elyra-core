"use client";

import { useState } from "react";
import WizardShell from "@/components/os/wizards/WizardShell";

type CalendarEventWizardProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (summary: string) => void;
};

const STEPS = ["Event", "Schedule", "Invitees"];

export default function CalendarEventWizard({ open, onClose, onConfirm }: CalendarEventWizardProps) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Team sync");
  const [date, setDate] = useState("2026-02-20");
  const [time, setTime] = useState("10:00");
  const [invitees, setInvitees] = useState("alex@fishdelish.com, sarah@fishdelish.com");

  const canProceed =
    (step === 0 && title.trim().length > 0) ||
    (step === 1 && date.trim().length > 0 && time.trim().length > 0) ||
    (step === 2 && invitees.trim().length > 0);

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((prev) => prev + 1);
      return;
    }
    onConfirm(`Scheduled ${title} on ${date} at ${time}.`);
    setStep(0);
  };

  return (
    <WizardShell
      open={open}
      title="Calendar Event"
      stepTitle={STEPS[step] ?? "Event"}
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
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="h-11 w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 text-sm text-white/90 outline-none"
        />
      ) : null}
      {step === 1 ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-11 rounded-lg border border-white/15 bg-white/[0.03] px-3 text-sm text-white/90 outline-none"
          />
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="h-11 rounded-lg border border-white/15 bg-white/[0.03] px-3 text-sm text-white/90 outline-none"
          />
        </div>
      ) : null}
      {step === 2 ? (
        <textarea
          value={invitees}
          onChange={(event) => setInvitees(event.target.value)}
          className="h-36 w-full resize-none rounded-lg border border-white/15 bg-white/[0.03] p-3 text-sm text-white/90 outline-none"
        />
      ) : null}
    </WizardShell>
  );
}
