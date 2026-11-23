"use client";

import type { ModuleRegistryItem } from "@/components/modules/registry";

type ConnectSheetProps = {
  module: ModuleRegistryItem | null;
  open: boolean;
  onClose: () => void;
};

export default function ConnectSheet({ module, open, onClose }: ConnectSheetProps) {
  if (!open || !module) {
    return null;
  }

  const providerLabel = module.provider ?? module.label;

  return (
    <div className="connect-sheet__backdrop" role="dialog" aria-modal="true" aria-label="Connect module">
      <div className="connect-sheet">
        <header className="connect-sheet__header">
          <p className="connect-sheet__eyebrow">Connect Sheet</p>
          <button aria-label="Close connect sheet" onClick={onClose} className="connect-sheet__close">
            ×
          </button>
        </header>
        <div className="connect-sheet__body">
          <h3>{module.label}</h3>
          <p className="connect-sheet__status">Status: {module.status.replace("_", " ")}</p>
          <p className="connect-sheet__description">
            {providerLabel} ist bereit, verbunden zu werden. Folge dem CTA, um deine Integration live zu bringen.
          </p>
        </div>
        <div className="connect-sheet__actions">
          <a className="connect-sheet__cta" href="#" onClick={onClose}>
            Connect with {providerLabel}
          </a>
          <button type="button" className="connect-sheet__ghost" onClick={onClose}>
            Später
          </button>
        </div>
      </div>
      <button type="button" className="connect-sheet__layer" onClick={onClose} aria-label="Close connect sheet" />
    </div>
  );
}
