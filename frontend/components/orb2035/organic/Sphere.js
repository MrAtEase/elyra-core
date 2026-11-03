import * as THREE from "three";

const PERLIN4D = `
// Classic Perlin 3D Noise 
// by Stefan Gustavson
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);} 
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;} 
vec4 fade(vec4 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);} 

float perlin4d(vec4 P){
  vec4 Pi0 = floor(P); // Integer part for indexing
  vec4 Pi1 = Pi0 + 1.0; // Integer part + 1
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec4 Pf0 = fract(P); // Fractional part for interpolation
  vec4 Pf1 = Pf0 - 1.0; // Fractional part - 1.0
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = vec4(Pi0.zzzz);
  vec4 iz1 = vec4(Pi1.zzzz);
  vec4 iw0 = vec4(Pi0.wwww);
  vec4 iw1 = vec4(Pi1.wwww);

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 ixy00 = permute(ixy0 + iw0);
  vec4 ixy01 = permute(ixy0 + iw1);
  vec4 ixy10 = permute(ixy1 + iw0);
  vec4 ixy11 = permute(ixy1 + iw1);

  vec4 gx00 = ixy00 / 7.0;
  vec4 gy00 = floor(gx00) / 7.0;
  vec4 gz00 = floor(gy00) / 6.0;
  gx00 = fract(gx00) - 0.5;
  gy00 = fract(gy00) - 0.5;
  gz00 = fract(gz00) - 0.5;
  vec4 gw00 = vec4(0.75) - abs(gx00) - abs(gy00) - abs(gz00);
  vec4 sw00 = step(gw00, vec4(0.0));
  gx00 -= sw00 * (step(0.0, gx00) - 0.5);
  gy00 -= sw00 * (step(0.0, gy00) - 0.5);

  vec4 gx01 = ixy01 / 7.0;
  vec4 gy01 = floor(gx01) / 7.0;
  vec4 gz01 = floor(gy01) / 6.0;
  gx01 = fract(gx01) - 0.5;
  gy01 = fract(gy01) - 0.5;
  gz01 = fract(gz01) - 0.5;
  vec4 gw01 = vec4(0.75) - abs(gx01) - abs(gy01) - abs(gz01);
  vec4 sw01 = step(gw01, vec4(0.0));
  gx01 -= sw01 * (step(0.0, gx01) - 0.5);
  gy01 -= sw01 * (step(0.0, gy01) - 0.5);

  vec4 gx10 = ixy10 / 7.0;
  vec4 gy10 = floor(gx10) / 7.0;
  vec4 gz10 = floor(gy10) / 6.0;
  gx10 = fract(gx10) - 0.5;
  gy10 = fract(gy10) - 0.5;
  gz10 = fract(gz10) - 0.5;
  vec4 gw10 = vec4(0.75) - abs(gx10) - abs(gy10) - abs(gz10);
  vec4 sw10 = step(gw10, vec4(0.0));
  gx10 -= sw10 * (step(0.0, gx10) - 0.5);
  gy10 -= sw10 * (step(0.0, gy10) - 0.5);

  vec4 gx11 = ixy11 / 7.0;
  vec4 gy11 = floor(gx11) / 7.0;
  vec4 gz11 = floor(gy11) / 6.0;
  gx11 = fract(gx11) - 0.5;
  gy11 = fract(gy11) - 0.5;
  gz11 = fract(gz11) - 0.5;
  vec4 gw11 = vec4(0.75) - abs(gx11) - abs(gy11) - abs(gz11);
  vec4 sw11 = step(gw11, vec4(0.0));
  gx11 -= sw11 * (step(0.0, gx11) - 0.5);
  gy11 -= sw11 * (step(0.0, gy11) - 0.5);

  vec4 g0000 = vec4(gx00.x,gy00.x,gz00.x,gw00.x);
  vec4 g1000 = vec4(gx00.y,gy00.y,gz00.y,gw00.y);
  vec4 g0100 = vec4(gx00.z,gy00.z,gz00.z,gw00.z);
  vec4 g1100 = vec4(gx00.w,gy00.w,gz00.w,gw00.w);
  vec4 g0010 = vec4(gx10.x,gy10.x,gz10.x,gw10.x);
  vec4 g1010 = vec4(gx10.y,gy10.y,gz10.y,gw10.y);
  vec4 g0110 = vec4(gx10.z,gy10.z,gz10.z,gw10.z);
  vec4 g1110 = vec4(gx10.w,gy10.w,gz10.w,gw10.w);
  vec4 g0001 = vec4(gx01.x,gy01.x,gz01.x,gw01.x);
  vec4 g1001 = vec4(gx01.y,gy01.y,gz01.y,gw01.y);
  vec4 g0101 = vec4(gx01.z,gy01.z,gz01.z,gw01.z);
  vec4 g1101 = vec4(gx01.w,gy01.w,gz01.w,gw01.w);
  vec4 g0011 = vec4(gx11.x,gy11.x,gz11.x,gw11.x);
  vec4 g1011 = vec4(gx11.y,gy11.y,gz11.y,gw11.y);
  vec4 g0111 = vec4(gx11.z,gy11.z,gz11.z,gw11.z);
  vec4 g1111 = vec4(gx11.w,gy11.w,gz11.w,gw11.w);

  vec4 norm00 = taylorInvSqrt(vec4(dot(g0000, g0000), dot(g0100, g0100), dot(g1000, g1000), dot(g1100, g1100)));
  g0000 *= norm00.x;
  g0100 *= norm00.y;
  g1000 *= norm00.z;
  g1100 *= norm00.w;

  vec4 norm01 = taylorInvSqrt(vec4(dot(g0001, g0001), dot(g0101, g0101), dot(g1001, g1001), dot(g1101, g1101)));
  g0001 *= norm01.x;
  g0101 *= norm01.y;
  g1001 *= norm01.z;
  g1101 *= norm01.w;

  vec4 norm10 = taylorInvSqrt(vec4(dot(g0010, g0010), dot(g0110, g0110), dot(g1010, g1010), dot(g1110, g1110)));
  g0010 *= norm10.x;
  g0110 *= norm10.y;
  g1010 *= norm10.z;
  g1110 *= norm10.w;

  vec4 norm11 = taylorInvSqrt(vec4(dot(g0011, g0011), dot(g0111, g0111), dot(g1011, g1011), dot(g1111, g1111)));
  g0011 *= norm11.x;
  g0111 *= norm11.y;
  g1011 *= norm11.z;
  g1111 *= norm11.w;

  float n0000 = dot(g0000, Pf0);
  float n1000 = dot(g1000, vec4(Pf1.x, Pf0.yzw));
  float n0100 = dot(g0100, vec4(Pf0.x, Pf1.y, Pf0.zw));
  float n1100 = dot(g1100, vec4(Pf1.xy, Pf0.zw));
  float n0010 = dot(g0010, vec4(Pf0.xy, Pf1.z, Pf0.w));
  float n1010 = dot(g1010, vec4(Pf1.x, Pf0.y, Pf1.z, Pf0.w));
  float n0110 = dot(g0110, vec4(Pf0.x, Pf1.yz, Pf0.w));
  float n1110 = dot(g1110, vec4(Pf1.xyz, Pf0.w));
  float n0001 = dot(g0001, vec4(Pf0.xyz, Pf1.w));
  float n1001 = dot(g1001, vec4(Pf1.x, Pf0.yz, Pf1.w));
  float n0101 = dot(g0101, vec4(Pf0.x, Pf1.y, Pf0.z, Pf1.w));
  float n1101 = dot(g1101, vec4(Pf1.xy, Pf0.z, Pf1.w));
  float n0011 = dot(g0011, vec4(Pf0.xy, Pf1.zw));
  float n1011 = dot(g1011, vec4(Pf1.x, Pf0.y, Pf1.zw));
  float n0111 = dot(g0111, vec4(Pf0.x, Pf1.yzw));
  float n1111 = dot(g1111, Pf1);

  vec4 fade_xyzw = fade(Pf0);
  vec4 n_0w = mix(vec4(n0000, n1000, n0100, n1100), vec4(n0001, n1001, n0101, n1101), fade_xyzw.w);
  vec4 n_1w = mix(vec4(n0010, n1010, n0110, n1110), vec4(n0011, n1011, n0111, n1111), fade_xyzw.w);
  vec4 n_zw = mix(n_0w, n_1w, fade_xyzw.z);
  vec2 n_yzw = mix(n_zw.xy, n_zw.zw, fade_xyzw.y);
  float n_xyzw = mix(n_yzw.x, n_yzw.y, fade_xyzw.x);
  return 2.2 * n_xyzw;
}
`;

