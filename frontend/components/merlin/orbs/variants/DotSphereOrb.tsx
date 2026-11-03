"use client";

import { useEffect, useRef } from "react";
import type { SystemState } from "@/components/merlin/systemState";

export type DotSphereVariant = "cosmicDust" | "tealMatrix" | "darkScatter";

type Props = {
  className?: string;
  preview?: boolean;
  size?: number;
  systemState?: SystemState;
  variant?: DotSphereVariant;
};

type Dot = {
  x: number;
  y: number;
  z: number;
  baseSize: number;
};

// ── Variant configs ────────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  DotSphereVariant,
  {
    dotCount: number;
    dotColor: (alpha: number) => string;
    glowColor: string;
    bgColor: string;
    rotationSpeed: number;
    /** Min dot render size */
    minSize: number;
    maxSize: number;
    /** Whether to use a grid/halftone distribution instead of random */
    structured: boolean;
    /** Pulse wave amplitude (0 = none) */
    pulseAmp: number;
  }
> = {
  // Claude style: diffuse purple/blue particle cloud
  cosmicDust: {
    dotCount: 700,
    dotColor: (a) => `rgba(130, 100, 255, ${a})`,
    glowColor: "rgba(100, 80, 220, 0.18)",
    bgColor: "rgba(4, 2, 14, 1)",
    rotationSpeed: 0.004,
    minSize: 0.6,
    maxSize: 2.2,
    structured: false,
    pulseAmp: 0.4,
  },
  // Gemini style: teal structured halftone dots
  tealMatrix: {
    dotCount: 500,
    dotColor: (a) => `rgba(0, 210, 180, ${a})`,
    glowColor: "rgba(0, 200, 160, 0.2)",
    bgColor: "rgba(0, 8, 16, 1)",
    rotationSpeed: 0.006,
    minSize: 1.0,
    maxSize: 3.2,
    structured: true,
    pulseAmp: 0.35,
  },
  // Deepseek style: dark blue/grey scattered dots
  darkScatter: {
    dotCount: 600,
    dotColor: (a) => `rgba(60, 120, 210, ${a})`,
    glowColor: "rgba(40, 80, 180, 0.15)",
    bgColor: "rgba(2, 4, 12, 1)",
    rotationSpeed: 0.003,
    minSize: 0.8,
    maxSize: 2.5,
    structured: false,
    pulseAmp: 0.25,
  },
};

// ── Fibonacci sphere distribution ─────────────────────────────────────────────
function buildFibonacciSphere(n: number): Dot[] {
  const dots: Dot[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    dots.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, baseSize: 1 });
  }
  return dots;
}

