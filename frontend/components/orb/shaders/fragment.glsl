precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

uniform vec3 uFogA;
uniform vec3 uFogB;
uniform float uFogStrength;
uniform float uOpacity;
uniform float uRimStrength;
uniform float uRimSoftness;
uniform float uNoiseAmp;
uniform float uSaturation;

float sphere(vec3 p, float r) {
  return length(p) - r;
}

// Simple pseudo-random noise function
float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec3 ro = vec3(0.0, 0.0, 2.5);
  vec3 rd = normalize(vec3(uv, -1.5));

  float d = 0.0;
  vec3 p = ro; // Initialize p
  float s = 0.0; // Initialize s

  for (int i = 0; i < 64; i++) {
    p = ro + rd * d;
    s = sphere(p, 0.6 + 0.05 * sin(u_time * 0.1));
    d += s * 0.6;
  }

  // Calculate surface normal (n) and view direction (vViewDir)
  vec3 n = normalize(p); // For a sphere centered at origin, normal at point p is normalize(p)
  vec3 vViewDir = normalize(-rd); // View direction from surface to camera

  // --- Noise for subtle shifts ---
  // Using uNoiseAmp to control the impact of noise, preventing muddiness
  float noise = rand(uv * 10.0 + u_time * 0.05) * uNoiseAmp;

  // --- Fog Color (milky, subtle tint) ---
  vec3 fogCol = mix(uFogA, uFogB, 0.5 + 0.5*sin(u_time*0.15 + noise*1.2));
  fogCol = mix(vec3(1.0), fogCol, uSaturation); // gentle color presence

  // --- Rim Light (soft depth) ---
  // fresnel effect based on normal and view direction
  float fres = pow(1.0 - max(dot(n, vViewDir), 0.0), uRimSoftness);
  vec3 rimCol = fogCol * (0.35 + 0.65*fres) * uRimStrength;

  // --- Base color (transparent, hazy) ---
  vec3 base = fogCol * uFogStrength;

  // --- Combined color ---
  vec3 col = base + rimCol;

  // --- Alpha (transparency with subtle noise) ---
  float alpha = uOpacity * (0.65 + 0.35*noise); // make orb slightly more transparent with noise

  gl_FragColor = vec4(col, alpha);
}
