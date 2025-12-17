/**
 * Headless Rasterizer - Render scenes without browser APIs
 *
 * This module provides a headless rendering capability using the WASM rasterizer
 * directly in Bun/Node.js environment. Useful for:
 * - Screenshot tests
 * - Debugging rendering issues
 * - MCP service for AI visual debugging
 *
 * Usage:
 *   const renderer = await HeadlessRenderer.create(640, 480);
 *   renderer.renderScene(objects, camera);
 *   await renderer.savePNG('output.png');
 *
 * Note: The WASM rasterizer requires SIMD support. If running in an environment
 * without SIMD (e.g., some versions of Bun), use HeadlessRenderer.isSupported()
 * to check availability.
 */

import type { WasmRasterizerInstance } from "./wasm-rasterizer";
import { FLOATS_PER_VERTEX } from "./wasm-rasterizer";
import { Matrix4, Vector3, Color } from "./math";
import type { Mesh, Vertex } from "./primitives";
import type { SceneObject, Camera } from "./scene";

// ============================================================================
// WASM Types (subset of wasm-rasterizer.ts for headless use)
// ============================================================================

interface WasmExports {
  memory: WebAssembly.Memory;
  set_render_resolution: (width: number, height: number) => void;
  get_render_width: () => number;
  get_render_height: () => number;
  get_pixel_count: () => number;
  clear: (r: number, g: number, b: number) => void;
  render_triangles: () => void;
  draw_line: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    g: number,
    b: number,
    depth: number
  ) => void;
  get_pixels: () => number;
  get_depth: () => number;
  get_vertices: () => number;
  get_indices: () => number;
  get_mvp_matrix: () => number;
  get_model_matrix: () => number;
  set_vertex_count: (count: number) => void;
  set_index_count: (count: number) => void;
  set_ambient_light: (ambient: number) => void;
  set_enable_lighting: (enable: number) => void;
  set_enable_dithering: (enable: number) => void;
  set_enable_texturing: (enable: number) => void;
  set_enable_backface_culling: (enable: number) => void;
  set_enable_vertex_snapping: (enable: number) => void;
  set_enable_smooth_shading: (enable: number) => void;
  set_snap_resolution: (x: number, y: number) => void;
  set_light_direction: (x: number, y: number, z: number) => void;
  set_light_color: (r: number, g: number, b: number, intensity: number) => void;
  _initialize?: () => void;
}

// Memory layout constants (must match C++ side)
const MAX_RENDER_WIDTH = 1920;
const MAX_RENDER_HEIGHT = 1200;
const MAX_PIXEL_COUNT = MAX_RENDER_WIDTH * MAX_RENDER_HEIGHT;
const MAX_VERTICES = 65536;
const MAX_INDICES = 65536 * 3;

// ============================================================================
// Render Settings
// ============================================================================

export interface HeadlessRenderSettings {
  enableLighting: boolean;
  enableDithering: boolean;
  enableBackfaceCulling: boolean;
  enableVertexSnapping: boolean;
  enableSmoothShading: boolean;
  ambientLight: number;
  snapResolutionX: number;
  snapResolutionY: number;
  lightDirection: [number, number, number];
  lightColor: [number, number, number];
  lightIntensity: number;
  clearColor: [number, number, number];
}

const DEFAULT_SETTINGS: HeadlessRenderSettings = {
  enableLighting: true,
  enableDithering: true,
  enableBackfaceCulling: true,
  enableVertexSnapping: true,
  enableSmoothShading: false,
  ambientLight: 0.2,
  snapResolutionX: 320,
  snapResolutionY: 240,
  lightDirection: [0.5, 0.5, -1],
  lightColor: [1, 1, 1],
  lightIntensity: 0.8,
  clearColor: [45, 45, 45], // Dark gray
};

// ============================================================================
// Headless Renderer Class
// ============================================================================

export class HeadlessRenderer {
  private exports: WasmExports;
  private memory: WebAssembly.Memory;
  private pixels: Uint32Array;
  private depth: Uint16Array;
  private vertices: Float32Array;
  private indices: Uint32Array;
  private mvpMatrix: Float32Array;
  private modelMatrix: Float32Array;
  private width: number;
  private height: number;
  private settings: HeadlessRenderSettings;

