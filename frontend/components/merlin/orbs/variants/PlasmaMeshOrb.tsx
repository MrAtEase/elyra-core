"use client";

import { useEffect, useMemo, useRef } from "react";

import type { SystemState } from "@/components/merlin/systemState";

type Props = {
  className?: string;
  preview?: boolean;
  size?: number;
  systemState?: SystemState;
};

const getReducedMotionPreference = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)")?.matches ?? false;
};

export default function PlasmaMeshOrb({ className, size, preview }: Props) {
  const reducedMotion = useMemo(getReducedMotionPreference, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inlineSize = size ? { width: size, height: size } : undefined;
  const animate = !reducedMotion && !preview;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (timeMs = 0) => {
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.max(1, Math.min(w, h) / 2);
      ctx.clearRect(0, 0, w, h);

      const background = ctx.createLinearGradient(0, 0, w, h);
      background.addColorStop(0, "rgba(5, 10, 28, 1)");
      background.addColorStop(0.45, "rgba(11, 24, 58, 1)");
      background.addColorStop(1, "rgba(2, 6, 20, 1)");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      const halo = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      halo.addColorStop(0, "rgba(96, 218, 255, 0.35)");
      halo.addColorStop(0.5, "rgba(17, 38, 84, 0.7)");
      halo.addColorStop(1, "rgba(3, 8, 24, 1)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 0; i < 6; i++) {
        const phase = timeMs * 0.0007 + i * 0.9;
        const startAngle = phase;
        const endAngle = phase + Math.PI * 1.1 + Math.sin(timeMs * 0.001 + i) * 0.35;
        const lengthRadius = radius * (0.4 + i * 0.08);
        const startX = cx + Math.cos(startAngle) * lengthRadius;
        const startY = cy + Math.sin(startAngle) * lengthRadius;
        const endX = cx + Math.cos(endAngle) * lengthRadius * 0.8;
        const endY = cy + Math.sin(endAngle) * lengthRadius * 0.8;
        const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
        const alpha = 0.65 - i * 0.07;
        gradient.addColorStop(0, `rgba(118, 241, 255, ${Math.max(alpha, 0.2)})`);
        gradient.addColorStop(0.4, `rgba(255, 128, 255, ${Math.max(alpha - 0.2, 0.1)})`);
        gradient.addColorStop(1, `rgba(255, 207, 116, ${Math.max(alpha - 0.3, 0.05)})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2 + i * 0.4;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    };

    const handleResize = () => {
      resize();
      draw(0);
    };

    window.addEventListener("resize", handleResize);
    resize();
    draw(0);

    if (animate) {
      const loop = (time: number) => {
        draw(time);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
    };
  }, [animate]);

  return (
    <div className={`plasma-mesh-orb ${className ?? ""}`} style={inlineSize}>
      <canvas ref={canvasRef} />
    </div>
  );
}
