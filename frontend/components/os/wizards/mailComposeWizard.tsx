"use client";

import { useState } from "react";
import WizardShell from "@/components/os/wizards/WizardShell";

type MailComposeWizardProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (summary: string) => void;
};

const STEPS = ["Recipient", "Subject", "Message"];

export default function MailComposeWizard({ open, onClose, onConfirm }: MailComposeWizardProps) {
  const [step, setStep] = useState(0);
  const [to, setTo] = useState("Sarah");
  const [subject, setSubject] = useState("Q3 deck update");
  const [message, setMessage] = useState("Hi Sarah, sharing the latest draft for review.");

  const canProceed =
    (step === 0 && to.trim().length > 0) ||
    (step === 1 && subject.trim().length > 0) ||
    (step === 2 && message.trim().length > 0);

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((prev) => prev + 1);
      return;
    }
    onConfirm(`Drafted email to ${to} with subject \"${subject}\".`);
    setStep(0);
  };

  const back = () => setStep((prev) => Math.max(0, prev - 1));

  return (
    <WizardShell
      open={open}
      title="Mail Compose"
      stepTitle={STEPS[step] ?? "Compose"}
      currentStep={step}
      totalSteps={STEPS.length}
      canGoBack={step > 0}
      canProceed={canProceed}
      onBack={back}
      onNext={next}
      onClose={onClose}
      proceedLabel={step === STEPS.length - 1 ? "Confirm" : "Next"}
    >
      {step === 0 ? (
        <input
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="Who is this email for?"
          className="h-11 w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 text-sm text-white/90 outline-none"
        />
      ) : null}
      {step === 1 ? (
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Subject"
          className="h-11 w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 text-sm text-white/90 outline-none"
        />
      ) : null}
      {step === 2 ? (
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="h-40 w-full resize-none rounded-lg border border-white/15 bg-white/[0.03] p-3 text-sm text-white/90 outline-none"
        />
      ) : null}
    </WizardShell>
  );
}
