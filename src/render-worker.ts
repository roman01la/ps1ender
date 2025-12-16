/**
 * Render Worker - Offloads WASM rasterization and canvas updates to a Web Worker
 *
 * This worker:
 * - Owns the WASM rasterizer instance
 * - Receives render commands (meshes, transforms, settings) from main thread
 * - Renders to OffscreenCanvas transferred from main thread
 * - Runs its own render loop at target FPS
 *
 * Communication is via postMessage with structured clone (for typed arrays)
 * or transferable objects (for OffscreenCanvas, ArrayBuffers).
 */

import {
  loadWasmRasterizer,
  WasmRasterizerInstance,
  FLOATS_PER_VERTEX,
} from "./wasm-rasterizer";

// ============================================================================
// Message Types (Main Thread -> Worker)
// ============================================================================

export type WorkerCommand =
  | { type: "init"; canvas: OffscreenCanvas; wasmPath: string }
  | { type: "resize"; displayWidth: number; displayHeight: number }
  | {
      type: "setRenderResolution";
      renderWidth: number;
      renderHeight: number;
    }
  | { type: "setSettings"; settings: RenderSettings }
  | { type: "render"; frame: RenderFrame }
  | { type: "setTargetFPS"; fps: number }
  | { type: "start" }
  | { type: "stop" };

// ============================================================================
// Message Types (Worker -> Main Thread)
// ============================================================================

export type WorkerResponse =
  | { type: "ready" }
  | { type: "frame"; frameTimeMs: number; fps: number }
  | { type: "error"; message: string };

// ============================================================================
// Render Data Structures (Serializable)
// ============================================================================

export interface RenderSettings {
  wireframe: boolean;
  enableLighting: boolean;
  enableDithering: boolean;
  enableTexturing: boolean;
  enableBackfaceCulling: boolean;
  enableVertexSnapping: boolean;
  enableSmoothShading: boolean;
  ambientLight: number;
  snapResolutionX: number;
  snapResolutionY: number;
  lightDirection: [number, number, number];
  lightColor: [number, number, number];
  lightIntensity: number;
}

/** Serializable mesh data for worker transfer */
export interface SerializedMesh {
  // Flat arrays for efficient transfer
  positions: Float32Array; // x,y,z per vertex
  normals: Float32Array; // nx,ny,nz per vertex
  uvs: Float32Array; // u,v per vertex
  colors: Uint8Array; // r,g,b,a per vertex
  indices: Uint32Array;
}

/** A single object to render */
export interface RenderObject {
  mesh: SerializedMesh;
  modelMatrix: Float32Array; // 16 floats, row-major
  isEdgeOnly: boolean;
  smoothShading: boolean;
  hasTexture: boolean; // Whether this object has a texture assigned
}

/** Line data for grid/wireframe/gizmo */
export interface RenderLines {
  positions: Float32Array; // x,y,z per vertex
  colors: Uint8Array; // r,g,b,a per vertex
  indices: Uint32Array;
  modelMatrix: Float32Array;
  depthMode: number; // -1 = use vertex depth, 0 = always on top, 0xFFFF = far
}

/** Point data for vertex editing */
export interface RenderPoints {
  positions: Float32Array;
  colors: Uint8Array;
  indices: Int32Array;
  modelMatrix: Float32Array;
  pointSize: number;
}

/** Transparent triangle data for face selection */
export interface RenderTransparentTris {
  positions: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
  modelMatrix: Float32Array;
  alpha: number;
}

/** A single point without depth test */
export interface RenderPointNoDepth {
  position: [number, number, number];
  color: [number, number, number, number];
  modelMatrix: Float32Array;
  pointSize: number;
}

/** Complete frame data sent each render tick */
export interface RenderFrame {
  clearColor: [number, number, number];
  viewMatrix: Float32Array;
  projectionMatrix: Float32Array;

  // Scene objects (solid meshes)
  objects: RenderObject[];

  // Scene lines (wireframe mode, edge-only meshes)
  sceneLines: RenderLines[];

  // Grid lines
  grid: RenderLines | null;

  // Editor overlays (rendered in order)
  overlays: {
    // Vertex mode
    unselectedVertices: RenderPoints | null;
    selectedVertices: RenderPoints | null;
    vertexWireframe: RenderLines | null;

    // Edge mode
    edgeLines: RenderLines | null;

    // Face mode
    faceFill: RenderTransparentTris | null;
    faceHighlight: RenderLines | null;

    // Transform gizmo (always on top)
    gizmo: RenderLines | null;

    // Origin point
    originPoint: RenderPointNoDepth | null;
  };