  private constructor(
    exports: WasmExports,
    width: number,
    height: number,
    settings: HeadlessRenderSettings
  ) {
    this.exports = exports;
    this.memory = exports.memory;
    this.width = width;
    this.height = height;
    this.settings = settings;

    // Initialize WASM if needed
    if (exports._initialize) {
      exports._initialize();
    }

    // Set render resolution
    exports.set_render_resolution(width, height);

    // Get buffer pointers
    const pixelsPtr = exports.get_pixels();
    const depthPtr = exports.get_depth();
    const verticesPtr = exports.get_vertices();
    const indicesPtr = exports.get_indices();
    const mvpMatrixPtr = exports.get_mvp_matrix();
    const modelMatrixPtr = exports.get_model_matrix();

    // Create typed array views into WASM memory
    this.pixels = new Uint32Array(
      this.memory.buffer,
      pixelsPtr,
      MAX_PIXEL_COUNT
    );
    this.depth = new Uint16Array(this.memory.buffer, depthPtr, MAX_PIXEL_COUNT);
    this.vertices = new Float32Array(
      this.memory.buffer,
      verticesPtr,
      MAX_VERTICES * FLOATS_PER_VERTEX
    );
    this.indices = new Uint32Array(this.memory.buffer, indicesPtr, MAX_INDICES);
    this.mvpMatrix = new Float32Array(this.memory.buffer, mvpMatrixPtr, 16);
    this.modelMatrix = new Float32Array(this.memory.buffer, modelMatrixPtr, 16);

    // Apply initial settings
    this.applySettings();
  }

  /**
   * Create a new headless renderer
   */
  static async create(
    width: number = 640,
    height: number = 480,
    wasmPath: string = "wasm/rasterizer.wasm",
    settings: Partial<HeadlessRenderSettings> = {}
  ): Promise<HeadlessRenderer> {
    // Load WASM file - support both Bun and Node.js
    let wasmBytes: ArrayBuffer;

    if (typeof Bun !== "undefined") {
      // Bun environment
      const wasmFile = Bun.file(wasmPath);
      wasmBytes = await wasmFile.arrayBuffer();
    } else {
      // Node.js environment
      const fs = await import("fs");
      const path = await import("path");
      const absolutePath = path.resolve(wasmPath);
      wasmBytes = fs.readFileSync(absolutePath);
    }

    // Imports required by Emscripten standalone WASM
    const imports = {
      env: {
        emscripten_notify_memory_growth: (_memoryIndex: number) => {
          // Memory grew - would need to recreate views
        },
      },
    };

    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    const exports = instance.exports as unknown as WasmExports;

    const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
    return new HeadlessRenderer(exports, width, height, mergedSettings);
  }

  /**
   * Apply render settings to WASM
   */
  private applySettings(): void {
    const s = this.settings;
    this.exports.set_enable_lighting(s.enableLighting ? 1 : 0);
    this.exports.set_enable_dithering(s.enableDithering ? 1 : 0);
    this.exports.set_enable_texturing(0); // No textures in headless mode for now
    this.exports.set_enable_backface_culling(s.enableBackfaceCulling ? 1 : 0);
    this.exports.set_enable_vertex_snapping(s.enableVertexSnapping ? 1 : 0);
    this.exports.set_enable_smooth_shading(s.enableSmoothShading ? 1 : 0);
    this.exports.set_ambient_light(s.ambientLight);
    this.exports.set_snap_resolution(s.snapResolutionX, s.snapResolutionY);
    this.exports.set_light_direction(
      s.lightDirection[0],
      s.lightDirection[1],
      s.lightDirection[2]
    );
    this.exports.set_light_color(
      s.lightColor[0],
      s.lightColor[1],
      s.lightColor[2],
      s.lightIntensity
    );
  }

  /**
   * Update render settings
   */
  setSettings(settings: Partial<HeadlessRenderSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.applySettings();
  }

  /**
   * Clear the framebuffer
   */
  clear(): void {
    const [r, g, b] = this.settings.clearColor;
    this.exports.clear(r, g, b);
  }

