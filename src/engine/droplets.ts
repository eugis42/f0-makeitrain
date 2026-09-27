/**
 * Fork of launch-microsite/droplets.js for Make export.
 * Changes: RGB photo composite, uSeed, renderAt fixed clock, exact pixel sizes.
 */

export type DropletsConfig = {
  intensity: number;
  speed: number;
  scale: number;
  dropWidth: number;
  dropLength: number;
  refraction: number;
  blur: number;
  vignette: number;
  fallSpeed: number;
  wiggle: number;
  staticDrops: number;
  interactive: boolean;
  interactionRadius: number;
  interactionStrength: number;
  interactionDistortion: number;
  tint: [number, number, number];
  tintStrength: number;
  keep: number;
  seed: number;
};

export const DEFAULTS: DropletsConfig = {
  intensity: 0.5,
  speed: 0.5,
  // Half microsite scale (0.4→0.2) → ~2× larger drops on Make canvases
  scale: 0.2,
  dropWidth: 1,
  dropLength: 1,
  refraction: 0.2,
  blur: 0,
  vignette: 0,
  fallSpeed: 1,
  wiggle: 1,
  staticDrops: 0.2,
  interactive: false,
  interactionRadius: 0.3,
  interactionStrength: 0.6,
  interactionDistortion: 3,
  tint: [1, 1, 1],
  tintStrength: 0,
  keep: 1,
  seed: 0,
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform vec2 uResolution;
uniform vec2 uOffset;
uniform float uTime;
uniform float uIntensity;
uniform float uScale;
uniform float uDropWidth;
uniform float uDropLength;
uniform float uRefraction;
uniform float uBlur;
uniform float uVignette;
uniform float uFallSpeed;
uniform float uWiggle;
uniform float uStaticDrops;
uniform float uMaxX;
uniform sampler2D uTrail;
uniform float uWipe;
uniform float uWipeDistort;
uniform vec3 uTint;
uniform float uTintStrength;
uniform float uHasContent;
uniform float uKeep;
uniform float uSeed;

#define S(a, b, t) smoothstep(a, b, t)

// uSeed is unit float [0,1). Large integer seeds in the hash collapse
// float precision → regular grid + sparse keep. Offset stays small.
vec3 N13 (float p) {
  p += uSeed * 33.71;
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3(
    (p3.x + p3.y) * p3.z,
    (p3.x + p3.z) * p3.y,
    (p3.y + p3.z) * p3.x
  ));
}

float N (float t) {
  return fract(sin(t * 12345.564 + uSeed * 78.233) * 7658.76);
}

float Saw (float b, float t) {
  return S(0.0, b, t) * S(1.0, b, t);
}

float sdEgg (vec2 p, float ra, float rb) {
  const float k = 1.7320508;
  p.x = abs(p.x);
  float r = ra - rb;
  return ((p.y < 0.0) ? length(vec2(p.x, p.y)) - r :
          (k * (p.x + r) < p.y) ? length(vec2(p.x, p.y - k * r)) :
          length(vec2(p.x + r, p.y)) - 2.0 * r) - rb;
}

vec2 DropLayer (vec2 uv, float t) {
  vec2 UV = uv;
  vec2 a = vec2(6.0, 1.0);
  vec2 grid = a * 2.0;

  vec2 id = floor(uv * grid);
  float gridFall = N(id.x) / 3.0 + 0.5;
  uv.y += t * gridFall / a.y;
  id = floor(uv * grid);
  uv.y += N(id.x);

  id = floor(uv * grid);
  if (N(id.x * 13.7 + id.y * 5.3) > uKeep) return vec2(0.0);
  vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
  vec3 n = N13(id.x * 35.2 + id.y * 2376.1);

  float x = n.x - 0.5;
  float lambda = UV.y * 20.0;
  float wiggle = sin(lambda + sin(lambda));
  x += wiggle * (0.5 - abs(x)) * (n.z - 0.5) * uWiggle;
  x *= 0.6;

  float slowStart = 0.85;
  float ti = fract(t * (gridFall + 0.1) + n.z);
  float y = (Saw(slowStart, ti) - 0.5) * 0.9 + 0.5;
  vec2 p = vec2(x, y);

  float dropShape = (ti > slowStart)
    ? -sin(6.2831853 * ti / (1.0 - slowStart)) * 0.5 - 0.5
    : 0.0;
  float d = sdEgg((st - p) * a.yx / vec2(uDropWidth, uDropLength), 0.0, dropShape);
  float diameter = N(id.x + id.y) / 7.0 + 0.2;
  float mainDrop = S(diameter / 1.5, 0.0, d);

  float r2 = S(1.0, y, st.y);
  float r = sqrt(r2);
  float cd = abs(st.x - x);
  float thickness = diameter * 0.95 * uDropWidth;
  float trail = S(thickness * r, 0.0, cd);
  float trailFront = S(-0.02, 0.02, st.y - y);
  trail *= r2 * trailFront * 0.5;

  y = UV.y;
  float trail2 = S((thickness - 0.15) * r, 0.0, cd);
  trail2 *= trailFront * n.z;
  float rndX = N(id.x) / 1.5 + 0.5;
  float rndY = N(st.y) / 40.0 + 0.05;
  y = fract(y * 11.0 * rndX) + (st.y - 0.5);
  float dd = length(st - vec2(x, y));
  float droplets = S(trail2 + rndY, 0.0, dd);

  float m = mainDrop + droplets * r * trailFront;
  return vec2(m, trail);
}

