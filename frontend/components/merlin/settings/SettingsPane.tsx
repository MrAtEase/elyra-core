"use client";

import type { ReactNode } from "react";

import SettingsScopeBadge from "./SettingsScopeBadge";
import type { SettingsScope } from "./settingsConfig";

type SettingsPaneProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  scope?: SettingsScope;
  children?: ReactNode;
};

export default function SettingsPane({ eyebrow, title, description, scope, children }: SettingsPaneProps) {
  return (
    <section className="settings-pane">
      <header className="settings-pane__header">
        {scope && <SettingsScopeBadge scope={scope} />}
        {eyebrow && <p className="settings-pane__eyebrow">{eyebrow}</p>}
        <div>
          <h2>{title}</h2>
          {description && <p className="settings-pane__desc">{description}</p>}
        </div>
      </header>
      <div className="settings-pane__body">{children}</div>
    </section>
  );
}