  /**
   * Render a single mesh with the given transform matrices
   */
  renderMesh(
    mesh: Mesh,
    modelMatrix: Matrix4,
    viewMatrix: Matrix4,
    projMatrix: Matrix4
  ): void {
    // Compute MVP = Proj * View * Model
    const mv = projMatrix.multiply(viewMatrix);
    const mvp = mv.multiply(modelMatrix);

    // Upload matrices (Matrix4.data is Float32Array)
    this.mvpMatrix.set(mvp.data);
    this.modelMatrix.set(modelMatrix.data);

    // Upload vertex data (interleaved format)
    const vertexCount = mesh.vertices.length;
    for (let i = 0; i < vertexCount; i++) {
      const v = mesh.vertices[i];
      const vOffset = i * FLOATS_PER_VERTEX;

      // Position
      this.vertices[vOffset + 0] = v.position.x;
      this.vertices[vOffset + 1] = v.position.y;
      this.vertices[vOffset + 2] = v.position.z;

      // Normal
      this.vertices[vOffset + 3] = v.normal.x;
      this.vertices[vOffset + 4] = v.normal.y;
      this.vertices[vOffset + 5] = v.normal.z;

      // UV
      this.vertices[vOffset + 6] = v.u;
      this.vertices[vOffset + 7] = v.v;

      // Color (0-255)
      this.vertices[vOffset + 8] = v.color.r * 255;
      this.vertices[vOffset + 9] = v.color.g * 255;
      this.vertices[vOffset + 10] = v.color.b * 255;
      this.vertices[vOffset + 11] = v.color.a * 255;
    }

    // Upload indices
    for (let i = 0; i < mesh.indices.length; i++) {
      this.indices[i] = mesh.indices[i];
    }

    // Set counts
    this.exports.set_vertex_count(vertexCount);
    this.exports.set_index_count(mesh.indices.length);

    // Render
    this.exports.render_triangles();
  }

  /**
   * Render a scene object
   */
  renderObject(
    obj: SceneObject,
    viewMatrix: Matrix4,
    projMatrix: Matrix4
  ): void {
    if (!obj.visible) return;
    const modelMatrix = obj.getModelMatrix();
    this.renderMesh(obj.mesh, modelMatrix, viewMatrix, projMatrix);
  }

  /**
   * Render multiple scene objects
   */
  renderScene(
    objects: SceneObject[],
    camera: Camera,
    aspectRatio?: number
  ): void {
    const ar = aspectRatio ?? this.width / this.height;
    const viewMatrix = camera.getViewMatrix();
    const projMatrix = camera.getProjectionMatrix(ar);

    this.clear();

    for (const obj of objects) {
      this.renderObject(obj, viewMatrix, projMatrix);
    }
  }

  /**
   * Get raw pixel data as RGBA Uint8Array
   */
  getPixels(): Uint8Array {
    const pixelCount = this.width * this.height;
    const rgba = new Uint8Array(pixelCount * 4);

    for (let i = 0; i < pixelCount; i++) {
      const pixel = this.pixels[i];
      rgba[i * 4 + 0] = pixel & 0xff; // R
      rgba[i * 4 + 1] = (pixel >> 8) & 0xff; // G
      rgba[i * 4 + 2] = (pixel >> 16) & 0xff; // B
      rgba[i * 4 + 3] = (pixel >> 24) & 0xff; // A
    }

    return rgba;
  }

  /**
   * Get pixel data as Uint32Array (direct access)
   */
  getPixelsRaw(): Uint32Array {
    const pixelCount = this.width * this.height;
    return this.pixels.slice(0, pixelCount);
  }

  /**
   * Get a single pixel value at (x, y)
   */
  getPixel(
    x: number,
    y: number
  ): { r: number; g: number; b: number; a: number } {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const i = y * this.width + x;
    const pixel = this.pixels[i];
    return {
      r: pixel & 0xff,
      g: (pixel >> 8) & 0xff,
      b: (pixel >> 16) & 0xff,
      a: (pixel >> 24) & 0xff,
    };
  }

  /**
   * Save framebuffer as PNG file
   */
  async savePNG(filePath: string): Promise<void> {
    const rgba = this.getPixels();
    const png = encodePNG(rgba, this.width, this.height);

    if (typeof Bun !== "undefined") {
      await Bun.write(filePath, png);
    } else {
      const fs = await import("fs");
      fs.writeFileSync(filePath, png);
    }
  }

