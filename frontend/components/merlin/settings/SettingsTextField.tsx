"use client";

import type { InputHTMLAttributes } from "react";

type SettingsTextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string | null;
  className?: string;
};

export default function SettingsTextField({
  error,
  className,
  ...props
}: SettingsTextFieldProps) {
  return (
    <div className={`settings-text-field ${className ?? ""}`.trim()}>
      <input
        className={`settings-text-field__input${error ? " settings-text-field__input--error" : ""}`}
        {...props}
      />
      {error && <p className="settings-text-field__error settings-form__error">{error}</p>}
    </div>
  );
}