  // Texture data (only sent when changed)
  texture: {
    slot: number;
    width: number;
    height: number;
    data: Uint8Array;
  } | null;

  // Per-frame flags (to avoid settings race conditions)
  enableTexturing: boolean;
}

// ============================================================================
// Worker State
// ============================================================================

let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let renderCanvas: OffscreenCanvas | null = null;
let renderCtx: OffscreenCanvasRenderingContext2D | null = null;
let wasmInstance: WasmRasterizerInstance | null = null;
let imageData: ImageData | null = null;

// WebGL resources
let glProgram: WebGLProgram | null = null;
let glTexture: WebGLTexture | null = null;
let glVAO: WebGLVertexArrayObject | null = null;
let uTextureSize: WebGLUniformLocation | null = null;
let uEnableDithering: WebGLUniformLocation | null = null;
let uEnableColorDepth: WebGLUniformLocation | null = null;
let uEnableScanlines: WebGLUniformLocation | null = null;
let uScanlinesIntensity: WebGLUniformLocation | null = null;

let displayWidth = 640;
let displayHeight = 480;
let renderWidth = 640;
let renderHeight = 480;

let targetFPS = 24;
let frameInterval = 1000 / 24;
let running = false;
let lastFrameTime = 0;
let frameCount = 0;
let fpsAccumulator = 0;
let lastFpsUpdate = 0;

let pendingFrame: RenderFrame | null = null;
let settings: RenderSettings = {
  wireframe: false,
  enableLighting: true,
  enableDithering: true,
  enableTexturing: true,
  enableBackfaceCulling: true,
  enableVertexSnapping: true,
  enableSmoothShading: false,
  ambientLight: 0.2,
  snapResolutionX: 320,
  snapResolutionY: 240,
  lightDirection: [0.5, 0.5, -1],
  lightColor: [1, 1, 1],
  lightIntensity: 0.8,
};

// ============================================================================
// WebGL Shaders for PS1 Effects
// ============================================================================

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vTexCoord;

void main() {
  vTexCoord = aPosition * 0.5 + 0.5;
  vTexCoord.y = 1.0 - vTexCoord.y; // Flip Y for correct orientation
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uTexture;
uniform vec2 uTextureSize;
uniform bool uEnableDithering;
uniform bool uEnableColorDepth;
uniform bool uEnableScanlines;
uniform float uScanlinesIntensity;

// PS1-style 4x4 ordered dithering matrix (Bayer)
const mat4 ditherMatrix = mat4(
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

// Quantize to 5-bit per channel (PS1's 15-bit color)
vec3 quantize15bit(vec3 color, float dither) {
  // PS1 has 32 levels per channel (5 bits)
  float levels = 31.0;
  vec3 scaled = color * levels;
  
  if (uEnableDithering) {
    // Apply dither offset before quantization
    scaled += (dither - 0.5) * 1.0;
  }
  
  return floor(clamp(scaled, 0.0, levels)) / levels;
}

void main() {
  // Sample the WASM-rendered texture (nearest neighbor for crisp pixels)
  vec2 pixelCoord = floor(vTexCoord * uTextureSize);
  vec2 texelCoord = (pixelCoord + 0.5) / uTextureSize;
  vec4 color = texture(uTexture, texelCoord);
  
  vec3 rgb = color.rgb;
  
  // Only apply PS1 effects to rendered geometry (alpha > 0), not background
  bool isGeometry = color.a > 0.5;
  
  // Apply PS1-style color depth reduction with dithering
  if (uEnableColorDepth && isGeometry) {
    // Get dither value based on screen position
    int x = int(pixelCoord.x) % 4;
    int y = int(pixelCoord.y) % 4;
    float dither = ditherMatrix[y][x];
    
    rgb = quantize15bit(rgb, dither);
  }
  
  // Optional scanline effect (apply to everything for CRT look)
  if (uEnableScanlines) {
    int y = int(gl_FragCoord.y);
    if (y % 2 == 0) {
      rgb *= (1.0 - uScanlinesIntensity);
    }
  }
  
  fragColor = vec4(rgb, 1.0);
}
`;

// ============================================================================
// WebGL Setup
// ============================================================================

function compileShader(
  gl: WebGL2RenderingContext,
  source: string,
  type: number
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation error: ${error}`);
  }

  return shader;
}