const VERTEX_SHADER = `
#define M_PI 3.1415926535897932384626433832795

uniform vec3 uLightAColor;
uniform vec3 uLightAPosition;
uniform float uLightAIntensity;
uniform vec3 uLightBColor;
uniform vec3 uLightBPosition;
uniform float uLightBIntensity;

uniform vec2 uSubdivision;

uniform vec3 uOffset;

uniform float uDistortionFrequency;
uniform float uDistortionStrength;
uniform float uDisplacementFrequency;
uniform float uDisplacementStrength;

uniform float uFresnelOffset;
uniform float uFresnelMultiplier;
uniform float uFresnelPower;

uniform float uTime;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vNoise;

${PERLIN4D}

vec3 getDisplacedPosition(vec3 _position)
{
    vec3 distoredPosition = _position;
    distoredPosition += perlin4d(vec4(distoredPosition * uDistortionFrequency + uOffset, uTime)) * uDistortionStrength;

    float perlinStrength = perlin4d(vec4(distoredPosition * uDisplacementFrequency + uOffset, uTime));
    
    vec3 displacedPosition = _position;
    displacedPosition += normalize(_position) * perlinStrength * uDisplacementStrength;

    return displacedPosition;
}

void main()
{
    float noiseValue = perlin4d(vec4(position * uDisplacementFrequency + uOffset, uTime));

    // Position
    vec3 displacedPosition = getDisplacedPosition(position);
    vec4 viewPosition = viewMatrix * vec4(displacedPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    // Bi tangents
    float distanceA = (M_PI * 2.0) / uSubdivision.x;
    float distanceB = M_PI / uSubdivision.x;

    vec3 biTangent = cross(normal, tangent.xyz);

    vec3 positionA = position + tangent.xyz * distanceA;
    vec3 displacedPositionA = getDisplacedPosition(positionA);

    vec3 positionB = position + biTangent.xyz * distanceB;
    vec3 displacedPositionB = getDisplacedPosition(positionB);

    vec3 computedNormal = cross(displacedPositionA - displacedPosition.xyz, displacedPositionB - displacedPosition.xyz);
    computedNormal = normalize(computedNormal);

    // Fresnel
    vec3 viewDirection = normalize(displacedPosition.xyz - cameraPosition);
    float fresnel = uFresnelOffset + (1.0 + dot(viewDirection, computedNormal)) * uFresnelMultiplier;
    fresnel = pow(max(0.0, fresnel), uFresnelPower);

    // Color
    float lightAIntensity = max(0.0, - dot(computedNormal.xyz, normalize(- uLightAPosition))) * uLightAIntensity;
    float lightBIntensity = max(0.0, - dot(computedNormal.xyz, normalize(- uLightBPosition))) * uLightBIntensity;

    vec3 color = vec3(0.0);
    color = mix(color, uLightAColor, lightAIntensity * fresnel);
    color = mix(color, uLightBColor, lightBIntensity * fresnel);
    color = mix(color, vec3(1.0), clamp(pow(max(0.0, fresnel - 0.8), 3.0), 0.0, 1.0));

    // Varying
    vColor = color;
    vNormal = normalize(normalMatrix * computedNormal);
    vViewDir = normalize(-viewPosition.xyz);
    vNoise = clamp(noiseValue * 0.5 + 0.5, 0.0, 1.0);
}
`;

