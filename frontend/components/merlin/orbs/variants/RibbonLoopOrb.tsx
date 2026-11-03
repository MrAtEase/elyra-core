"use client";

import { useEffect, useRef } from "react";

import type { OrbComponentProps } from "@/components/merlin/orbs/orbRegistry";

// ── GLSL shaders ────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vNormal  = normalize(normalMatrix * normal);
  vec4 mv  = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vViewDir;

/* Thin-film iridescence — maps viewing angle to a spectral colour band. */
vec3 thinFilm(float cosTheta, float thickness) {
  float t = fract(cosTheta * thickness + uTime * 0.06);
  vec3 c;
  if (t < 0.25)      c = mix(vec3(1.0,0.42,0.65), vec3(0.72,0.28,0.92), t * 4.0);
  else if (t < 0.50) c = mix(vec3(0.72,0.28,0.92), vec3(0.22,0.80,0.86), (t-0.25)*4.0);
  else if (t < 0.75) c = mix(vec3(0.22,0.80,0.86), vec3(0.18,0.38,0.90), (t-0.50)*4.0);
  else               c = mix(vec3(0.18,0.38,0.90), vec3(1.0,0.42,0.65), (t-0.75)*4.0);
  return c;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  float NdotV = max(dot(N, V), 0.0);

  /* Fresnel power rim */
  float fresnel = pow(1.0 - NdotV, 3.5);

  /* Iridescent colour from angle */
  vec3 iri = thinFilm(NdotV, 2.6);

  /* Deep purple base */
  vec3 base = vec3(0.10, 0.03, 0.22);

  /* Two-light rig */
  vec3  L1    = normalize(vec3(-0.45, 0.65, 0.85));
  vec3  L2    = normalize(vec3( 0.55,-0.30, 0.60));
  float diff  = max(dot(N, L1), 0.0)
              + max(dot(N, L2), 0.0) * 0.30
              + 0.28;

  /* Specular highlights (Blinn-Phong) */
  vec3  H1    = normalize(L1 + V);
  vec3  H2    = normalize(L2 + V);
  float spec  = pow(max(dot(N, H1), 0.0), 140.0) * 1.4
              + pow(max(dot(N, H2), 0.0),  55.0) * 0.45;

  /* Compose final colour */
  vec3 col = mix(base, iri, 0.60 + fresnel * 0.25) * diff;
  col += vec3(1.0)              * spec;
  col += iri                    * fresnel * 0.55;
  col += vec3(0.92, 0.88, 1.0) * fresnel * 0.22;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Component ───────────────────────────────────────────────────────────────

type ThreeState = {
  raf:      number;
  renderer: unknown;
  mesh:     unknown;
  scene:    unknown;
  camera:   unknown;
  clock:    unknown;
  disposed: boolean;
};

export default function RibbonLoopOrb({
  className,
  size = 200,
  preview,
}: OrbComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef     = useRef<ThreeState>({
    raf: 0, renderer: null, mesh: null, scene: null, camera: null, clock: null, disposed: false,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const s = stateRef.current;
    s.disposed = false;

    // Dynamic import keeps Three.js tree-shakable in Next.js
    void import("three").then((T) => {
      if (s.disposed) return;

      // Renderer
      const renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(size, size);
      renderer.setClearColor(0x000000, 0);
      el.appendChild(renderer.domElement);
      s.renderer = renderer;

      // Scene
      const scene = new T.Scene();
      s.scene = scene;

      // Camera
      const camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0, 3.2);
      s.camera = camera;

      // Sphere + iridescent shader
      const geo = new T.SphereGeometry(1, 64, 64);
      const mat = new T.ShaderMaterial({
        vertexShader:   VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 } },
      });
      const mesh = new T.Mesh(geo, mat);
      scene.add(mesh);
      s.mesh = mesh;

      // Ambient fill
      scene.add(new T.AmbientLight(0xffffff, 0.15));

      // Clock
      const clock = new T.Clock();
      s.clock = clock;

      if (preview) {
        mesh.rotation.y = 0.6;
        mesh.rotation.x = 0.15;
        mat.uniforms.uTime.value = 1.2;
        renderer.render(scene, camera);
        return;
      }

      function animate() {
        if (s.disposed) return;
        const elapsed = clock.getElapsedTime();
        mesh.rotation.y = elapsed * 0.18;
        mesh.rotation.x = Math.sin(elapsed * 0.12) * 0.08;
        mat.uniforms.uTime.value = elapsed;
        renderer.render(scene, camera);
        s.raf = requestAnimationFrame(animate);
      }
      s.raf = requestAnimationFrame(animate);
    });

    return () => {
      s.disposed = true;
      cancelAnimationFrame(s.raf);

      const renderer = s.renderer as { dispose: () => void; domElement: HTMLElement } | null;
      const mesh     = s.mesh as { geometry: { dispose: () => void }; material: { dispose: () => void } } | null;

      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
      s.renderer = null;
      s.scene    = null;
      s.camera   = null;
      s.mesh     = null;
      s.clock    = null;
    };
  }, [size, preview]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}
    />
  );
}
