"use client";

import AIDock, { type AIDockProps } from "@/components/agent/AIDock";

export type ElyPanelProps = AIDockProps;

export default function ElyPanel(props: ElyPanelProps) {
  return <AIDock {...props} />;
}
