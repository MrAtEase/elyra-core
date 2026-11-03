"use client";

import { useRef, useState } from "react";
import { Orb } from "@/components/Orb";

type OrbOverlayProps = {
  onActivate: () => void;
};

export default function OrbOverlay({ onActivate }: OrbOverlayProps) {
  const [pulsing, setPulsing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    onActivate();
    setPulsing(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setPulsing(false), 600);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-9 z-[190] flex justify-center pt-3">
      <button
        type="button"
        onClick={handleClick}
        aria-label="Focus intent line"
        className={`pointer-events-auto rounded-full p-1 outline-none transition-transform duration-300 focus-visible:ring-2 focus-visible:ring-white/30 ${
          pulsing ? "scale-110" : "hover:scale-105"
        }`}
      >
        <Orb className="h-[56px] w-[56px] sm:h-[64px] sm:w-[64px]" />
      </button>
    </div>
  );
}