float StaticDrops (vec2 uv, float t) {
  uv *= 40.0;

  vec2 id = floor(uv);
  if (N(id.x * 9.1 + id.y * 4.4) > uKeep) return 0.0;
  vec3 n = N13(id.x * 107.45 + id.y * 3543.654);
  vec2 p = (n.xy - 0.5) * 0.6;
  uv = fract(uv) - 0.5;

  float d = length(uv - p);
  float drop = S(0.3 * clamp(uDropWidth, 0.4, 1.4), 0.0, d);

  float fade = Saw(0.1, fract(t + n.y));
  float intensity = fract(n.x * 27.0);
  return drop * fade * intensity;
}

vec2 Drops (vec2 uv, float t, float tFall, float l0, float l1, float l2, float wipe) {
  float s = StaticDrops(uv, t) * l0 * (1.0 - wipe);
  vec2 m1 = DropLayer(uv, tFall) * (l1 * (1.0 - wipe * 0.8));
  vec2 m2 = DropLayer(uv * 1.85, tFall) * (l2 * (1.0 - wipe * 0.8));

  float c = s + m1.x + m2.x;
  c = S(0.3, 1.0, c);

  return vec2(c, m1.y + m2.y);
}

void main () {
  vec2 uv = vUv;

  if (uv.x > uMaxX) {
    outColor = vec4(0.0);
    return;
  }

  // Microsite rain is tuned on landscape viewports (aspect ≳ 1.3). Tall Make
  // canvases (4:5 / 9:16) used to squeeze UV.x → ~3 drop columns vs ~10.
  float frameAspect = uResolution.x / max(uResolution.y, 1.0);
  float rainAspect = max(frameAspect, 1.35);
  vec2 aspectUv = (uv + uOffset - 0.5) * vec2(rainAspect, 1.0);
  float t = uTime * 0.2;
  // Pin to retina-ish microsite density; half-res preview must not sparsify.
  float minSide = max(min(uResolution.x, uResolution.y), 1200.0);
  float dropScale = clamp(minSide / 900.0, 0.75, 1.35) * uScale;
  vec2 scaledUv = aspectUv * dropScale;

  float rainAmount = clamp(uIntensity, 0.0, 1.25);

  float staticDrops = S(-0.5, 1.0, rainAmount) * 2.0 * uStaticDrops;
  float layer1 = S(0.25, 0.75, rainAmount);
  float layer2 = S(0.0, 0.5, rainAmount);
  float tFall = t * uFallSpeed;

  float wipeMask = texture(uTrail, uv).r;
  float wipe = wipeMask * clamp(uWipe, 0.0, 1.0);

  vec2 c = Drops(scaledUv, t, tFall, staticDrops, layer1, layer2, wipe);

  vec2 e = vec2(0.001, 0.0);
  float cx = Drops(scaledUv + e, t, tFall, staticDrops, layer1, layer2, wipe).x;
  float cy = Drops(scaledUv + e.yx, t, tFall, staticDrops, layer1, layer2, wipe).x;
  vec2 normal = vec2(cx - c.x, cy - c.x);

  vec2 e2 = vec2(0.012, 0.0);
  float wx = texture(uTrail, uv + e2).r;
  float wy = texture(uTrail, uv + e2.yx).r;
  normal += vec2(wipeMask - wx, wipeMask - wy) * 0.05 * uWipeDistort * clamp(uWipe, 0.0, 1.0);

  vec2 baseUv = clamp(uv, vec2(0.001), vec2(uMaxX - 0.004, 0.999));
  vec2 refractedUv = clamp(uv + normal * uRefraction, vec2(0.001), vec2(uMaxX - 0.004, 0.999));

  vec4 base = textureLod(uContent, vec2(baseUv.x, 1.0 - baseUv.y), 0.0);
  vec4 content = textureLod(uContent, vec2(refractedUv.x, 1.0 - refractedUv.y), 0.0);
  vec3 n3 = normalize(vec3(normal * 42.0, 1.0));
  vec3 L = normalize(vec3(-0.35, 0.75, 0.55));
  float spec = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n3), L), 0.0), 34.0);
  float egg = S(0.02, 0.14, c.x);
  float alpha = step(0.25, egg);
  float inner = step(0.5, egg);
  vec3 dropCol = mix(vec3(0.0), content.rgb, inner);
  dropCol = mix(dropCol, vec3(1.0), step(0.4, spec));
  vec3 col = mix(base.rgb, dropCol, alpha);
  outColor = vec4(col, 1.0);
}`;

const TRAIL_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;
uniform vec2 uFrom;
uniform vec2 uTo;
uniform float uAspect;
uniform float uRadius;
uniform float uDecay;
uniform float uDrain;
uniform float uSplat;

float capsule (vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main () {
  float prev = max(texture(uPrev, vUv).r * uDecay - uDrain, 0.0);
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 a = vec2(uFrom.x * uAspect, uFrom.y);
  vec2 b = vec2(uTo.x * uAspect, uTo.y);
  float d = capsule(p, a, b);
  float m = smoothstep(uRadius, uRadius * 0.5, d) * uSplat;
  outColor = vec4(max(prev, m), 0.0, 0.0, 1.0);
}`;

