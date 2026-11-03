"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/os/primitives";

export function AppSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card>
      <p className="ec-overline">{title}</p>
      {subtitle ? <h2>{subtitle}</h2> : null}
      {children}
    </Card>
  );
}