const HALO_VERTEX_SHADER = `
varying vec3 vNormal;
varying vec3 vViewDir;

void main()
{
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
}
`;

const HALO_FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uIntensity;

varying vec3 vNormal;
varying vec3 vViewDir;

void main()
{
    float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.2);
    float alpha = rim * uIntensity;
    gl_FragColor = vec4(uColor, alpha);
}
`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vNoise;

void main()
{
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.6);

    float n = clamp(vNoise, 0.0, 1.0);
    float shift = clamp(n + fresnel * 0.75, 0.0, 1.0);

    vec3 deepBase = vec3(0.043, 0.063, 0.125);
    vec3 cyan = vec3(0.0, 0.898, 1.0);
    vec3 violet = vec3(0.545, 0.361, 0.965);
    vec3 magenta = vec3(1.0, 0.31, 0.847);

    vec3 iridescent = mix(cyan, violet, smoothstep(0.05, 0.7, shift));
    iridescent = mix(iridescent, magenta, smoothstep(0.35, 0.92, shift));

    vec3 col = mix(deepBase, iridescent, 0.68 + 0.22 * n);
    col = mix(col, vColor, 0.22);

    vec3 rimColor = mix(cyan, magenta, shift);
    col += rimColor * fresnel * 1.1;
    col += iridescent * (0.16 + 0.18 * n);

    float alpha = 0.5 + fresnel * 0.35;
    gl_FragColor = vec4(col, alpha);
}
`;

