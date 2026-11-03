"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type BaseProps = HTMLAttributes<HTMLElement> & { children: ReactNode };

export function Panel({ className, children, ...props }: BaseProps) {
  return (
    <section className={cn("ec-panel", className)} {...props}>
      {children}
    </section>
  );
}

export function Inspector({ className, children, ...props }: BaseProps) {
  return (
    <aside className={cn("ec-inspector", className)} {...props}>
      {children}
    </aside>
  );
}

export function Card({ className, children, ...props }: BaseProps) {
  return (
    <article className={cn("ec-card", className)} {...props}>
      {children}
    </article>
  );
}

export function Badge({ className, children, tone = "neutral" }: BaseProps & { tone?: "neutral" | "accent" | "danger" | "warning" }) {
  return <span className={cn("ec-badge", `is-${tone}`, className)}>{children}</span>;
}

export function DockIcon({ className, active = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button className={cn("ec-dock-icon", active && "is-active", className)} {...props}>
      {children}
    </button>
  );
}

export function Button({ className, children, variant = "default", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "ghost" | "outline" | "danger" }) {
  return (
    <button className={cn("ec-btn", `is-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

export function Toggle({ className, checked, label, onClick }: { className?: string; checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={cn("ec-toggle", checked && "is-on", className)} onClick={onClick} aria-pressed={checked}>
      <span className="ec-toggle__dot" />
      <span>{label}</span>
    </button>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (value: string) => void }) {
  return (
    <div className="ec-tabs" role="tablist" aria-label="Tabs">
      {tabs.map((tab) => (
        <button key={tab} role="tab" aria-selected={active === tab} className={cn("ec-tab", active === tab && "is-active")} onClick={() => onChange(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

export function ListRow({ className, title, description, trailing, onClick }: { className?: string; title: string; description?: string; trailing?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className={cn("ec-list-row", className)} onClick={onClick}>
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {trailing ? <span>{trailing}</span> : null}
    </button>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="ec-empty-state">
      <h3>{title}</h3>
      <p>{text}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function ConnectCard({ title, text, note, action }: { title: string; text: string; note: string; action?: ReactNode }) {
  return (
    <Card className="ec-connect-card">
      <h3>{title}</h3>
      <p>{text}</p>
      <small>{note}</small>
      {action ? <div>{action}</div> : null}
    </Card>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="ec-modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="ec-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="ec-modal__actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="ec-toast">{message}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("ec-skeleton", className)} aria-hidden="true" />;
}
