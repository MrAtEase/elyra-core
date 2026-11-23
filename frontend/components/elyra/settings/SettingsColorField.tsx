"use client";

import { useMemo } from "react";

type SettingsColorFieldProps = {
  id: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
};

export default function SettingsColorField({
  id,
  value,
  placeholder,
  onChange,
  error,
  disabled,
}: SettingsColorFieldProps) {
  const isValidColor = useMemo(() => /^#[0-9a-fA-F]{6}$/.test(value), [value]);
  const colorInputValue = isValidColor ? value : "#000000";

  return (
    <div className="settings-color-field">
      <label className="settings-color-field__picker" htmlFor={`${id}-picker`}>
        <input
          id={`${id}-picker`}
          type="color"
          value={colorInputValue}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Pick a color"
          disabled={disabled}
        />
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="settings-color-field__input"
        disabled={disabled}
      />
      {error && <p className="settings-color-field__error settings-form__error">{error}</p>}
    </div>
  );
}