// ── State → visual palette mapping ────────────────────────────────────────────
// Each state defines lightA color, lightB color, speed multiplier, and halo color.
const STATE_PALETTES = {
  idle:       { a: "#8b5cf6", b: "#00e5ff", speed: 1.0,  halo: "#b6f1ff", intensity: 1.0 },
  hover:      { a: "#a78bfa", b: "#38bdf8", speed: 1.1,  halo: "#c8f0ff", intensity: 1.05 },
  active:     { a: "#a78bfa", b: "#38bdf8", speed: 1.2,  halo: "#c8f0ff", intensity: 1.1 },
  thinking:   { a: "#6366f1", b: "#22d3ee", speed: 1.8,  halo: "#a5f3fc", intensity: 1.2 },
  planning:   { a: "#7c3aed", b: "#0ea5e9", speed: 1.6,  halo: "#bae6fd", intensity: 1.15 },
  listening:  { a: "#8b5cf6", b: "#34d399", speed: 1.4,  halo: "#a7f3d0", intensity: 1.1  },
  executing:  { a: "#4f46e5", b: "#06b6d4", speed: 2.2,  halo: "#67e8f9", intensity: 1.3 },
  waiting_for_auth:     { a: "#f59e0b", b: "#fbbf24", speed: 0.9,  halo: "#fde68a", intensity: 0.95 },
  waiting_for_approval: { a: "#d97706", b: "#f59e0b", speed: 0.85, halo: "#fcd34d", intensity: 0.9 },
  warning:    { a: "#f59e0b", b: "#fbbf24", speed: 0.9,  halo: "#fde68a", intensity: 0.95 },
  success:    { a: "#10b981", b: "#34d399", speed: 1.1,  halo: "#6ee7b7", intensity: 1.1  },
  error:      { a: "#ef4444", b: "#f87171", speed: 0.7,  halo: "#fca5a5", intensity: 0.85 },
};

export default class Sphere {
  constructor(experience) {
    this.experience = experience;
    this.scene = this.experience.scene;
    this.time = this.experience.time;
    this.microphone = this.experience.microphone || { ready: false, levels: [] };

    this.timeFrequency = 0.0003;
    this.elapsedTime = 0;

    // State color targets for smooth interpolation
    this._stateKey = "idle";
    this._colorA = { r: 0, g: 0, b: 0 };
    this._colorB = { r: 0, g: 0, b: 0 };
    this._haloColor = { r: 0, g: 0, b: 0 };
    this._speedTarget = 1.0;
    this._speedCurrent = 1.0;
    this._intensityTarget = 1.0;
    this._intensityCurrent = 1.0;

    this.setVariations();
    this.setGeometry();
    this.setLights();
    this.setOffset();
    this.setMaterial();
    this.setMesh();
    this._initStateColors();
  }

  _initStateColors() {
    const palette = STATE_PALETTES["idle"];
    const ca = new THREE.Color(palette.a);
    const cb = new THREE.Color(palette.b);
    const ch = new THREE.Color(palette.halo);
    this._colorA = { r: ca.r, g: ca.g, b: ca.b };
    this._colorB = { r: cb.r, g: cb.g, b: cb.b };
    this._haloColor = { r: ch.r, g: ch.g, b: ch.b };
    this._speedCurrent = palette.speed;
    this._speedTarget = palette.speed;
    this._intensityCurrent = palette.intensity;
    this._intensityTarget = palette.intensity;
  }

  /** Called from OrganicSphere.tsx to drive Elli-state visuals */
  setState(stateKey) {
    const key = stateKey in STATE_PALETTES ? stateKey : "idle";
    if (this._stateKey === key) return;
    this._stateKey = key;
    const palette = STATE_PALETTES[key];
    const ca = new THREE.Color(palette.a);
    const cb = new THREE.Color(palette.b);
    const ch = new THREE.Color(palette.halo);
    this._colorATarget = { r: ca.r, g: ca.g, b: ca.b };
    this._colorBTarget = { r: cb.r, g: cb.g, b: cb.b };
    this._haloTarget   = { r: ch.r, g: ch.g, b: ch.b };
    this._speedTarget  = palette.speed;
    this._intensityTarget = palette.intensity;
  }

