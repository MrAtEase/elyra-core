"use client";

import { type ReactNode } from "react";

type WizardShellProps = {
  open: boolean;
  title: string;
  stepTitle: string;
  currentStep: number;
  totalSteps: number;
  canGoBack: boolean;
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  proceedLabel: string;
  children: ReactNode;
};

export default function WizardShell({
  open,
  title,
  stepTitle,
  currentStep,
  totalSteps,
  canGoBack,
  canProceed,
  onBack,
  onNext,
  onClose,
  proceedLabel,
  children,
}: WizardShellProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130]">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" aria-label="Close wizard" />
      <section className="absolute inset-x-0 bottom-0 max-h-[86vh] rounded-t-2xl border border-white/12 bg-[var(--os-panel-strong)] p-4 shadow-2xl backdrop-blur-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(560px,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <header className="mb-3 border-b border-white/10 pb-3">
          <p className="text-xs uppercase tracking-[0.12em] text-white/55">{title}</p>
          <h3 className="mt-1 text-lg text-white/95">{stepTitle}</h3>
          <p className="mt-1 text-xs text-white/50">Step {currentStep + 1} of {totalSteps}</p>
        </header>

        <div className="min-h-[180px]">{children}</div>

        <footer className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={canGoBack ? onBack : onClose}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80"
          >
            {canGoBack ? "Back" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="rounded-lg border border-white/20 bg-white/12 px-3 py-1.5 text-sm text-white disabled:opacity-55"
          >
            {proceedLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
