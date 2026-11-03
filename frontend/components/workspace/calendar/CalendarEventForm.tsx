"use client";

import { FormEvent, useMemo, useState } from "react";

import type { CalendarEventInput } from "@/types/calendar";

const toLocalInputValue = (iso?: string | null) => {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const offsetMs = parsed.getTimezoneOffset() * 60000;
  const local = new Date(parsed.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
};

const toIsoValue = (value: string) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
};

type CalendarEventFormMode = "create" | "edit";

type CalendarEventFormProps = {
  mode: CalendarEventFormMode;
  initial?: {
    title?: string;
    start?: string | null;
    end?: string | null;
    description?: string | null;
    location?: string | null;
  };
  onCancel: () => void;
  onSubmit: (payload: CalendarEventInput) => Promise<void> | void;
  isSaving?: boolean;
  error?: string | null;
};

export default function CalendarEventForm({
  mode,
  initial,
  onCancel,
  onSubmit,
  isSaving = false,
  error,
}: CalendarEventFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startValue, setStartValue] = useState(toLocalInputValue(initial?.start));
  const [endValue, setEndValue] = useState(toLocalInputValue(initial?.end));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const submitLabel = mode === "create" ? "Schedule event" : "Save changes";
  const formError = error || localError;

  const isSubmitDisabled = useMemo(
    () => isSaving || !title.trim() || !startValue || !endValue,
    [isSaving, title, startValue, endValue]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setLocalError("Please provide an event title.");
      return;
    }
    if (!startValue || !endValue) {
      setLocalError("Start and end times are required.");
      return;
    }

    const startIso = toIsoValue(startValue);
    const endIso = toIsoValue(endValue);

    if (!startIso || !endIso) {
      setLocalError("Start or end time is invalid.");
      return;
    }
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      setLocalError("End time must be after start time.");
      return;
    }

    const desc = description.trim();
    const loc = location.trim();

    const payload: CalendarEventInput = {
      title: trimmedTitle,
      start: startIso,
      end: endIso,
      ...(desc ? { description: desc } : {}),
      ...(loc ? { location: loc } : {}),
    };

    await onSubmit(payload);
  };

  return (
    <form className="workspace-calendar__form" onSubmit={handleSubmit}>
      <div className="workspace-calendar__form-row">
        <label htmlFor="calendar-event-title" className="workspace-calendar__form-label">
          Title
        </label>
        <input
          id="calendar-event-title"
          className="workspace-calendar__form-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Team sync"
          disabled={isSaving}
        />
      </div>

      <div className="workspace-calendar__form-row">
        <label htmlFor="calendar-event-start" className="workspace-calendar__form-label">
          Start
        </label>
        <input
          id="calendar-event-start"
          type="datetime-local"
          className="workspace-calendar__form-input"
          value={startValue}
          onChange={(event) => setStartValue(event.target.value)}
          disabled={isSaving}
        />
      </div>

      <div className="workspace-calendar__form-row">
        <label htmlFor="calendar-event-end" className="workspace-calendar__form-label">
          End
        </label>
        <input
          id="calendar-event-end"
          type="datetime-local"
          className="workspace-calendar__form-input"
          value={endValue}
          onChange={(event) => setEndValue(event.target.value)}
          disabled={isSaving}
        />
      </div>

      <div className="workspace-calendar__form-row">
        <label htmlFor="calendar-event-location" className="workspace-calendar__form-label">
          Location
        </label>
        <input
          id="calendar-event-location"
          className="workspace-calendar__form-input"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="Office / Zoom"
          disabled={isSaving}
        />
      </div>

      <div className="workspace-calendar__form-row">
        <label htmlFor="calendar-event-description" className="workspace-calendar__form-label">
          Notes
        </label>
        <textarea
          id="calendar-event-description"
          className="workspace-calendar__form-input workspace-calendar__form-textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add context or agenda"
          disabled={isSaving}
        />
      </div>

      {formError && <p className="workspace-calendar__form-error">{formError}</p>}

      <div className="workspace-calendar__form-actions">
        <button type="submit" className="workspace-calendar__form-submit" disabled={isSubmitDisabled}>
          {isSaving ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          className="workspace-calendar__form-cancel"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}