  setVariations() {
    this.variations = {};

    this.variations.volume = {};
    this.variations.volume.target = 0;
    this.variations.volume.current = 0;
    this.variations.volume.upEasing = 0.03;
    this.variations.volume.downEasing = 0.002;
    this.variations.volume.getValue = () => {
      const level0 = this.microphone.levels[0] || 0;
      const level1 = this.microphone.levels[1] || 0;
      const level2 = this.microphone.levels[2] || 0;

      return Math.max(level0, level1, level2) * 0.3;
    };
    this.variations.volume.getDefault = () => {
      return 0.152;
    };

    this.variations.lowLevel = {};
    this.variations.lowLevel.target = 0;
    this.variations.lowLevel.current = 0;
    this.variations.lowLevel.upEasing = 0.005;
    this.variations.lowLevel.downEasing = 0.002;
    this.variations.lowLevel.getValue = () => {
      let value = this.microphone.levels[0] || 0;
      value *= 0.003;
      value += 0.0001;
      value = Math.max(0, value);

      return value;
    };
    this.variations.lowLevel.getDefault = () => {
      return 0.0003;
    };

    this.variations.mediumLevel = {};
    this.variations.mediumLevel.target = 0;
    this.variations.mediumLevel.current = 0;
    this.variations.mediumLevel.upEasing = 0.008;
    this.variations.mediumLevel.downEasing = 0.004;
    this.variations.mediumLevel.getValue = () => {
      let value = this.microphone.levels[1] || 0;
      value *= 2;
      value += 3.587;
      value = Math.max(3.587, value);

      return value;
    };
    this.variations.mediumLevel.getDefault = () => {
      return 3.587;
    };

    this.variations.highLevel = {};
    this.variations.highLevel.target = 0;
    this.variations.highLevel.current = 0;
    this.variations.highLevel.upEasing = 0.02;
    this.variations.highLevel.downEasing = 0.001;
    this.variations.highLevel.getValue = () => {
      let value = this.microphone.levels[2] || 0;
      value *= 5;
      value += 0.5;
      value = Math.max(0.5, value);

      return value;
    };
    this.variations.highLevel.getDefault = () => {
      return 0.65;
    };
  }

  setLights() {
    this.lights = {};

    // Light A
    this.lights.a = {};

    this.lights.a.intensity = 2.15;

    this.lights.a.color = {};
    this.lights.a.color.value = "#8b5cf6";
    this.lights.a.color.instance = new THREE.Color(this.lights.a.color.value);

    this.lights.a.spherical = new THREE.Spherical(1, 0.615, 2.049);

    // Light B
    this.lights.b = {};

    this.lights.b.intensity = 1.75;

    this.lights.b.color = {};
    this.lights.b.color.value = "#00e5ff";
    this.lights.b.color.instance = new THREE.Color(this.lights.b.color.value);

    this.lights.b.spherical = new THREE.Spherical(1, 2.561, -1.844);
  }

  setOffset() {
    this.offset = {};
    this.offset.spherical = new THREE.Spherical(1, Math.random() * Math.PI, Math.random() * Math.PI * 2);
    this.offset.direction = new THREE.Vector3();
    this.offset.direction.setFromSpherical(this.offset.spherical);
  }

  setGeometry() {
    this.geometry = new THREE.SphereGeometry(1, 512, 512);
    this.geometry.computeTangents();
  }

  setMaterial() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uLightAColor: { value: this.lights.a.color.instance },
        uLightAPosition: { value: new THREE.Vector3(1, 1, 0) },
        uLightAIntensity: { value: this.lights.a.intensity },

        uLightBColor: { value: this.lights.b.color.instance },
        uLightBPosition: { value: new THREE.Vector3(-1, -1, 0) },
        uLightBIntensity: { value: this.lights.b.intensity },

        uSubdivision: {
          value: new THREE.Vector2(this.geometry.parameters.widthSegments, this.geometry.parameters.heightSegments),
        },

        uOffset: { value: new THREE.Vector3() },

        uDistortionFrequency: { value: 1.5 },
        uDistortionStrength: { value: 0.65 },
        uDisplacementFrequency: { value: 2.12 },
        uDisplacementStrength: { value: 0.152 },

        uFresnelOffset: { value: -1.609 },
        uFresnelMultiplier: { value: 3.587 },
        uFresnelPower: { value: 1.793 },

