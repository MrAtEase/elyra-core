import { ORB_PRESETS, type OrbVariant } from "./orbRegistry";
import type { SystemState } from "@/components/merlin/systemState";
import { DEFAULT_STATE } from "@/components/merlin/systemState";

type Props = {
  className?: string;
  preview?: boolean;
  size?: number;
  variant?: OrbVariant;
  systemState?: SystemState;
};

export default function OrbRenderer({ variant, className, preview, size, systemState }: Props) {
  const activePreset = ORB_PRESETS.find((entry) => entry.id === variant) ?? ORB_PRESETS[0];
  if (!activePreset) {
    return null;
  }
  const Component = activePreset.Component;

  const wrapperClassName = ["orb-renderer", className].filter(Boolean).join(" ").trim();

  return (
    <div className={wrapperClassName} data-variant={activePreset.id} aria-hidden="true">
      <Component
        size={size ?? 140}
        preview={preview ?? false}
        className="orb-renderer__surface"
        systemState={systemState ?? DEFAULT_STATE}
      />
    </div>
  );
}
