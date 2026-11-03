"use client";

import { useEffect, useRef } from "react";

import type { OrbComponentProps } from "../orbRegistry";
import { STATE_PRESETS, type SystemState } from "@/components/merlin/systemState";

// ─── Fibonacci sphere ───────────────────────────────────────────────────────
function mkSphere(n: number): number[] {
  const out: number[] = [];
  const phi = Math.PI * (3.0 - Math.sqrt(5.0));
  for (let i = 0; i < n; i++) {
    const y = 1.0 - (i / (n - 1)) * 2.0;
    const r = Math.sqrt(Math.max(0, 1.0 - y * y));
    const theta = phi * i;
    out.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
  }
  return out;
}

const SPHERE = mkSphere(680);
const N = SPHERE.length / 3;

// ─── Component ──────────────────────────────────────────────────────────────
export default function ThinkingOrb({ size = 200, systemState, className }: OrbComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stRef     = useRef<SystemState | undefined>(systemState);
  stRef.current   = systemState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext("2d", { alpha: true });
    if (!ctxRaw) return;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ctx: CanvasRenderingContext2D = ctxRaw;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    // --- smoothed live config ---
    // calm:    slow, gentle pulse
    // working: moderate rotation, active pulse
    // attention: fast rotation, bright
    // error:   fastest, high intensity
    let sRotY   = 0.003;
    let sPSpeed = 1.6;
    let sPAmp   = 0.38;
    let sGlow   = 0.16;
    let sBright = 0.85;

    // Rotation accumulators
    let angleY = 0;
    const tiltX = 0.22; // fixed tilt so we see the top of the sphere
    const cosXConst = Math.cos(tiltX);
    const sinXConst = Math.sin(tiltX);

    let tick = 0;
    let raf: number;

    // reusable arrays (avoid GC churn)
    const dX: number[]     = new Array<number>(N).fill(0);
    const dY: number[]     = new Array<number>(N).fill(0);
    const dZ: number[]     = new Array<number>(N).fill(0);
    const dA: number[]     = new Array<number>(N).fill(0);
    const dR: number[]     = new Array<number>(N).fill(0);
    const order: number[]  = Array.from({ length: N }, (_, i) => i);

    function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

    function frame() {
      tick++;

      // Map SystemState → animation config
      const preset = STATE_PRESETS[stRef.current ?? "calm"];
      const targetRotY   = preset.speed * 0.006;
      const targetPSpeed = preset.speed * 2.8;
      const targetPAmp   = 0.3 + preset.wobble * 0.6;
      const targetGlow   = preset.glow * 0.45;
      const targetBright = 0.8 + preset.glow * 0.3;

      const L = 0.04;
      sRotY   = lerp(sRotY,   targetRotY,   L);
      sPSpeed = lerp(sPSpeed, targetPSpeed, L);
      sPAmp   = lerp(sPAmp,   targetPAmp,   L);
      sGlow   = lerp(sGlow,   targetGlow,   L);
      sBright = lerp(sBright, targetBright, L);

      angleY += sRotY;

      const cx = size * 0.5;
      const cy = size * 0.5;
      const R  = size * 0.37;
      const FL = size * 2.2;

      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const t    = tick / 60;

      // Project all points
      for (let i = 0; i < N; i++) {
        const px = SPHERE[i * 3]     ?? 0;
        const py = SPHERE[i * 3 + 1] ?? 0;
        const pz = SPHERE[i * 3 + 2] ?? 0;

        // Rotate Y
        const rx  =  cosY * px + sinY * pz;
        const ry  =  py;
        const rz  = -sinY * px + cosY * pz;

        // Rotate X (tilt)
        const rx2 = rx;
        const ry2 =  cosXConst * ry - sinXConst * rz;
        const rz2 =  sinXConst * ry + cosXConst * rz;

        // Perspective
        const zp = rz2 * R + FL;
        const sc = FL / zp;
        dX[i] = cx + rx2 * R * sc;
        dY[i] = cy + ry2 * R * sc;
        dZ[i] = rz2;

        // Depth 0→1 (back→front)
        const depth = (rz2 + 1.0) * 0.5;

        // Pulse wave along latitude bands
        const lat  = Math.acos(Math.max(-1, Math.min(1, ry2)));
        const wave = 0.5 + 0.5 * Math.sin(lat * 4.5 - t * sPSpeed);
        const pulse = 1.0 - sPAmp + sPAmp * wave;

        dA[i] = Math.pow(depth, 0.55) * pulse * sBright;
        // dot radius: smaller at back, bigger at front + perspective scale
        dR[i] = (0.6 + depth * 1.8) * sc * (size / 200);
      }

      // Sort back-to-front
      order.sort((a, b) => (dZ[a] ?? 0) - (dZ[b] ?? 0));

      // Clear
      ctx.clearRect(0, 0, size, size);

      // Detect light/dark mode each frame (responds to live theme changes)
      const isDark = document.documentElement.classList.contains("dark");

      // Ambient glow
      if (sGlow > 0.03) {
        const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
        if (isDark) {
          g0.addColorStop(0,   `rgba(72,110,255,${(sGlow * 0.22).toFixed(3)})`);
          g0.addColorStop(0.5, `rgba(48, 80,200,${(sGlow * 0.10).toFixed(3)})`);
        } else {
          g0.addColorStop(0,   `rgba(8,145,178,${(sGlow * 0.18).toFixed(3)})`);
          g0.addColorStop(0.5, `rgba(6,110,140,${(sGlow * 0.08).toFixed(3)})`);
        }
        g0.addColorStop(1,   "rgba(0,0,0,0)");
        ctx.fillStyle = g0;
        ctx.fillRect(0, 0, size, size);
      }

      // Dots
      for (let ii = 0; ii < N; ii++) {
        const i = order[ii] ?? ii;
        const a = dA[i] ?? 0;
        if (a < 0.025) continue;

        const depth = ((dZ[i] ?? 0) + 1.0) * 0.5;

        let rC: number, gC: number, bC: number;
        if (isDark) {
          // Dark mode: deep navy (back) → electric cyan-white (front)
          rC = Math.round(18  + depth * 200);
          gC = Math.round(60  + depth * 180);
          bC = Math.round(200 + depth *  55);
        } else {
          // Light mode: dark teal (back) → vivid cyan (front)
          rC = Math.round(4   + depth *  20);
          gC = Math.round(50  + depth * 110);
          bC = Math.round(100 + depth *  80);
        }

        ctx.beginPath();
        ctx.arc(dX[i] ?? cx, dY[i] ?? cy, Math.max(0.25, dR[i] ?? 0.5), 0, 6.2832);
        ctx.fillStyle = `rgba(${rC},${gC},${bC},${Math.min(1, a).toFixed(3)})`;
        ctx.fill();
      }

      // Central highlight glow (front face only)
      if (sGlow > 0.06) {
        const g1 = ctx.createRadialGradient(cx, cy * 0.96, 0, cx, cy, R * 0.55);
        if (isDark) {
          g1.addColorStop(0, `rgba(200,230,255,${(sGlow * 0.14).toFixed(3)})`);
        } else {
          g1.addColorStop(0, `rgba(8,120,150,${(sGlow * 0.12).toFixed(3)})`);
        }
        g1.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, size, size);
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: "block" }}
      className={className}
    />
  );
}