  /**
   * Get PNG as Uint8Array (for in-memory use)
   */
  toPNG(): Uint8Array {
    const rgba = this.getPixels();
    return encodePNG(rgba, this.width, this.height);
  }

  /**
   * Get current render dimensions
   */
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Resize the render buffer
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.exports.set_render_resolution(width, height);
  }
}

// ============================================================================
// PNG Encoding (minimal implementation)
// ============================================================================

/**
 * Encode RGBA pixel data as PNG
 * Uses a simple uncompressed PNG implementation for portability
 */
function encodePNG(
  rgba: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = createIHDR(width, height);

  // IDAT chunk (uncompressed deflate)
  const idat = createIDAT(rgba, width, height);

  // IEND chunk
  const iend = createIEND();

  // Combine all chunks
  const png = new Uint8Array(
    signature.length + ihdr.length + idat.length + iend.length
  );
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdr, offset);
  offset += ihdr.length;
  png.set(idat, offset);
  offset += idat.length;
  png.set(iend, offset);

  return png;
}

function createIHDR(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8; // bit depth
  data[9] = 6; // color type (RGBA)
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace

  return createChunk("IHDR", data);
}

function createIDAT(
  rgba: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  // Build raw scanlines with filter byte (0 = no filter)
  const rawSize = height * (1 + width * 4);
  const raw = new Uint8Array(rawSize);
  let rawOffset = 0;

  for (let y = 0; y < height; y++) {
    raw[rawOffset++] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[rawOffset++] = rgba[i + 0]; // R
      raw[rawOffset++] = rgba[i + 1]; // G
      raw[rawOffset++] = rgba[i + 2]; // B
      raw[rawOffset++] = rgba[i + 3]; // A
    }
  }

  // Use Bun's built-in zlib if available, otherwise use uncompressed deflate
  let compressed: Uint8Array;
  try {
    // Try using Bun's zlib
    const zlib = require("zlib");
    compressed = zlib.deflateSync(raw);
  } catch {
    // Fallback: uncompressed deflate (store blocks)
    compressed = createUncompressedDeflate(raw);
  }

  return createChunk("IDAT", compressed);
}

function createUncompressedDeflate(data: Uint8Array): Uint8Array {
  // Uncompressed deflate with store blocks
  // Each block: 1 byte header + 2 bytes len + 2 bytes nlen + data
  const maxBlockSize = 65535;
  const numBlocks = Math.ceil(data.length / maxBlockSize);
  const outputSize = 2 + numBlocks * 5 + data.length + 4; // zlib header + blocks + adler32
  const output = new Uint8Array(outputSize);
  let outOffset = 0;

  // Zlib header (no compression)
  output[outOffset++] = 0x78; // CMF
  output[outOffset++] = 0x01; // FLG

  let dataOffset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const remaining = data.length - dataOffset;
    const blockSize = Math.min(maxBlockSize, remaining);
    const isLast = i === numBlocks - 1;

    // Block header
    output[outOffset++] = isLast ? 0x01 : 0x00; // BFINAL + BTYPE=00 (no compression)
    output[outOffset++] = blockSize & 0xff;
    output[outOffset++] = (blockSize >> 8) & 0xff;
    output[outOffset++] = ~blockSize & 0xff;
    output[outOffset++] = (~blockSize >> 8) & 0xff;

    // Block data
    output.set(data.subarray(dataOffset, dataOffset + blockSize), outOffset);
    outOffset += blockSize;
    dataOffset += blockSize;
  }

  // Adler-32 checksum
  const adler = adler32(data);
  output[outOffset++] = (adler >> 24) & 0xff;
  output[outOffset++] = (adler >> 16) & 0xff;
  output[outOffset++] = (adler >> 8) & 0xff;
  output[outOffset++] = adler & 0xff;

  return output.slice(0, outOffset);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function createIEND(): Uint8Array {
  return createChunk("IEND", new Uint8Array(0));
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, data.length, false);

  // Type
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }

  // Data
  chunk.set(data, 8);

  // CRC32
  const crcData = chunk.slice(4, 8 + data.length);
  const crc = crc32(crcData);
  view.setUint32(8 + data.length, crc, false);

  return chunk;
}

// CRC32 lookup table
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
