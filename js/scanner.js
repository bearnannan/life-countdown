/**
 * Scanner Component Engine (Vanilla JS / ES Module)
 * Port of React Bits <Scanner /> component using OGL (WebGL2).
 * Supports subtle responsive backgrounds, dynamic option updates, and full lifecycle cleanup.
 */

// Helper to convert hex string (#RRGGBB) to [r, g, b] in range [0, 1]
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ];
}

// Direction mapping: vertical=0.0, horizontal=1.0, diagonal=2.0
export function directionToFloat(dir) {
  return dir === 'horizontal' ? 1.0 : dir === 'diagonal' ? 2.0 : 0.0;
}

export const VERTEX_SHADER = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uSweepSpeed;
uniform float uSweepWidth;
uniform float uSweepFalloff;
uniform float uScale;
uniform float uFrequency;
uniform float uRipple;
uniform float uBandDensity;
uniform float uLineSharpness;
uniform float uGlow;
uniform float uColorSpread;
uniform float uBrightness;
uniform float uContrast;
uniform float uSoftness;
uniform float uVignette;
uniform float uOpacity;
uniform float uScanline;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uDirection;
uniform vec2 uMouse;
uniform float uMouseEnabled;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;

const float TAU = 6.2831853;

float signalField(vec2 p, float t) {
  float w = sin(p.x * 1.3 + t * 0.7);
  w += sin(p.y * 1.7 - t * 0.52) * 0.8;
  w += sin((p.x + p.y) * 0.9 + t * 0.91) * 0.6;
  w += sin((p.x - p.y) * 1.53 - t * 0.63) * 0.42;
  return w * 0.35;
}

vec3 palette(float f) {
  f = clamp(f, 0.0, 1.0);
  f = pow(f, uContrast);
  vec3 c = mix(uColor1, uColor2, smoothstep(0.08, 0.6, f));
  return mix(c, uColor3, smoothstep(0.68, 1.0, f));
}

float scanBand(float x, float aa, float sharp) {
  float v = mix(0.5, 0.5 + 0.5 * cos(x * TAU), aa);
  return pow(v, sharp);
}

void main() {
  float aspect = iResolution.x / iResolution.y;
  vec2 uv0 = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
  vec2 p = uv0 / max(uScale, 0.001);

  float t = iTime * uSpeed;

  float mouseBoost = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mUv = vec2((uMouse.x * 2.0 - 1.0) * aspect, uMouse.y * 2.0 - 1.0);
    vec2 md = uv0 - mUv;
    float r = max(uMouseRadius, 0.001);
    mouseBoost = exp(-dot(md, md) / (r * r)) * uMouseStrength * uMouseActive;
  }

  float axis;
  if (uDirection < 0.5) axis = p.y;
  else if (uDirection < 1.5) axis = p.x;
  else axis = (p.x + p.y) * 0.70710678;

  float sig = signalField(p * uFrequency, t);
  float coord = axis + sig * uRipple;

  float phase = coord / max(uSweepWidth, 0.05) - t * uSweepSpeed;
  float sweep = pow(0.5 + 0.5 * cos(phase * TAU), max(uSweepFalloff, 0.1));

  float lc = coord * uBandDensity;
  float aa = 1.0 / (1.0 + uSoftness * fwidth(lc) * 3.0);
  aa = clamp(aa * (1.0 + mouseBoost * 0.6), 0.0, 1.0);

  float bodyBase = clamp(0.5 + 0.5 * sig, 0.0, 1.0);
  float body = bodyBase * bodyBase * uGlow * sweep;

  float sharp = max(uLineSharpness, 0.1);
  float split = uColorSpread * 0.16;
  float fr = clamp(scanBand(lc + split, aa, sharp) * sweep + body, 0.0, 1.0);
  float fg = clamp(scanBand(lc, aa, sharp) * sweep + body, 0.0, 1.0);
  float fb = clamp(scanBand(lc - split, aa, sharp) * sweep + body, 0.0, 1.0);

  vec3 col = vec3(palette(fr).r, palette(fg).g, palette(fb).b);

  float inten = (fr + fg + fb) * 0.3333333 * uBrightness;
  inten *= 1.0 + mouseBoost * 0.9;

  if (uScanline > 0.5) {
    inten *= 1.0 - 0.18 * (0.5 + 0.5 * cos(gl_FragCoord.y * 1.7));
  }

  if (uGrain > 0.5) {
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
    inten += (g - 0.5) * uGrainIntensity;
  }

  inten *= clamp(1.0 - uVignette * smoothstep(0.55, 1.65, length(uv0)), 0.0, 1.0);
  inten = clamp(inten, 0.0, 1.0);

  float a = clamp(inten * uOpacity, 0.0, 1.0);
  fragColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}
