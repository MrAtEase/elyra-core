"use client";

import type { ReactNode } from "react";

type SettingsShellProps = {
  children: ReactNode;
};

export default function SettingsShell({ children }: SettingsShellProps) {
  return <section className="settings-shell">{children}</section>;
}
