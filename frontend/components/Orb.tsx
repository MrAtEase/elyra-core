"use client";

import { useEffect, useRef } from "react";

/**
 * The Orb - luminous, iridescent plasma sphere
 * Hero centerpiece with purple/teal gradient and breathing glow animation
 */
export function Orb({ className = "" }: { className?: string }) {
  const orbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Respect reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion && orbRef.current) {
      orbRef.current.style.animationPlayState = "paused";
    }
  }, []);

  return (
    <div
      ref={orbRef}
      className={`orb ${className}`}
      role="img"
      aria-label="Elyra Core orb - a luminous plasma sphere"
    >
      {/* Core sphere with gradient layers */}
      <div className="orb__core">
        <div className="orb__plasma" />
        <div className="orb__iridescence" />
        <div className="orb__depth" />
        <div className="orb__highlight" />
      </div>
      {/* Outer glow rings */}
      <div className="orb__glow orb__glow--inner" />
      <div className="orb__glow orb__glow--mid" />
      <div className="orb__glow orb__glow--outer" />
    </div>
  );
}
