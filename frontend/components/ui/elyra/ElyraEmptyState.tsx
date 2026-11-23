"use client";

import type { ReactNode } from "react";

type ElyraEmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
};

export default function ElyraEmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
}: ElyraEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-[color:var(--elyra-border)] bg-[color:var(--elyra-panel)] p-5 text-center">
      {icon ? <div className="mb-2 flex justify-center text-[color:var(--elyra-muted)]">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-[color:var(--elyra-text)]">{title}</h3>
      <p className="mt-1 text-[13px] text-[color:var(--elyra-muted)]">{description}</p>
      {primaryAction || secondaryAction ? (
        <div className="mt-3 flex items-center justify-center gap-2">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

