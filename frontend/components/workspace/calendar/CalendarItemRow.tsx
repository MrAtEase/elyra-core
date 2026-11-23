"use client";

import type { CalendarItem } from "./useCalendar";

const formatDateTime = (value: string) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatRange = (item: CalendarItem) => {
  const startLabel = formatDateTime(item.start);
  if (item.kind === "event" && item.end) {
    const endLabel = formatDateTime(item.end);
    return `${startLabel} — ${endLabel}`;
  }
  return startLabel;
};

type CalendarItemRowProps = {
  item: CalendarItem;
  onEdit?: (item: CalendarItem) => void;
  onDelete?: (item: CalendarItem) => void;
};

export default function CalendarItemRow({ item, onEdit, onDelete }: CalendarItemRowProps) {
  const kindLabel = item.kind === "task" ? "📌 Task" : "📅 Event";
  const showActions =
    item.kind === "event" && item.isEditable && (typeof onEdit === "function" || typeof onDelete === "function");
  const isOptimistic = item.kind === "event" && Boolean(item.isOptimistic);

  return (
    <div
      className={`workspace-calendar__item${isOptimistic ? " workspace-calendar__item--optimistic" : ""}`}
      data-e2e-calendar-row={item.id}
    >
      <div className="workspace-calendar__item-meta">
        <span className="workspace-calendar__item-chip" data-e2e-calendar-kind={item.kind}>
          {kindLabel}
        </span>
        <span className="workspace-calendar__item-title" data-e2e-calendar-title={item.id}>
          {item.title}
        </span>
        {item.kind === "event" && item.source && (
          <span className="workspace-calendar__item-source">{item.source}</span>
        )}
      </div>
      <p className="workspace-calendar__item-time">{formatRange(item)}</p>
      {showActions && (
        <div className="workspace-calendar__item-actions">
          {onEdit && (
            <button
              type="button"
              className="workspace-calendar__item-action"
              onClick={() => onEdit(item)}
            >
              ✏️
              <span className="sr-only">Edit event</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="workspace-calendar__item-action"
              onClick={() => onDelete(item)}
            >
              🗑️
              <span className="sr-only">Delete event</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
