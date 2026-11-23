import fragmentSource from "../shaders/fragment.glsl";
import vertexSource from "../shaders/vertex.glsl";
import { createProgram } from "./program";
import { initQuad } from "./quad";
import { setResolution } from "./uniforms";

type GLWithProgram = WebGLRenderingContext & { program?: WebGLProgram };

// Orb Look Configuration - Tuned for "soft-ink holographic"
const ORB_LOOK = {
  fogA: [0.62, 0.72, 1.0],     // soft periwinkle (normalized 0-1 from #9fb8ff)
  fogB: [0.65, 0.94, 1.0],     // soft cyan (normalized 0-1 from #a7f0ff)
  fogStrength: 0.35,          // lower = less gray wash
  opacity: 0.78,              // slightly transparent
  rimStrength: 0.55,          // gentle rim
  rimSoftness: 2.2,           // softer falloff
  noiseAmp: 0.22,             // less “mud”
  saturation: 1.12            // tiny boost
};

export function initGL(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
  if (!gl) {
    throw new Error("WebGL not supported");
  }

  const program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(program);

  (gl as GLWithProgram).program = program;

  // Set new ORB_LOOK uniforms
  gl.uniform3fv(gl.getUniformLocation(program, "uFogA"), new Float32Array(ORB_LOOK.fogA));
  gl.uniform3fv(gl.getUniformLocation(program, "uFogB"), new Float32Array(ORB_LOOK.fogB));
  gl.uniform1f(gl.getUniformLocation(program, "uFogStrength"), ORB_LOOK.fogStrength);
  gl.uniform1f(gl.getUniformLocation(program, "uOpacity"), ORB_LOOK.opacity);
  gl.uniform1f(gl.getUniformLocation(program, "uRimStrength"), ORB_LOOK.rimStrength);
  gl.uniform1f(gl.getUniformLocation(program, "uRimSoftness"), ORB_LOOK.rimSoftness);
  gl.uniform1f(gl.getUniformLocation(program, "uNoiseAmp"), ORB_LOOK.noiseAmp);
  gl.uniform1f(gl.getUniformLocation(program, "uSaturation"), ORB_LOOK.saturation);

  initQuad(gl, program);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); // Already transparent black
  gl.clear(gl.COLOR_BUFFER_BIT);

  setResolution(gl, program, canvas.width, canvas.height);

  return gl;
}
