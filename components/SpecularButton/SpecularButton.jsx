import { useRef, useEffect } from 'react';
import { Renderer, Program, Mesh, Triangle, Color } from 'ogl';
import './SpecularButton.css';

const PAD = 20;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;

out vec4 fragColor;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float shapeSDF(vec2 p) { return sdRoundedRect(p, uHalfSize, uRadius); }

float gaussianLine(float d, float sigma) {
  float x = d / (sigma + 1e-6);
  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));
  return exp(-k * x * x);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = shapeSDF(p);
  vec2 L = vec2(cos(uAngle), sin(uAngle));

  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;

  vec2 nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(nEll, L)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);
  float line = gaussianLine(d, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));
  float hi = line * rim * edgeClamp * uIntensity;

  vec3 col = uBaseColor * base + uLineColor * hi;
  float a = clamp(base + hi, 0.0, 1.0);
  fragColor = vec4(col, a);
}
`;

// Shared WebGL2 singleton
let sharedRenderer = null;
let sharedProgram = null;
let sharedMesh = null;
let sharedUsersCount = 0;
let currentGLWidth = 0;
let currentGLHeight = 0;

function getSharedGL(dpr) {
  if (!sharedRenderer) {
    sharedRenderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true, dpr });
    const gl = sharedRenderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete geometry.attributes.uv;

    sharedProgram = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uCenter: { value: [0, 0] },
        uHalfSize: { value: [1, 1] },
        uRadius: { value: 0 },
        uAngle: { value: 2.4 },
        uPx: { value: dpr },
        uLineColor: { value: [1, 1, 1] },
        uBaseColor: { value: [0.32, 0.32, 0.32] },
        uIntensity: { value: 1 },
        uShineSize: { value: 0.17 },
        uShineFade: { value: 0.7 },
        uThickness: { value: 1 },
        uBaseWidth: { value: dpr }
      }
    });

    sharedMesh = new Mesh(gl, { geometry, program: sharedProgram });
  }
  sharedUsersCount++;
  return { renderer: sharedRenderer, program: sharedProgram, mesh: sharedMesh, gl: sharedRenderer.gl };
}

function releaseSharedGL() {
  sharedUsersCount--;
  if (sharedUsersCount <= 0 && sharedRenderer) {
    const gl = sharedRenderer.gl;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    sharedRenderer = null;
    sharedProgram = null;
    sharedMesh = null;
    sharedUsersCount = 0;
    currentGLWidth = 0;
    currentGLHeight = 0;
  }
}

// Centralized On-Demand Animation Ticker
const activeInstances = new Set();
const allRegisteredInstances = new Set();
let tickerRaf = null;
let lastTick = performance.now();

function registerActive(inst) {
  if (!activeInstances.has(inst)) {
    activeInstances.add(inst);
  }
  if (!tickerRaf) {
    lastTick = performance.now();
    tickerRaf = requestAnimationFrame(tick);
  }
}

function unregisterActive(inst) {
  activeInstances.delete(inst);
  if (activeInstances.size === 0 && tickerRaf) {
    cancelAnimationFrame(tickerRaf);
    tickerRaf = null;
  }
}

function tick(now) {
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;

  for (const inst of activeInstances) {
    const isStillActive = inst.step(dt);
    if (!isStillActive) {
      activeInstances.delete(inst);
    }
  }

  if (activeInstances.size > 0) {
    tickerRaf = requestAnimationFrame(tick);
  } else {
    tickerRaf = null;
  }
}

// Global Pointer Listener with Coalescing
let globalPointerListenerAttached = false;
let globalPointerX = -9999;
let globalPointerY = -9999;
let pointerDispatchScheduled = false;

function onGlobalPointerMove(e) {
  globalPointerX = e.clientX;
  globalPointerY = e.clientY;

  if (!pointerDispatchScheduled) {
    pointerDispatchScheduled = true;
    requestAnimationFrame(dispatchPointerToButtons);
  }
}

function dispatchPointerToButtons() {
  pointerDispatchScheduled = false;
  const px = globalPointerX;
  const py = globalPointerY;

  for (const inst of allRegisteredInstances) {
    inst.handlePointer(px, py);
  }
}

function ensureGlobalPointerListener() {
  if (!globalPointerListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('pointermove', onGlobalPointerMove, { passive: true });
    window.addEventListener('scroll', invalidateAllRects, { passive: true });
    window.addEventListener('resize', invalidateAllRects, { passive: true });
    globalPointerListenerAttached = true;
  }
}

function invalidateAllRects() {
  for (const inst of allRegisteredInstances) {
    inst.invalidateRect();
  }
}

export default function SpecularButton({
  children,
  className = '',
  size = 'md',
  radius = 10,
  tint = '#1e293b',
  tintOpacity = 0.65,
  blur = 6,
  textColor = '#ffffff',
  lineColor = '#60a5fa',
  baseColor = '#3b82f6',
  intensity = 1.2,
  shineSize = 11,
  shineFade = 38,
  thickness = 1.3,
  speed = 0.35,
  followMouse = true,
  proximity = 100,
  autoAnimate = false,
  onClick,
  disabled = false,
  ...props
}) {
  const buttonRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const btn = buttonRef.current;
    const canvas = canvasRef.current;
    if (!btn || !canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const { renderer, program, mesh, gl } = getSharedGL(dpr);

    let w = 1;
    let h = 1;
    let cachedRect = null;

    const updateDimensions = () => {
      if (!btn.isConnected || btn.offsetParent === null) return;
      cachedRect = btn.getBoundingClientRect();
      w = Math.max(1, Math.round(cachedRect.width));
      h = Math.max(1, Math.round(cachedRect.height));
      const cw = (w + PAD * 2) * dpr;
      const ch = (h + PAD * 2) * dpr;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = `${w + PAD * 2}px`;
        canvas.style.height = `${h + PAD * 2}px`;
      }
    };

    const ro = new ResizeObserver(() => {
      updateDimensions();
      if (autoAnimate) registerActive(instance);
    });
    ro.observe(btn);
    updateDimensions();

    let pointerAngle = null;
    let proximityT = 0;
    let angle = 2.4;
    let idleAngle = 2.4;
    let bright = 0;

    const lineC = new Color(lineColor);
    const baseC = new Color(baseColor);

    const instance = {
      element: btn,
      invalidateRect() {
        cachedRect = null;
      },
      handlePointer(clientX, clientY) {
        if (!btn.isConnected || btn.offsetParent === null) {
          if (proximityT > 0) {
            proximityT = 0;
            registerActive(instance);
          }
          return;
        }

        if (!cachedRect) cachedRect = btn.getBoundingClientRect();
        const rect = cachedRect;
        if (rect.width === 0 || rect.height === 0) return;

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
        const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
        const dist = Math.hypot(dx, dy);

        if (dist > proximity * 1.3) {
          if (proximityT > 0) {
            proximityT = 0;
            registerActive(instance);
          }
          return;
        }

        if (dist === 0) {
          const nx = (clientX - cx) / (rect.width / 2);
          const ny = (cy - clientY) / (rect.height / 2);
          pointerAngle = Math.atan2(2 / rect.height, -2 / rect.width) + nx * 0.3 + ny * 0.15;
        } else {
          pointerAngle = Math.atan2(cy - clientY, clientX - cx);
        }
        const t = Math.max(0, 1 - dist / Math.max(proximity, 1));
        proximityT = t * t * (3 - 2 * t);

        registerActive(instance);
      },
      step(dt) {
        if (!btn.isConnected || btn.offsetParent === null) {
          if (bright > 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            bright = 0;
          }
          return false;
        }

        idleAngle += speed * dt;
        const steer = followMouse && pointerAngle != null && (!autoAnimate || proximityT > 0);
        const target = steer ? pointerAngle : idleAngle;
        const diff = ((target - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        angle += diff * (1 - Math.exp(-dt * 8));

        const brightTarget = autoAnimate ? 1 : proximityT;
        bright += (brightTarget - bright) * (1 - Math.exp(-dt * 9));

        if (bright < 0.002 && !autoAnimate) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          bright = 0;
          return false;
        }

        const targetGLW = (w + PAD * 2);
        const targetGLH = (h + PAD * 2);
        if (currentGLWidth !== targetGLW || currentGLHeight !== targetGLH) {
          renderer.setSize(targetGLW, targetGLH);
          currentGLWidth = targetGLW;
          currentGLHeight = targetGLH;
        }

        program.uniforms.uCenter.value = [(PAD + w / 2) * dpr, (PAD + h / 2) * dpr];
        program.uniforms.uHalfSize.value = [(w / 2) * dpr, (h / 2) * dpr];
        program.uniforms.uAngle.value = angle;
        program.uniforms.uRadius.value = Math.min(radius, Math.min(w, h) / 2) * dpr;
        program.uniforms.uPx.value = dpr;
        program.uniforms.uLineColor.value = [lineC.r, lineC.g, lineC.b];
        program.uniforms.uBaseColor.value = [baseC.r, baseC.g, baseC.b];
        program.uniforms.uIntensity.value = intensity * bright;
        program.uniforms.uShineSize.value = (shineSize * Math.PI) / 180;
        program.uniforms.uShineFade.value = (shineFade * Math.PI) / 180;
        program.uniforms.uThickness.value = thickness * dpr;
        program.uniforms.uBaseWidth.value = dpr;

        renderer.render({ scene: mesh });

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(gl.canvas, 0, 0);

        return true;
      }
    };

    allRegisteredInstances.add(instance);
    ensureGlobalPointerListener();
    if (autoAnimate) registerActive(instance);

    return () => {
      allRegisteredInstances.delete(instance);
      unregisterActive(instance);
      ro.disconnect();
      releaseSharedGL();
    };
  }, [radius, tint, tintOpacity, blur, textColor, lineColor, baseColor, intensity, shineSize, shineFade, thickness, speed, followMouse, proximity, autoAnimate]);

  const style = {
    '--sb-radius': `${radius}px`,
    '--sb-tint': tint,
    '--sb-tint-opacity': tintOpacity,
    '--sb-blur': `${blur}px`,
    '--sb-text-color': textColor,
  };

  return (
    <button
      ref={buttonRef}
      className={`specular-button specular-button--${size} ${className}`}
      style={style}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      <span className="specular-button__fx" aria-hidden="true">
        <canvas ref={canvasRef} />
      </span>
      <span className="specular-button__label">{children}</span>
    </button>
  );
}