`;

export const DEFAULT_SCANNER_CONFIG = {
  color1: '#5227FF',
  color2: '#FF9FFC',
  color3: '#FFFFFF',
  speed: 0.5,
  sweepSpeed: 0.25,
  sweepWidth: 1.6,
  sweepFalloff: 6,
  scale: 1.5,
  frequency: 2,
  ripple: 0.22,
  bandDensity: 11,
  lineSharpness: 5.5,
  glow: 0.22,
  scanDirection: 'vertical',
  colorSpread: 0.7,
  brightness: 1.0,
  contrast: 1.15,
  softness: 1.4,
  vignette: 0.45,
  scanline: true,
  grain: true,
  grainIntensity: 0.05,
  opacity: 1.0,
  mouseInteraction: true,
  mouseRadius: 0.5,
  mouseStrength: 0.5,
  trackWindowMouse: true
};

export const SCANNER_PRESETS = {
  // Preset 1: Subtle Slate / Navy — Best for clean dashboard & data readability
  subtleNavy: {
    color1: '#090d16',
    color2: '#38bdf8',
    color3: '#c7d2fe',
    speed: 0.28,
    sweepSpeed: 0.16,
    sweepWidth: 1.8,
    sweepFalloff: 5.5,
    scale: 1.65,
    frequency: 2.1,
    ripple: 0.16,
    bandDensity: 11,
    lineSharpness: 5.2,
    glow: 0.18,
    scanDirection: 'diagonal',
    colorSpread: 0.45,
    brightness: 0.82,
    contrast: 1.12,
    softness: 1.5,
    vignette: 0.6,
    scanline: true,
    grain: true,
    grainIntensity: 0.03,
    opacity: 0.36,
    mouseInteraction: true,
    mouseRadius: 0.45,
    mouseStrength: 0.55
  },

  // Preset 2: Default React Bits Vibrant Signature
  defaultReactBits: {
    color1: '#5227FF',
    color2: '#FF9FFC',
    color3: '#FFFFFF',
    speed: 0.5,
    sweepSpeed: 0.25,
    sweepWidth: 1.6,
    sweepFalloff: 6,
    scale: 1.5,
    frequency: 2,
    ripple: 0.22,
    bandDensity: 11,
    lineSharpness: 5.5,
    glow: 0.22,
    scanDirection: 'vertical',
    colorSpread: 0.7,
    brightness: 1.0,
    contrast: 1.15,
    softness: 1.4,
    vignette: 0.45,
    scanline: true,
    grain: true,
    grainIntensity: 0.05,
    opacity: 1.0,
    mouseInteraction: true,
    mouseRadius: 0.5,
    mouseStrength: 0.5
  },

  // Preset 3: Deep Cyberpunk Neon Glow
  cyberpunk: {
    color1: '#1e1b4b',
    color2: '#06b6d4',
    color3: '#f43f5e',
    speed: 0.45,
    sweepSpeed: 0.22,
    sweepWidth: 1.5,
    sweepFalloff: 6.5,
    scale: 1.4,
    frequency: 2.4,
    ripple: 0.25,
    bandDensity: 13,
    lineSharpness: 6.0,
    glow: 0.28,
    scanDirection: 'diagonal',
    colorSpread: 0.8,
    brightness: 1.05,
    contrast: 1.25,
    softness: 1.3,
    vignette: 0.5,
    scanline: true,
    grain: true,
    grainIntensity: 0.06,
    opacity: 0.65,
    mouseInteraction: true,
    mouseRadius: 0.55,
    mouseStrength: 0.7
  },

  // Preset 4: Emerald Bio-Scanner
  emerald: {
    color1: '#022c22',
    color2: '#10b981',
    color3: '#a7f3d0',
    speed: 0.35,
    sweepSpeed: 0.18,
    sweepWidth: 1.7,
    sweepFalloff: 5.8,
    scale: 1.6,
    frequency: 2.0,
    ripple: 0.2,
    bandDensity: 12,
    lineSharpness: 5.0,
    glow: 0.2,
    scanDirection: 'horizontal',
    colorSpread: 0.4,
    brightness: 0.9,
    contrast: 1.18,
    softness: 1.4,
    vignette: 0.55,
    scanline: true,
    grain: true,
    grainIntensity: 0.04,
    opacity: 0.45,
    mouseInteraction: true,
    mouseRadius: 0.5,
    mouseStrength: 0.5
  }
};

/**
 * Dynamically loads OGL modules from local node_modules or CDN fallback
 */
async function loadOgl() {
  try {
    const ogl = await import('ogl');
    if (ogl && ogl.Renderer) return ogl;
  } catch (e) {
    /* fallback to relative local or cdn */
  }

  try {
    const ogl = await import('/node_modules/ogl/src/index.js');
    if (ogl && ogl.Renderer) return ogl;
  } catch (e) {
    /* fallback to cdn */
  }

  try {
    const ogl = await import('https://esm.sh/ogl@1.0.11');
    if (ogl && ogl.Renderer) return ogl;
  } catch (e) {
    // Last resort jsdelivr
    return await import('https://cdn.jsdelivr.net/npm/ogl@1.0.11/+esm');
  }
}

/**
 * Creates and mounts a Scanner WebGL instance in container
 * @param {HTMLElement|string} target Container element or query selector
 * @param {Object} options Configuration properties
 * @returns {Promise<Object>} Controller with update(opts) and destroy() methods
 */
export async function createScanner(target, options = {}) {
  const container = typeof target === 'string' ? document.querySelector(target) : target;
  if (!container) {
    throw new Error(`[Scanner] Target container not found: ${target}`);
  }

  const ogl = await loadOgl();
  const { Renderer, Program, Mesh, Triangle } = ogl;

  const config = { ...DEFAULT_SCANNER_CONFIG, ...options };

  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2)
  });

  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  const canvas = gl.canvas;
  canvas.classList.add('scanner-canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.pointerEvents = config.trackWindowMouse ? 'none' : 'auto';
  container.appendChild(canvas);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex: VERTEX_SHADER,
    fragment: FRAGMENT_SHADER,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: config.speed },
      uSweepSpeed: { value: config.sweepSpeed },
      uSweepWidth: { value: config.sweepWidth },
      uSweepFalloff: { value: config.sweepFalloff },
      uScale: { value: config.scale },
      uFrequency: { value: config.frequency },
      uRipple: { value: config.ripple },
      uBandDensity: { value: config.bandDensity },
      uLineSharpness: { value: config.lineSharpness },
      uGlow: { value: config.glow },
      uColorSpread: { value: config.colorSpread },
      uBrightness: { value: config.brightness },
      uContrast: { value: config.contrast },
      uSoftness: { value: config.softness },
      uVignette: { value: config.vignette },
      uOpacity: { value: config.opacity },
      uScanline: { value: config.scanline ? 1.0 : 0.0 },
      uGrain: { value: config.grain ? 1.0 : 0.0 },
      uGrainIntensity: { value: config.grainIntensity },
      uDirection: { value: directionToFloat(config.scanDirection) },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
      uMouseEnabled: { value: config.mouseInteraction ? 1.0 : 0.0 },
      uMouseRadius: { value: config.mouseRadius },
      uMouseStrength: { value: config.mouseStrength },
      uMouseActive: { value: 0.0 },
      uColor1: { value: new Float32Array(hexToRgb(config.color1)) },
      uColor2: { value: new Float32Array(hexToRgb(config.color2)) },
      uColor3: { value: new Float32Array(hexToRgb(config.color3)) }
    }
  });

  const mesh = new Mesh(gl, { geometry, program });

  const setSize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h);
    const res = program.uniforms.iResolution.value;
    res[0] = gl.drawingBufferWidth;
    res[1] = gl.drawingBufferHeight;
    renderer.render({ scene: mesh });
  };

  const ro = new ResizeObserver(setSize);
  ro.observe(container);
  setSize();

  let currentMouse = [0.5, 0.5];
  let targetMouse = [0.5, 0.5];
  let mouseActive = 0;
  let targetMouseActive = 0;

  const onPointerMove = (e) => {
    if (!config.mouseInteraction) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = (e.clientX - rect.left) / rect.width;
    const y = 1.0 - (e.clientY - rect.top) / rect.height;

    // When tracking across window, check if within or near viewport
    if (config.trackWindowMouse || (x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      targetMouse = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
      targetMouseActive = 1;
    } else {
      targetMouseActive = 0;
    }
  };

  const onPointerLeave = () => {
    targetMouseActive = 0;
  };

  const mouseTargetElement = config.trackWindowMouse ? window : canvas;
  mouseTargetElement.addEventListener('pointermove', onPointerMove, { passive: true });
  mouseTargetElement.addEventListener('pointerleave', onPointerLeave, { passive: true });

  let raf = 0;
  let isVisible = true;
  let isPageVisible = !document.hidden;
  const t0 = performance.now();

  const loop = (t) => {
    program.uniforms.iTime.value = (t - t0) * 0.001;

    if (!config.mouseInteraction) {
      targetMouseActive = 0;
    }
    currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
    currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
    program.uniforms.uMouse.value[0] = currentMouse[0];
    program.uniforms.uMouse.value[1] = currentMouse[1];
    mouseActive += 0.05 * (targetMouseActive - mouseActive);
    program.uniforms.uMouseActive.value = mouseActive;

    renderer.render({ scene: mesh });
    raf = requestAnimationFrame(loop);
  };

  const tryStart = () => {
    if (isVisible && isPageVisible && raf === 0) {
      raf = requestAnimationFrame(loop);
    }
  };

  const tryStop = () => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const io = new IntersectionObserver(
    ([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) tryStart();
      else tryStop();
    },
    { threshold: 0 }
  );
  io.observe(container);

  const onVisibility = () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) tryStart();
    else tryStop();
  };
  document.addEventListener('visibilitychange', onVisibility);

  tryStart();

  const update = (newOpts = {}) => {
    Object.assign(config, newOpts);
    const u = program.uniforms;

    if (newOpts.speed !== undefined) u.uSpeed.value = newOpts.speed;
    if (newOpts.sweepSpeed !== undefined) u.uSweepSpeed.value = newOpts.sweepSpeed;
    if (newOpts.sweepWidth !== undefined) u.uSweepWidth.value = newOpts.sweepWidth;
    if (newOpts.sweepFalloff !== undefined) u.uSweepFalloff.value = newOpts.sweepFalloff;
    if (newOpts.scale !== undefined) u.uScale.value = newOpts.scale;
    if (newOpts.frequency !== undefined) u.uFrequency.value = newOpts.frequency;
    if (newOpts.ripple !== undefined) u.uRipple.value = newOpts.ripple;
    if (newOpts.bandDensity !== undefined) u.uBandDensity.value = newOpts.bandDensity;
    if (newOpts.lineSharpness !== undefined) u.uLineSharpness.value = newOpts.lineSharpness;
    if (newOpts.glow !== undefined) u.uGlow.value = newOpts.glow;
    if (newOpts.colorSpread !== undefined) u.uColorSpread.value = newOpts.colorSpread;
    if (newOpts.brightness !== undefined) u.uBrightness.value = newOpts.brightness;
    if (newOpts.contrast !== undefined) u.uContrast.value = newOpts.contrast;
    if (newOpts.softness !== undefined) u.uSoftness.value = newOpts.softness;
    if (newOpts.vignette !== undefined) u.uVignette.value = newOpts.vignette;
    if (newOpts.opacity !== undefined) u.uOpacity.value = newOpts.opacity;
    if (newOpts.scanline !== undefined) u.uScanline.value = newOpts.scanline ? 1.0 : 0.0;
    if (newOpts.grain !== undefined) u.uGrain.value = newOpts.grain ? 1.0 : 0.0;
    if (newOpts.grainIntensity !== undefined) u.uGrainIntensity.value = newOpts.grainIntensity;
    if (newOpts.scanDirection !== undefined) u.uDirection.value = directionToFloat(newOpts.scanDirection);
    if (newOpts.mouseInteraction !== undefined) u.uMouseEnabled.value = newOpts.mouseInteraction ? 1.0 : 0.0;
    if (newOpts.mouseRadius !== undefined) u.uMouseRadius.value = newOpts.mouseRadius;
    if (newOpts.mouseStrength !== undefined) u.uMouseStrength.value = newOpts.mouseStrength;

    if (newOpts.color1) {
      const [r, g, b] = hexToRgb(newOpts.color1);
      u.uColor1.value[0] = r;
      u.uColor1.value[1] = g;
      u.uColor1.value[2] = b;
    }
    if (newOpts.color2) {
      const [r, g, b] = hexToRgb(newOpts.color2);
      u.uColor2.value[0] = r;
      u.uColor2.value[1] = g;
      u.uColor2.value[2] = b;
    }
    if (newOpts.color3) {
      const [r, g, b] = hexToRgb(newOpts.color3);
      u.uColor3.value[0] = r;
      u.uColor3.value[1] = g;
      u.uColor3.value[2] = b;
    }
  };

  const destroy = () => {
    tryStop();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    mouseTargetElement.removeEventListener('pointermove', onPointerMove);
    mouseTargetElement.removeEventListener('pointerleave', onPointerLeave);
    try {
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    } catch {}
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  return {
    container,
    renderer,
    gl,
    program,
    mesh,
    config,
    update,
    destroy,
    resize: setSize
  };
}
