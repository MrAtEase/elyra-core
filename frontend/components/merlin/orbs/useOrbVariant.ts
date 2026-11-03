"use client";

import { useCallback } from "react";

import { useAppearance } from "@/components/merlin/settings/appearance";
import type { OrbVariant } from "./orbRegistry";

export function useOrbVariant(): [OrbVariant, (variant: OrbVariant) => void] {
  const [appearance, setAppearance] = useAppearance();

  const setVariant = useCallback(
    (value: OrbVariant) => {
      setAppearance({ orbVariant: value });
    },
    [setAppearance],
  );

  return [appearance.orbVariant, setVariant];
}