// ── Structured grid sphere (halftone-ish) ─────────────────────────────────────
function buildGridSphere(n: number): Dot[] {
  const dots: Dot[] = [];
  const rings = Math.round(Math.sqrt(n));
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    const ringRadius = Math.sin(phi);
    const ringDots = Math.max(1, Math.round(rings * 2 * ringRadius));
    for (let j = 0; j < ringDots; j++) {
      const theta = (2 * Math.PI * j) / ringDots;
      dots.push({
        x: ringRadius * Math.cos(theta),
        y: Math.cos(phi),
        z: ringRadius * Math.sin(theta),
        baseSize: 1,
      });
    }
  }
  return dots;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DotSphereOrb({
  className,
  preview,
  size,
  systemState,
  variant = "tealMatrix",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReducedMotion =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;

    const cfg = VARIANT_CONFIG[variant];
    const dots: Dot[] =
      cfg.structured ? buildGridSphere(cfg.dotCount) : buildFibonacciSphere(cfg.dotCount);

    const render = (ts: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const radius = Math.min(W, H) * 0.42;
      const fov = Math.min(W, H) * 1.2;

      // Clear
      ctx.clearRect(0, 0, W, H);

      // Draw glow core
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.9);
      grd.addColorStop(0, cfg.glowColor);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      if (!startRef.current) startRef.current = ts;
      const elapsed = (ts - startRef.current) / 1000;
      const angle = prefersReducedMotion ? 0.2 : elapsed * cfg.rotationSpeed * Math.PI * 2;
      const tilt = 0.35; // radians — slight downward tilt for 3D feel

      // Rotation: Y-axis spin + slight X tilt
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);

      // Compute depth-sorted projected dots
      const projected = dots.map((dot) => {
        // Rotate around Y axis
        const rx = dot.x * cosA - dot.z * sinA;
        const ry = dot.y;
        const rz = dot.x * sinA + dot.z * cosA;
        // Tilt around X axis
        const ty = ry * cosT - rz * sinT;
        const tz = ry * sinT + rz * cosT;
        // Perspective projection
        const scale = fov / (fov + tz * radius);
        const px = cx + rx * radius * scale;
        const py = cy + ty * radius * scale;
        // Depth ratio: front = 1, back = 0
        const depth = (tz + 1) / 2;
        return { px, py, depth, tz };
      });

      // Sort by depth (back-to-front for correct overdraw)
      projected.sort((a, b) => a.depth - b.depth);

      for (const { px, py, depth } of projected) {
        // Pulse wave based on depth + time
        const pulse = cfg.pulseAmp > 0
          ? 1 + cfg.pulseAmp * Math.sin(elapsed * 2.2 + depth * 8)
          : 1;

        const alpha = depth * 0.85 + 0.15;
        const dotSize = (cfg.minSize + depth * (cfg.maxSize - cfg.minSize)) * pulse;

        ctx.beginPath();
        ctx.arc(px, py, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = cfg.dotColor(alpha);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    if (!preview) {
      rafRef.current = requestAnimationFrame(render);
    } else {
      // Static render for preview thumbnails
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const W = canvas.width;
        const H = canvas.height;
        const cx = W / 2;
        const cy = H / 2;
        const radius = Math.min(W, H) * 0.42;
        const fov = Math.min(W, H) * 1.2;
        const angle = 0.3;
        const tilt = 0.35;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const cosT = Math.cos(tilt);
        const sinT = Math.sin(tilt);
        const cfg2 = VARIANT_CONFIG[variant];
        const dots2 = cfg2.structured ? buildGridSphere(cfg2.dotCount) : buildFibonacciSphere(cfg2.dotCount);
        // Glow
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.9);
        grd.addColorStop(0, cfg2.glowColor);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        const projected2 = dots2.map((dot) => {
          const rx = dot.x * cosA - dot.z * sinA;
          const ry = dot.y;
          const rz = dot.x * sinA + dot.z * cosA;
          const ty = ry * cosT - rz * sinT;
          const tz = ry * sinT + rz * cosT;
          const scale = fov / (fov + tz * radius);
          const px = cx + rx * radius * scale;
          const py = cy + ty * radius * scale;
          const depth = (tz + 1) / 2;
          return { px, py, depth };
        });
        projected2.sort((a, b) => a.depth - b.depth);
        for (const { px, py, depth } of projected2) {
          const alpha = depth * 0.85 + 0.15;
          const dotSize = cfg2.minSize + depth * (cfg2.maxSize - cfg2.minSize);
          ctx.beginPath();
          ctx.arc(px, py, dotSize, 0, Math.PI * 2);
          ctx.fillStyle = cfg2.dotColor(alpha);
          ctx.fill();
        }
      }
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [variant, preview, systemState]);

  const canvasSize = size ?? 240;

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize}
      height={canvasSize}
      className={className}
      style={{ display: "block", background: "transparent" }}
      aria-hidden="true"
    />
  );
}

// ── Named exports for each variant (for ergonomic registry usage) ──────────────
export function CosmicDustOrb(props: Omit<Props, "variant">) {
  return <DotSphereOrb {...props} variant="cosmicDust" />;
}

export function TealMatrixOrb(props: Omit<Props, "variant">) {
  return <DotSphereOrb {...props} variant="tealMatrix" />;
}

export function DarkScatterOrb(props: Omit<Props, "variant">) {
  return <DotSphereOrb {...props} variant="darkScatter" />;
}