function initWebGL(): void {
  if (!canvas) return;

  gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  }) as WebGL2RenderingContext;

  if (!gl) {
    throw new Error("WebGL2 not supported");
  }

  // Compile shaders
  const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
  const fs = compileShader(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER);

  // Create program
  glProgram = gl.createProgram()!;
  gl.attachShader(glProgram, vs);
  gl.attachShader(glProgram, fs);
  gl.linkProgram(glProgram);

  if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(glProgram)}`);
  }

  // Clean up shader objects
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  // Get uniform locations
  uTextureSize = gl.getUniformLocation(glProgram, "uTextureSize");
  uEnableDithering = gl.getUniformLocation(glProgram, "uEnableDithering");
  uEnableColorDepth = gl.getUniformLocation(glProgram, "uEnableColorDepth");
  uEnableScanlines = gl.getUniformLocation(glProgram, "uEnableScanlines");
  uScanlinesIntensity = gl.getUniformLocation(glProgram, "uScanlinesIntensity");

  // Create fullscreen quad VAO
  glVAO = gl.createVertexArray()!;
  gl.bindVertexArray(glVAO);

  const quadVertices = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]);

  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(glProgram, "aPosition");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  // Create texture for WASM framebuffer
  glTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function presentFrameWebGL(): void {
  if (!gl || !glProgram || !glTexture || !wasmInstance) return;

  // Upload WASM pixels directly to WebGL texture (zero-copy view)
  const pixelBytes = renderWidth * renderHeight * 4;
  const pixelView = new Uint8Array(
    wasmInstance.pixels.buffer as ArrayBuffer,
    wasmInstance.pixels.byteOffset,
    pixelBytes
  );

  gl.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    renderWidth,
    renderHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixelView
  );

  // Setup viewport for display resolution
  gl.viewport(0, 0, displayWidth, displayHeight);

  // Draw fullscreen quad with PS1 effects
  gl.useProgram(glProgram);
  gl.uniform2f(uTextureSize, renderWidth, renderHeight);
  gl.uniform1i(uEnableDithering, settings.enableDithering ? 1 : 0);
  gl.uniform1i(uEnableColorDepth, 1); // Always enable 15-bit color
  gl.uniform1i(uEnableScanlines, 1); // Enable CRT scanlines
  gl.uniform1f(uScanlinesIntensity, 0.2);

  gl.bindVertexArray(glVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
}

// ============================================================================
// Rendering Functions
// ============================================================================

function rebuildImageData(): void {
  if (!wasmInstance) return;

  const pixelBytes = renderWidth * renderHeight * 4;
  const clampedView = new Uint8ClampedArray(
    wasmInstance.pixels.buffer as ArrayBuffer,
    wasmInstance.pixels.byteOffset,
    pixelBytes
  );
  imageData = new ImageData(clampedView, renderWidth, renderHeight);

  // Create/resize render canvas for the low-res buffer (fallback for Canvas 2D)
  renderCanvas = new OffscreenCanvas(renderWidth, renderHeight);
  renderCtx = renderCanvas.getContext("2d")!;
  renderCtx.imageSmoothingEnabled = false;
}

function applySettings(): void {
  if (!wasmInstance) return;

  wasmInstance.setEnableLighting(settings.enableLighting);
  // Note: Dithering is now handled by the WebGL shader, not WASM
  // wasmInstance.setEnableDithering(settings.enableDithering);
  wasmInstance.setEnableTexturing(settings.enableTexturing);
  wasmInstance.setEnableBackfaceCulling(settings.enableBackfaceCulling);
  wasmInstance.setEnableVertexSnapping(settings.enableVertexSnapping);
  wasmInstance.setEnableSmoothShading(settings.enableSmoothShading);
  wasmInstance.setAmbientLight(settings.ambientLight);
  wasmInstance.setSnapResolution(
    settings.snapResolutionX,
    settings.snapResolutionY
  );
  wasmInstance.setLightDirection(
    settings.lightDirection[0],
    settings.lightDirection[1],
    settings.lightDirection[2]
  );
  wasmInstance.setLightColor(
    settings.lightColor[0],
    settings.lightColor[1],
    settings.lightColor[2],
    settings.lightIntensity
  );
}

function renderMeshWasm(
  mesh: SerializedMesh,
  modelMatrix: Float32Array,
  viewMatrix: Float32Array,
  projMatrix: Float32Array
): void {
  if (!wasmInstance) return;

  const wasm = wasmInstance;

  // Compute MVP and model matrices
  // Row-major multiplication: MVP = Proj * View * Model
  const mv = multiplyMatrices(viewMatrix, modelMatrix);
  const mvp = multiplyMatrices(projMatrix, mv);

  // Upload matrices
  wasm.mvpMatrix.set(mvp);
  wasm.modelMatrix.set(modelMatrix);

  // Upload vertex data (interleaved format)
  const vertexCount = mesh.positions.length / 3;
  for (let i = 0; i < vertexCount; i++) {
    const vOffset = i * FLOATS_PER_VERTEX;
    const pOffset = i * 3;
    const uvOffset = i * 2;
    const cOffset = i * 4;

    // Position
    wasm.vertices[vOffset + 0] = mesh.positions[pOffset + 0];
    wasm.vertices[vOffset + 1] = mesh.positions[pOffset + 1];
    wasm.vertices[vOffset + 2] = mesh.positions[pOffset + 2];

    // Normal
    wasm.vertices[vOffset + 3] = mesh.normals[pOffset + 0];
    wasm.vertices[vOffset + 4] = mesh.normals[pOffset + 1];
    wasm.vertices[vOffset + 5] = mesh.normals[pOffset + 2];

    // UV
    wasm.vertices[vOffset + 6] = mesh.uvs[uvOffset + 0];
    wasm.vertices[vOffset + 7] = mesh.uvs[uvOffset + 1];

    // Color
    wasm.vertices[vOffset + 8] = mesh.colors[cOffset + 0];
    wasm.vertices[vOffset + 9] = mesh.colors[cOffset + 1];
    wasm.vertices[vOffset + 10] = mesh.colors[cOffset + 2];
    wasm.vertices[vOffset + 11] = mesh.colors[cOffset + 3];
  }

  // Upload indices
  wasm.indices.set(mesh.indices);

  // Set counts
  wasm.setVertexCount(vertexCount);
  wasm.setIndexCount(mesh.indices.length);

  // Render
  wasm.renderTriangles();
}

function renderLinesWasm(
  lines: RenderLines,
  viewMatrix: Float32Array,
  projMatrix: Float32Array
): void {
  if (!wasmInstance) return;

  const wasm = wasmInstance;
  const mv = multiplyMatrices(viewMatrix, lines.modelMatrix);
  const mvp = multiplyMatrices(projMatrix, mv);

  const vertexCount = lines.positions.length / 3;

  // Transform vertices and draw lines
  for (let i = 0; i < lines.indices.length; i += 2) {
    const i0 = lines.indices[i];
    const i1 = lines.indices[i + 1];

    // Transform both endpoints
    const p0 = transformPoint(
      mvp,
      lines.positions[i0 * 3],
      lines.positions[i0 * 3 + 1],
      lines.positions[i0 * 3 + 2]
    );
    const p1 = transformPoint(
      mvp,
      lines.positions[i1 * 3],
      lines.positions[i1 * 3 + 1],
      lines.positions[i1 * 3 + 2]
    );

    if (!p0 || !p1) continue;

    // Calculate depth with bias to avoid z-fighting with mesh surfaces
    let depth = lines.depthMode;
    if (lines.depthMode === -1) {
      // Use average depth of the two vertices
      const avgZ = (p0.z + p1.z) / 2;
      const depthVal = Math.floor((avgZ + 1) * 32767.5);
      depth = Math.max(0, depthVal - 50); // Bias to render in front of surfaces
    }

    wasm.drawLine(
      p0.x,
      p0.y,
      p1.x,
      p1.y,
      lines.colors[i0 * 4],
      lines.colors[i0 * 4 + 1],
      lines.colors[i0 * 4 + 2],
      depth
    );
  }
}

function renderPointsWasm(
  points: RenderPoints,
  viewMatrix: Float32Array,
  projMatrix: Float32Array
): void {
  if (!wasmInstance) return;

  const wasm = wasmInstance;
  const mv = multiplyMatrices(viewMatrix, points.modelMatrix);
  const mvp = multiplyMatrices(projMatrix, mv);

  // Build vertex data for batch rendering
  const vertexCount = points.indices.length;
  const vertexData = new Float32Array(vertexCount * 6); // x,y,z,r,g,b per vertex

  for (let i = 0; i < points.indices.length; i++) {
    const idx = points.indices[i];
    const offset = i * 6;

    vertexData[offset] = points.positions[idx * 3];
    vertexData[offset + 1] = points.positions[idx * 3 + 1];
    vertexData[offset + 2] = points.positions[idx * 3 + 2];
    // Colors are already 0-255 from Uint8Array, pass directly (WASM expects 0-255)
    vertexData[offset + 3] = points.colors[idx * 4];
    vertexData[offset + 4] = points.colors[idx * 4 + 1];
    vertexData[offset + 5] = points.colors[idx * 4 + 2];
  }

  const indices = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;

  wasm.renderPointsBatch(vertexData, indices, mvp, points.pointSize);
}

function renderTransparentTris(
  tris: RenderTransparentTris,
  viewMatrix: Float32Array,
  projMatrix: Float32Array
): void {
  if (!wasmInstance) return;

  const wasm = wasmInstance;
  const mv = multiplyMatrices(viewMatrix, tris.modelMatrix);
  const mvp = multiplyMatrices(projMatrix, mv);

  const pixels = wasm.pixels;
  const depthBuffer = wasm.depth;
  const alpha = tris.alpha;
  const invAlpha = 1 - alpha;

  for (let i = 0; i < tris.indices.length; i += 3) {
    const i0 = tris.indices[i];
    const i1 = tris.indices[i + 1];
    const i2 = tris.indices[i + 2];

    const p0 = transformPoint(
      mvp,
      tris.positions[i0 * 3],
      tris.positions[i0 * 3 + 1],
      tris.positions[i0 * 3 + 2]
    );
    const p1 = transformPoint(
      mvp,
      tris.positions[i1 * 3],
      tris.positions[i1 * 3 + 1],
      tris.positions[i1 * 3 + 2]
    );
    const p2 = transformPoint(
      mvp,
      tris.positions[i2 * 3],
      tris.positions[i2 * 3 + 1],
      tris.positions[i2 * 3 + 2]
    );

    if (!p0 || !p1 || !p2) continue;

    // Simple scanline rasterization with alpha blending
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(
      renderWidth - 1,
      Math.ceil(Math.max(p0.x, p1.x, p2.x))
    );
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(
      renderHeight - 1,
      Math.ceil(Math.max(p0.y, p1.y, p2.y))
    );

    const cr = tris.colors[i0 * 4];
    const cg = tris.colors[i0 * 4 + 1];
    const cb = tris.colors[i0 * 4 + 2];

    // Edge setup
    const A01 = p0.y - p1.y,
      B01 = p1.x - p0.x;
    const A12 = p1.y - p2.y,
      B12 = p2.x - p1.x;
    const A20 = p2.y - p0.y,
      B20 = p0.x - p2.x;

    const area = A01 * (p2.x - p0.x) + B01 * (p2.y - p0.y);
    if (Math.abs(area) < 0.0001) continue;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;

        const w0 = A12 * (px - p1.x) + B12 * (py - p1.y);
        const w1 = A20 * (px - p2.x) + B20 * (py - p2.y);
        const w2 = A01 * (px - p0.x) + B01 * (py - p0.y);

        if (
          (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
          (w0 <= 0 && w1 <= 0 && w2 <= 0)
        ) {
          const invArea = 1 / area;
          const b0 = w0 * invArea;
          const b1 = w1 * invArea;
          const b2 = w2 * invArea;

          const depth = Math.floor(
            (p0.z * b0 + p1.z * b1 + p2.z * b2 + 1) * 32767.5
          );
          const idx = y * renderWidth + x;

          // Depth test with small bias for overlay
          if (depth - 10 < depthBuffer[idx]) {
            // Alpha blend with existing pixel
            const existing = pixels[idx];
            const er = existing & 0xff;
            const eg = (existing >> 8) & 0xff;
            const eb = (existing >> 16) & 0xff;

            const nr = Math.floor(cr * alpha + er * invAlpha);
            const ng = Math.floor(cg * alpha + eg * invAlpha);
            const nb = Math.floor(cb * alpha + eb * invAlpha);

            pixels[idx] = 0xff000000 | (nb << 16) | (ng << 8) | nr;
          }
        }
      }
    }
  }
}

function renderPointNoDepthWasm(
  point: RenderPointNoDepth,
  viewMatrix: Float32Array,
  projMatrix: Float32Array
): void {
  if (!wasmInstance) return;

  const wasm = wasmInstance;
  const mv = multiplyMatrices(viewMatrix, point.modelMatrix);
  const mvp = multiplyMatrices(projMatrix, mv);

  const p = transformPoint(
    mvp,
    point.position[0],
    point.position[1],
    point.position[2]
  );
  if (!p) return;

  const halfSize = Math.floor(point.pointSize / 2);
  const pixels = wasm.pixels;
  const depth = wasm.depth;
  const color =
    0xff000000 |
    (point.color[2] << 16) |
    (point.color[1] << 8) |
    point.color[0];

  for (let py = -halfSize; py <= halfSize; py++) {
    for (let px = -halfSize; px <= halfSize; px++) {
      const sx = Math.floor(p.x) + px;
      const sy = Math.floor(p.y) + py;
      if (sx >= 0 && sx < renderWidth && sy >= 0 && sy < renderHeight) {
        const idx = sy * renderWidth + sx;
        pixels[idx] = color;
        depth[idx] = 0;
      }
    }
  }
}

// ============================================================================
// Matrix/Transform Helpers
// ============================================================================

function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i * 4 + j] =
        a[i * 4] * b[j] +
        a[i * 4 + 1] * b[4 + j] +
        a[i * 4 + 2] * b[8 + j] +
        a[i * 4 + 3] * b[12 + j];
    }
  }
  return result;
}

function transformPoint(
  mvp: Float32Array,
  x: number,
  y: number,
  z: number
): { x: number; y: number; z: number } | null {
  // Transform through MVP
  const clipX = mvp[0] * x + mvp[1] * y + mvp[2] * z + mvp[3];
  const clipY = mvp[4] * x + mvp[5] * y + mvp[6] * z + mvp[7];
  const clipZ = mvp[8] * x + mvp[9] * y + mvp[10] * z + mvp[11];
  const clipW = mvp[12] * x + mvp[13] * y + mvp[14] * z + mvp[15];

  // Clip against near plane
  if (clipW < 0.1) return null;

  // Perspective divide
  const invW = 1 / clipW;
  const ndcX = clipX * invW;
  const ndcY = clipY * invW;
  const ndcZ = clipZ * invW;

  // Viewport transform
  let screenX = (ndcX + 1) * 0.5 * renderWidth;
  let screenY = (1 - ndcY) * 0.5 * renderHeight;

  // PS1-style coordinate quantization: snap to integer screen coordinates
  // The PS1's GTE output integer screen coordinates, causing the characteristic wobble
  if (settings.enableVertexSnapping) {
    screenX = Math.round(screenX);
    screenY = Math.round(screenY);
  }

  return { x: screenX, y: screenY, z: ndcZ };
}

// ============================================================================
// Frame Rendering
// ============================================================================

function renderFullFrame(frame: RenderFrame): void {
  if (!wasmInstance || !gl) return;

  const wasm = wasmInstance;

  // Clear
  wasm.clear(frame.clearColor[0], frame.clearColor[1], frame.clearColor[2]);

  // Upload texture if provided
  if (frame.texture) {
    const texBuf = wasm.getTextureBuffer(frame.texture.slot);
    texBuf.set(frame.texture.data);
    wasm.setTextureSize(
      frame.texture.slot,
      frame.texture.width,
      frame.texture.height
    );
    wasm.setCurrentTexture(frame.texture.slot);
  }

  // Render grid
  if (frame.grid) {
    renderLinesWasm(frame.grid, frame.viewMatrix, frame.projectionMatrix);
  }

  // Render scene lines (wireframe mode, edge-only meshes)
  for (const lines of frame.sceneLines) {
    renderLinesWasm(lines, frame.viewMatrix, frame.projectionMatrix);
  }

  // Render scene objects
  for (const obj of frame.objects) {
    if (obj.isEdgeOnly) {
      // Edge-only objects rendered as lines (handled in main thread serialization)
      continue;
    }

    // Apply settings for this render pass
    applySettings();

    // Set per-mesh smooth shading and per-object texturing flag
    if (wasmInstance) {
      wasmInstance.setEnableSmoothShading(obj.smoothShading);
      // Use per-object texture flag - only render with texture if object has one AND texturing is enabled
      wasmInstance.setEnableTexturing(frame.enableTexturing && obj.hasTexture);
    }

    renderMeshWasm(
      obj.mesh,
      obj.modelMatrix,
      frame.viewMatrix,
      frame.projectionMatrix
    );
  }

  // Render overlays (in order for proper depth/blending)
  const ov = frame.overlays;

  if (ov.unselectedVertices) {
    renderPointsWasm(
      ov.unselectedVertices,
      frame.viewMatrix,
      frame.projectionMatrix
    );
  }
  if (ov.selectedVertices) {
    renderPointsWasm(
      ov.selectedVertices,
      frame.viewMatrix,
      frame.projectionMatrix
    );
  }
  if (ov.vertexWireframe) {
    renderLinesWasm(
      ov.vertexWireframe,
      frame.viewMatrix,
      frame.projectionMatrix
    );
  }
  if (ov.edgeLines) {
    renderLinesWasm(ov.edgeLines, frame.viewMatrix, frame.projectionMatrix);
  }
  if (ov.faceFill) {
    renderTransparentTris(
      ov.faceFill,
      frame.viewMatrix,
      frame.projectionMatrix
    );
  }
  if (ov.faceHighlight) {
    renderLinesWasm(ov.faceHighlight, frame.viewMatrix, frame.projectionMatrix);
  }
  if (ov.gizmo) {
    renderLinesWasm(ov.gizmo, frame.viewMatrix, frame.projectionMatrix);
  }
  if (ov.originPoint) {
    renderPointNoDepthWasm(
      ov.originPoint,
      frame.viewMatrix,
      frame.projectionMatrix
    );
  }

  // Present to canvas via WebGL with PS1 shader effects
  presentFrameWebGL();
}

// ============================================================================
// Render Loop
// ============================================================================

function tick(currentTime: number): void {
  if (!running) return;

  // Schedule next frame
  requestAnimationFrame(tick);

  // FPS limiting
  const elapsed = currentTime - lastFrameTime;
  if (elapsed < frameInterval) return;
  lastFrameTime = currentTime - (elapsed % frameInterval);

  // Render pending frame
  if (pendingFrame && wasmInstance && gl) {
    const renderStart = performance.now();
    renderFullFrame(pendingFrame);
    const frameTimeMs = performance.now() - renderStart;

    // FPS calculation
    frameCount++;
    fpsAccumulator += elapsed;
    if (fpsAccumulator >= 1000) {
      const response: WorkerResponse = {
        type: "frame",
        frameTimeMs,
        fps: frameCount,
      };
      self.postMessage(response);
      frameCount = 0;
      fpsAccumulator = 0;
    }
  }
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;

  switch (cmd.type) {
    case "init": {
      try {
        canvas = cmd.canvas;

        // Initialize WebGL for GPU-accelerated presentation with PS1 effects
        initWebGL();

        wasmInstance = await loadWasmRasterizer(cmd.wasmPath);
        wasmInstance.setRenderResolution(renderWidth, renderHeight);

        // Disable WASM-side dithering since we do it in the shader now
        wasmInstance.setEnableDithering(false);

        applySettings();
        rebuildImageData();

        const response: WorkerResponse = { type: "ready" };
        self.postMessage(response);
      } catch (err) {
        const response: WorkerResponse = {
          type: "error",
          message: String(err),
        };
        self.postMessage(response);
      }
      break;
    }

    case "resize": {
      displayWidth = cmd.displayWidth;
      displayHeight = cmd.displayHeight;
      if (canvas) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
      }
      break;
    }

    case "setRenderResolution": {
      renderWidth = cmd.renderWidth;
      renderHeight = cmd.renderHeight;
      if (wasmInstance) {
        wasmInstance.setRenderResolution(renderWidth, renderHeight);
        rebuildImageData();
      }
      break;
    }

    case "setSettings": {
      settings = cmd.settings;
      applySettings();
      break;
    }

    case "render": {
      pendingFrame = cmd.frame;
      break;
    }

    case "setTargetFPS": {
      targetFPS = cmd.fps;
      frameInterval = 1000 / targetFPS;
      break;
    }

    case "start": {
      if (!running) {
        running = true;
        lastFrameTime = performance.now();
        frameCount = 0;
        fpsAccumulator = 0;
        requestAnimationFrame(tick);
      }
      break;
    }

    case "stop": {
      running = false;
      break;
    }
  }
};

// Export types for main thread
export {};
