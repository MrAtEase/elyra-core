"use client";

import { useEffect, useRef } from "react";
import Experience from "./organic/Experience";

export type OrbVisualState =
  | "idle"
  | "hover"
  | "active"
  | "thinking"
  | "planning"
  | "listening"
  | "executing"
  | "waiting_for_auth"
  | "waiting_for_approval"
  | "warning"
  | "success"
  | "error";

type Props = {
  size?: number;
  state?: OrbVisualState;
};

export default function OrganicSphere({ size, state = "idle" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const experienceRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    experienceRef.current = new Experience({
      targetElement: containerRef.current,
      ...(typeof size === "number" ? { size } : {}),
    });

    return () => {
      experienceRef.current?.destroy?.();
      experienceRef.current = null;
    };
  }, [size]);

  // Push state changes into the live Three.js sphere
  useEffect(() => {
    if (!experienceRef.current?.sphere) return;
    experienceRef.current.sphere.setState(state);
  }, [state]);

  const sizeStyle =
    typeof size === "number"
      ? { width: size, height: size }
      : { width: "100%", height: "100%" };

  return (
    <div className="orbWrap" style={sizeStyle}>
      <div ref={containerRef} className="organic-sphere" />
      {/* 3D sphere skin overlays; tune opacity/blur/durations in globals.css. */}
      <div className="orbSkin" aria-hidden="true">
        <div className="orbShade orbOverlay" />
        <div className="orbSpecular orbOverlay" />
        <div className="orbRim orbOverlay" />
        <div className="orbGlassNoise orbOverlay" />
      </div>
    </div>
  );
}
