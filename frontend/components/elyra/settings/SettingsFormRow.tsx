"use client";

import type { ReactNode } from "react";

type SettingsFormRowProps = {
  label: string;
  helper?: string;
  className?: string;
  children: ReactNode;
};

export default function SettingsFormRow({ label, helper, children, className }: SettingsFormRowProps) {
  return (
    <div className={`settings-form-row ${className ?? ""}`.trim()}>
      <div className="settings-form-row__label">
        <p className="settings-form-row__title">{label}</p>
        {helper && <p className="settings-form-row__helper">{helper}</p>}
      </div>
      <div className="settings-form-row__control">{children}</div>
    </div>
  );
}
