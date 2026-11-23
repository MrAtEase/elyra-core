import type { ReactNode } from "react";

type ModuleHeaderProps = {
  moduleLabel: string;
  categoryLabel?: string;
  subtitle?: ReactNode;
  rightSlot?: ReactNode;
};

export default function ModuleHeader({
  moduleLabel,
  categoryLabel = "Work",
  subtitle,
  rightSlot,
}: ModuleHeaderProps) {
  return (
    <div className="module-header">
      <div className="module-header__left">
        <div className="module-header__kicker">
          {categoryLabel} · {moduleLabel}
        </div>
        {subtitle && <p className="module-header__subtitle">{subtitle}</p>}
      </div>
      {rightSlot && <div className="module-header__right">{rightSlot}</div>}
    </div>
  );
}