function isWebKitEngine(): boolean {
  const ua = navigator.userAgent || "";
  if (/CriOS|FxiOS|EdgiOS/i.test(ua)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/i.test(ua);
}

export type DropletsElements = {
  source: HTMLCanvasElement;
  output: HTMLCanvasElement;
  paintContent?: (source: HTMLCanvasElement) => void;
};

export type DropletsInstance = {
  canvas: HTMLCanvasElement;
  setOptions: (next: Partial<DropletsConfig>) => void;
  setSeed: (seed: number) => void;
  /** Drive one frame at absolute uTime (already includes speed scaling if desired). */
  renderAt: (timeSec: number) => void;
  /** Wall-clock helper: frameIndex / fps * config.speed → uTime. */
  renderFrame: (frameIndex: number, fps: number) => void;
  resize: (width: number, height: number) => void;
  destroy: () => void;
};

export function createDroplets(
  elements: DropletsElements,
  options: Partial<DropletsConfig> & { width: number; height: number },
): DropletsInstance | null {
  const config: DropletsConfig = { ...DEFAULTS, ...options };
  const { source, output, paintContent } = elements;
  const fixedW = Math.max(1, Math.round(options.width));
  const fixedH = Math.max(1, Math.round(options.height));

  const glCtx = output.getContext("webgl2", {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!glCtx || glCtx.isContextLost()) return null;
  const gl: WebGL2RenderingContext = glCtx;

  gl.disable(gl.BLEND);

  let contentDirty = true;

  function compile(type: number, text: string) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader create failed");
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Droplets shader error:", gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const trailShader = compile(gl.FRAGMENT_SHADER, TRAIL_FRAG);

  function link(fragment: WebGLShader) {
    const prog = gl.createProgram();
    if (!prog) throw new Error("program create failed");
    gl.attachShader(prog, vertexShader);
    gl.attachShader(prog, fragment);
    gl.linkProgram(prog);
    const locations: Record<string, WebGLUniformLocation | null> = {};
    const total = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < total; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      locations[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { program: prog, uniforms: locations };
  }

  const { program, uniforms } = link(fragmentShader);
  const { program: trailProgram, uniforms: trailUniforms } = link(trailShader);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const webkit = isWebKitEngine();
  const contentTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    webkit ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST,
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    webkit ? gl.LINEAR : gl.NEAREST,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  if (webkit) gl.generateMipmap(gl.TEXTURE_2D);

  const contentMaxX = 1;

  function syncCanvasSize(width: number, height: number) {
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    if (source.width !== width || source.height !== height) {
      source.width = width;
      source.height = height;
    }
    if (paintContent) {
      paintContent(source);
      contentDirty = true;
    }
  }

  syncCanvasSize(fixedW, fixedH);

  let trailWidth = 0;
  let trailHeight = 0;
  const trailTextures: WebGLTexture[] = [];
  const trailFramebuffers: WebGLFramebuffer[] = [];
  let trailIndex = 0;

  function ensureTrailTargets() {
    const width = Math.max(1, Math.round(output.width / 4));
    const height = Math.max(1, Math.round(output.height / 4));
    if (width === trailWidth && height === trailHeight && trailTextures.length) return;
    trailWidth = width;
    trailHeight = height;
    for (const texture of trailTextures) gl.deleteTexture(texture);
    for (const framebuffer of trailFramebuffers) gl.deleteFramebuffer(framebuffer);
    trailTextures.length = 0;
    trailFramebuffers.length = 0;
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      trailTextures.push(texture);
      trailFramebuffers.push(framebuffer);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function updateTrail(delta: number) {
    ensureTrailTargets();
    gl.useProgram(trailProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trailTextures[trailIndex]);
    gl.uniform1i(trailUniforms.uPrev, 0);
    gl.uniform1f(trailUniforms.uDecay, Math.exp(-delta * 0.5));
    gl.uniform1f(trailUniforms.uDrain, delta * 0.3);
    gl.uniform1f(trailUniforms.uAspect, output.width / Math.max(output.height, 1));
    gl.uniform2f(trailUniforms.uFrom, 0.5, 0.5);
    gl.uniform2f(trailUniforms.uTo, 0.5, 0.5);
    gl.uniform1f(trailUniforms.uRadius, Math.max(config.interactionRadius, 0.01));
    gl.uniform1f(trailUniforms.uSplat, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailFramebuffers[1 - trailIndex]);
    gl.viewport(0, 0, trailWidth, trailHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    trailIndex = 1 - trailIndex;
  }

  function uploadContent() {
    if (!contentDirty) return;
    contentDirty = false;
    try {
      gl.bindTexture(gl.TEXTURE_2D, contentTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (webkit) gl.generateMipmap(gl.TEXTURE_2D);
    } catch (err) {
      console.error("Droplets texture upload failed:", err);
    }
  }

  function render(timeSec: number) {
    uploadContent();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.uniform1i(uniforms.uContent, 0);
    gl.uniform1f(uniforms.uHasContent, 1);
    gl.uniform2f(uniforms.uResolution, output.width, output.height);
    gl.uniform2f(uniforms.uOffset, 0, 0);
    gl.uniform1f(uniforms.uTime, timeSec);
    gl.uniform1f(uniforms.uIntensity, config.intensity);
    gl.uniform1f(uniforms.uScale, Math.max(config.scale, 0.01));
    gl.uniform1f(uniforms.uDropWidth, Math.max(config.dropWidth, 0.05));
    gl.uniform1f(uniforms.uDropLength, Math.max(config.dropLength, 0.05));
    gl.uniform1f(uniforms.uRefraction, config.refraction);
    gl.uniform1f(uniforms.uBlur, Math.max(config.blur, 0));
    gl.uniform1f(uniforms.uVignette, config.vignette);
    gl.uniform1f(uniforms.uFallSpeed, config.fallSpeed);
    gl.uniform1f(uniforms.uWiggle, config.wiggle);
    gl.uniform1f(uniforms.uStaticDrops, config.staticDrops);
    gl.uniform1f(uniforms.uMaxX, contentMaxX);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, trailTextures[trailIndex] ?? trailTextures[0]);
    gl.uniform1i(uniforms.uTrail, 1);
    gl.uniform1f(uniforms.uWipe, 0);
    gl.uniform1f(uniforms.uWipeDistort, Math.max(config.interactionDistortion, 0));
    gl.uniform3f(uniforms.uTint, config.tint[0], config.tint[1], config.tint[2]);
    gl.uniform1f(uniforms.uTintStrength, config.tintStrength);
    gl.uniform1f(uniforms.uKeep, Math.min(Math.max(config.keep, 0), 1));
    // Unit float — matches shader; raw uint32 destroys hash precision in GLSL
    gl.uniform1f(uniforms.uSeed, (config.seed >>> 0) / 4294967296);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  ensureTrailTargets();

  let destroyed = false;

  return {
    canvas: output,
    setOptions(next) {
      Object.assign(config, next);
    },
    setSeed(seed) {
      config.seed = seed;
    },
    renderAt(timeSec) {
      if (destroyed) return;
      updateTrail(1 / 60);
      render(timeSec);
    },
    renderFrame(frameIndex, fps) {
      const wall = frameIndex / Math.max(fps, 1);
      this.renderAt(wall * config.speed);
    },
    resize(width, height) {
      syncCanvasSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
      trailWidth = 0;
      ensureTrailTargets();
    },
    destroy() {
      destroyed = true;
      gl.deleteTexture(contentTexture);
      for (const texture of trailTextures) gl.deleteTexture(texture);
      for (const framebuffer of trailFramebuffers) gl.deleteFramebuffer(framebuffer);
      gl.deleteProgram(program);
      gl.deleteProgram(trailProgram);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteShader(trailShader);
      gl.deleteBuffer(quad);
    },
  };
}

export function supportsWebGL2(): boolean {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  return !!gl && !gl.isContextLost();
}
