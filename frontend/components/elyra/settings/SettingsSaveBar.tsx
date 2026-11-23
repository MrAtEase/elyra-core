"use client";

type SettingsSaveBarProps = {
  onSave: () => void;
  disabled?: boolean;
  saving?: boolean;
  success?: string | null;
  error?: string | null;
};

export default function SettingsSaveBar({ onSave, disabled, saving, success, error }: SettingsSaveBarProps) {
  return (
    <div className="settings-save-bar">
      <button
        type="button"
        className="settings-form__submit"
        onClick={onSave}
        disabled={Boolean(disabled) || Boolean(saving)}
        aria-busy={saving ? true : undefined}
      >
        {saving ? "Saving..." : "Save workspace identity"}
      </button>
      {success && (
        <p className="settings-save-bar__status" role="status" aria-live="polite">
          {success}
        </p>
      )}
      {!success && error && (
        <p className="settings-form__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