        uTime: { value: 0 },
      },
      defines: {
        USE_TANGENT: "",
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
    });

    this.material.uniforms.uLightAPosition.value.setFromSpherical(this.lights.a.spherical);
    this.material.uniforms.uLightBPosition.value.setFromSpherical(this.lights.b.spherical);

    this.haloMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#b6f1ff") },
        uIntensity: { value: 0.32 },
      },
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
  }

  setMesh() {
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);

    this.haloMesh = new THREE.Mesh(this.geometry, this.haloMaterial);
    this.haloMesh.scale.setScalar(1.08);
    this.scene.add(this.haloMesh);
  }

  update() {
    for (const variationName in this.variations) {
      const variation = this.variations[variationName];
      variation.target = this.microphone.ready ? variation.getValue() : variation.getDefault();

      const easing = variation.target > variation.current ? variation.upEasing : variation.downEasing;
      variation.current += (variation.target - variation.current) * easing * this.time.delta;
    }

    // ── Smooth state color / speed transitions ──────────────────────────────
    const colorEase = 0.012;
    const speedEase = 0.008;

    if (this._colorATarget) {
      this._colorA.r += (this._colorATarget.r - this._colorA.r) * colorEase * this.time.delta;
      this._colorA.g += (this._colorATarget.g - this._colorA.g) * colorEase * this.time.delta;
      this._colorA.b += (this._colorATarget.b - this._colorA.b) * colorEase * this.time.delta;
      this.material.uniforms.uLightAColor.value.setRGB(this._colorA.r, this._colorA.g, this._colorA.b);
    }
    if (this._colorBTarget) {
      this._colorB.r += (this._colorBTarget.r - this._colorB.r) * colorEase * this.time.delta;
      this._colorB.g += (this._colorBTarget.g - this._colorB.g) * colorEase * this.time.delta;
      this._colorB.b += (this._colorBTarget.b - this._colorB.b) * colorEase * this.time.delta;
      this.material.uniforms.uLightBColor.value.setRGB(this._colorB.r, this._colorB.g, this._colorB.b);
    }
    if (this._haloTarget && this.haloMaterial) {
      this._haloColor.r += (this._haloTarget.r - this._haloColor.r) * colorEase * this.time.delta;
      this._haloColor.g += (this._haloTarget.g - this._haloColor.g) * colorEase * this.time.delta;
      this._haloColor.b += (this._haloTarget.b - this._haloColor.b) * colorEase * this.time.delta;
      this.haloMaterial.uniforms.uColor.value.setRGB(this._haloColor.r, this._haloColor.g, this._haloColor.b);
    }
    this._speedCurrent += (this._speedTarget - this._speedCurrent) * speedEase * this.time.delta;
    this._intensityCurrent += (this._intensityTarget - this._intensityCurrent) * speedEase * this.time.delta;
    // ───────────────────────────────────────────────────────────────────────

    this.timeFrequency = this.variations.lowLevel.current * this._speedCurrent;
    this.elapsedTime = this.time.delta * this.timeFrequency;

    this.material.uniforms.uDisplacementStrength.value = this.variations.volume.current;
    this.material.uniforms.uDistortionStrength.value = this.variations.highLevel.current * this._speedCurrent;
    this.material.uniforms.uFresnelMultiplier.value = this.variations.mediumLevel.current;

    const offsetTime = this.elapsedTime * 0.3;
    this.offset.spherical.phi =
      (Math.sin(offsetTime * 0.001) * Math.sin(offsetTime * 0.00321) * 0.5 + 0.5) * Math.PI;
    this.offset.spherical.theta =
      (Math.sin(offsetTime * 0.0001) * Math.sin(offsetTime * 0.000321) * 0.5 + 0.5) * Math.PI * 2;
    this.offset.direction.setFromSpherical(this.offset.spherical);
    this.offset.direction.multiplyScalar(this.timeFrequency * 2);

    this.material.uniforms.uOffset.value.add(this.offset.direction);

    this.material.uniforms.uTime.value += this.elapsedTime;

    if (this.haloMaterial) {
      const pulse = (0.24 + Math.sin(this.material.uniforms.uTime.value * 0.35) * 0.06) * this._intensityCurrent;
      this.haloMaterial.uniforms.uIntensity.value = pulse;
    }
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.haloMesh);
    this.geometry?.dispose?.();
    this.material?.dispose?.();
    this.haloMaterial?.dispose?.();
  }
}
