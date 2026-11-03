"use client";

import AIDock, { type AIDockProps } from "@/components/agent/AIDock";

export type AgentConsoleRailProps = AIDockProps & {
  onWidthChange?: (width: number) => void;
};

export default function AgentConsoleRail({ onWidthChange, ...props }: AgentConsoleRailProps) {
  return <AIDock {...props} onWidthChange={onWidthChange} />;
}
