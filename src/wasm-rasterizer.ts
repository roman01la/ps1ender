/**
 * TypeScript wrapper for WASM Rasterizer
 *
 * Provides a clean API for the WASM module with zero-copy buffer sharing.
 */

// Memory layout constants (must match C++ side)
const MAX_RENDER_WIDTH = 1920;
const MAX_RENDER_HEIGHT = 1200;
const MAX_PIXEL_COUNT = MAX_RENDER_WIDTH * MAX_RENDER_HEIGHT;
const MAX_VERTICES = 65536;
const MAX_INDICES = 65536 * 3;
const MAX_TEXTURES = 16;
const MAX_TEXTURE_SIZE = 512 * 512 * 4;

// Material baking constants
const MAX_BAKE_SIZE = 512 * 512;
const MAX_BAKE_INSTRUCTIONS = 256;
const MAX_COLOR_RAMP_STOPS = 16;

// Bake opcodes (must match C++ enum)
export const BAKE_OP_FLAT_COLOR = 0;
export const BAKE_OP_SAMPLE_TEXTURE = 1;
export const BAKE_OP_MIX_MULTIPLY = 2;
export const BAKE_OP_MIX_ADD = 3;
export const BAKE_OP_MIX_LERP = 4;
export const BAKE_OP_COLOR_RAMP = 5;
export const BAKE_OP_VORONOI = 6;
export const BAKE_OP_ALPHA_CUTOFF = 7;
export const BAKE_OP_NOISE = 8;
export const BAKE_OP_END = 255;

// Vertex format: x, y, z, nx, ny, nz, u, v, r, g, b, a (12 floats)
const FLOATS_PER_VERTEX = 12;

export interface WasmRasterizerInstance {
  // Current resolution
  renderWidth: number;
  renderHeight: number;

  // Buffer access (views into WASM memory)
  pixels: Uint32Array;
  depth: Uint16Array;
  vertices: Float32Array;
  indices: Uint32Array;
  mvpMatrix: Float32Array;
  modelMatrix: Float32Array;

  // Resolution management
  setRenderResolution(width: number, height: number): void;

  // Methods
  clear(r: number, g: number, b: number): void;
  renderTriangles(): void;
  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    g: number,
    b: number,
    depth: number
  ): void;

  // Texture management
  getTextureBuffer(slot: number): Uint8Array;
  setTextureSize(slot: number, width: number, height: number): void;
  setCurrentTexture(slot: number): void;

  // Light settings
  setLightDirection(x: number, y: number, z: number): void;
  setLightColor(r: number, g: number, b: number, intensity: number): void;

  // Data counts
  setVertexCount(count: number): void;
  setIndexCount(count: number): void;

  // Render settings
  setAmbientLight(ambient: number): void;
  setEnableLighting(enable: boolean): void;
  setEnableDithering(enable: boolean): void;
  setEnableTexturing(enable: boolean): void;
  setEnableBackfaceCulling(enable: boolean): void;
  setEnableVertexSnapping(enable: boolean): void;
  setEnableSmoothShading(enable: boolean): void;
  setSnapResolution(x: number, y: number): void;

  // Point rendering
  renderPoint(
    screenX: number,
    screenY: number,
    color: number,
    pointSize: number
  ): void;
  renderPointsBatch(
    vertexData: Float32Array,
    indices: Int32Array,
    mvpMatrix: Float32Array,
    pointSize: number
  ): void;

  // Material baking
  getBakeProgramBuffer(): Uint8Array;
  getBakeOutputBuffer(): Uint8Array;
  getColorRampBuffer(): Uint8Array;
  setBakeParams(width: number, height: number, sourceTexture: number): void;
  setColorRampCount(count: number): void;
  bakeMaterial(): void;
}

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
  get_texture: (slot: number) => number;
  get_texture_sizes: () => number;
  set_texture_size: (slot: number, width: number, height: number) => void;
  set_current_texture: (slot: number) => void;
  set_light_direction: (x: number, y: number, z: number) => void;
  set_light_color: (r: number, g: number, b: number, intensity: number) => void;
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
  render_point: (
    screenX: number,
    screenY: number,
    color: number,
    pointSize: number
  ) => void;
  render_points_batch: (
    vertexData: number,
    indices: number,
    indexCount: number,
    mvpMatrix: number,
    pointSize: number
  ) => void;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  _initialize: () => void;

  // Material baking exports
  get_bake_output_ptr: () => number;
  get_bake_program_ptr: () => number;
  get_color_ramp_ptr: () => number;
  set_bake_params: (
    width: number,
    height: number,
    sourceTexture: number
  ) => void;
  set_color_ramp_count: (count: number) => void;
  bake_material: () => void;
}

/**
 * Load and initialize the WASM rasterizer module
 */
export async function loadWasmRasterizer(
  wasmPath: string = "rasterizer.wasm"
): Promise<WasmRasterizerInstance> {
  // Fetch and instantiate the WASM module
  const response = await fetch(wasmPath);
  const wasmBytes = await response.arrayBuffer();

  // Imports required by Emscripten standalone WASM
  const imports = {
    env: {
      // Emscripten memory growth callback
      emscripten_notify_memory_growth: (_memoryIndex: number) => {
        // Memory grew - typed array views need to be recreated
        // This is handled by recreating views when resolution changes
      },
    },
  };

  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const exports = instance.exports as unknown as WasmExports;

  // Call the initialize function (required for standalone WASM)
  if (exports._initialize) {
    exports._initialize();
  }

  // Get buffer pointers (these are fixed addresses in WASM memory)
  const memory = exports.memory;
  const pixelsPtr = exports.get_pixels();
  const depthPtr = exports.get_depth();
  const verticesPtr = exports.get_vertices();
  const indicesPtr = exports.get_indices();
  const mvpMatrixPtr = exports.get_mvp_matrix();
  const modelMatrixPtr = exports.get_model_matrix();

  // Create typed array views into WASM memory (max size, we use a subset)
  let pixels = new Uint32Array(memory.buffer, pixelsPtr, MAX_PIXEL_COUNT);
  let depth = new Uint16Array(memory.buffer, depthPtr, MAX_PIXEL_COUNT);
  const vertices = new Float32Array(
    memory.buffer,
    verticesPtr,
    MAX_VERTICES * FLOATS_PER_VERTEX
  );
  const indices = new Uint32Array(memory.buffer, indicesPtr, MAX_INDICES);
  const mvpMatrix = new Float32Array(memory.buffer, mvpMatrixPtr, 16);
  const modelMatrix = new Float32Array(memory.buffer, modelMatrixPtr, 16);

  // Cache texture buffer views
  const textureBuffers: Uint8Array[] = [];
  for (let i = 0; i < MAX_TEXTURES; i++) {
    const ptr = exports.get_texture(i);
    if (ptr) {
      textureBuffers[i] = new Uint8Array(memory.buffer, ptr, MAX_TEXTURE_SIZE);
    }
  }

  // Material baking buffers
  const bakeOutputPtr = exports.get_bake_output_ptr();
  const bakeProgramPtr = exports.get_bake_program_ptr();
  const colorRampPtr = exports.get_color_ramp_ptr();

  const bakeOutputBuffer = new Uint8Array(
    memory.buffer,
    bakeOutputPtr,
    MAX_BAKE_SIZE * 4
  );
  const bakeProgramBuffer = new Uint8Array(
    memory.buffer,
    bakeProgramPtr,
    MAX_BAKE_INSTRUCTIONS * 16
  );
  const colorRampBuffer = new Uint8Array(
    memory.buffer,
    colorRampPtr,
    MAX_COLOR_RAMP_STOPS * 5
  );

  // Pre-allocated buffers for renderPointsBatch to avoid malloc/free per call
  // Max vertices in edit mode is MAX_VERTICES, 6 floats per vertex
  const POINTS_VERTEX_BUFFER_SIZE = MAX_VERTICES * 6 * 4; // bytes
  const POINTS_INDEX_BUFFER_SIZE = MAX_VERTICES * 4; // bytes
  const POINTS_MVP_BUFFER_SIZE = 16 * 4; // bytes

  let pointsVertexPtr = exports.malloc(POINTS_VERTEX_BUFFER_SIZE);
  let pointsIndexPtr = exports.malloc(POINTS_INDEX_BUFFER_SIZE);
  let pointsMvpPtr = exports.malloc(POINTS_MVP_BUFFER_SIZE);

  // Create views for the pre-allocated buffers
  let pointsVertexView = new Float32Array(
    memory.buffer,
    pointsVertexPtr,
    MAX_VERTICES * 6
  );
  let pointsIndexView = new Int32Array(
    memory.buffer,
    pointsIndexPtr,
    MAX_VERTICES
  );
  let pointsMvpView = new Float32Array(memory.buffer, pointsMvpPtr, 16);

  // Track current resolution
  let currentWidth = exports.get_render_width();
  let currentHeight = exports.get_render_height();

  return {
    get renderWidth() {
      return currentWidth;
    },
    get renderHeight() {
      return currentHeight;
    },
    pixels,
    depth,
    vertices,
    indices,
    mvpMatrix,
    modelMatrix,

    setRenderResolution(width: number, height: number) {
      exports.set_render_resolution(width, height);
      currentWidth = exports.get_render_width();
      currentHeight = exports.get_render_height();
    },

    clear(r: number, g: number, b: number) {
      exports.clear(r, g, b);
    },

    renderTriangles() {
      exports.render_triangles();
    },

    drawLine(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      r: number,
      g: number,
      b: number,
      depthValue: number
    ) {
      exports.draw_line(x0, y0, x1, y1, r, g, b, depthValue);
    },

    getTextureBuffer(slot: number): Uint8Array {
      return textureBuffers[slot];
    },

    setTextureSize(slot: number, width: number, height: number) {
      exports.set_texture_size(slot, width, height);
    },

    setCurrentTexture(slot: number) {
      exports.set_current_texture(slot);
    },

    setLightDirection(x: number, y: number, z: number) {
      exports.set_light_direction(x, y, z);
    },

    setLightColor(r: number, g: number, b: number, intensity: number) {
      exports.set_light_color(r, g, b, intensity);
    },

    setVertexCount(count: number) {
      exports.set_vertex_count(count);
    },

    setIndexCount(count: number) {
      exports.set_index_count(count);
    },

    setAmbientLight(ambient: number) {
      exports.set_ambient_light(ambient);
    },

    setEnableLighting(enable: boolean) {
      exports.set_enable_lighting(enable ? 1 : 0);
    },

    setEnableDithering(enable: boolean) {
      exports.set_enable_dithering(enable ? 1 : 0);
    },

    setEnableTexturing(enable: boolean) {
      exports.set_enable_texturing(enable ? 1 : 0);
    },

    setEnableBackfaceCulling(enable: boolean) {
      exports.set_enable_backface_culling(enable ? 1 : 0);
    },

    setEnableVertexSnapping(enable: boolean) {
      exports.set_enable_vertex_snapping(enable ? 1 : 0);
    },

    setEnableSmoothShading(enable: boolean) {
      exports.set_enable_smooth_shading(enable ? 1 : 0);
    },

    setSnapResolution(x: number, y: number) {
      exports.set_snap_resolution(x, y);
    },

    renderPoint(
      screenX: number,
      screenY: number,
      color: number,
      pointSize: number
    ) {
      exports.render_point(screenX, screenY, color, pointSize);
    },

    renderPointsBatch(
      vertexData: Float32Array,
      indexData: Int32Array,
      mvp: Float32Array,
      pointSize: number
    ) {
      // Use pre-allocated buffers - just copy data, no malloc/free
      pointsVertexView.set(vertexData);
      pointsIndexView.set(indexData);
      pointsMvpView.set(mvp);

      // Call WASM function with pre-allocated pointers
      exports.render_points_batch(
        pointsVertexPtr,
        pointsIndexPtr,
        indexData.length,
        pointsMvpPtr,
        pointSize
      );
    },

    // Material baking methods
    getBakeProgramBuffer(): Uint8Array {
      return bakeProgramBuffer;
    },

    getBakeOutputBuffer(): Uint8Array {
      return bakeOutputBuffer;
    },

    getColorRampBuffer(): Uint8Array {
      return colorRampBuffer;
    },

    setBakeParams(width: number, height: number, sourceTexture: number) {
      exports.set_bake_params(width, height, sourceTexture);
    },

    setColorRampCount(count: number) {
      exports.set_color_ramp_count(count);
    },

    bakeMaterial() {
      exports.bake_material();
    },
  };
}

/**
 * Helper to upload mesh data to WASM buffers
 */
export function uploadMeshToWasm(
  wasm: WasmRasterizerInstance,
  positions: Float32Array, // Flat array of x,y,z
  normals: Float32Array, // Flat array of nx,ny,nz
  uvs: Float32Array, // Flat array of u,v
  colors: Uint8Array, // Flat array of r,g,b,a
  indices: Uint32Array
): void {
  const vertexCount = positions.length / 3;

  // Interleave vertex data: x, y, z, nx, ny, nz, u, v, r, g, b, a
  for (let i = 0; i < vertexCount; i++) {
    const vOffset = i * FLOATS_PER_VERTEX;
    const pOffset = i * 3;
    const uvOffset = i * 2;
    const cOffset = i * 4;

    // Position
    wasm.vertices[vOffset + 0] = positions[pOffset + 0];
    wasm.vertices[vOffset + 1] = positions[pOffset + 1];
    wasm.vertices[vOffset + 2] = positions[pOffset + 2];

    // Normal
    wasm.vertices[vOffset + 3] = normals[pOffset + 0];
    wasm.vertices[vOffset + 4] = normals[pOffset + 1];
    wasm.vertices[vOffset + 5] = normals[pOffset + 2];

    // UV
    wasm.vertices[vOffset + 6] = uvs[uvOffset + 0];
    wasm.vertices[vOffset + 7] = uvs[uvOffset + 1];

    // Color (convert from 0-255 to float)
    wasm.vertices[vOffset + 8] = colors[cOffset + 0];
    wasm.vertices[vOffset + 9] = colors[cOffset + 1];
    wasm.vertices[vOffset + 10] = colors[cOffset + 2];
    wasm.vertices[vOffset + 11] = colors[cOffset + 3];
  }

  // Copy indices
  wasm.indices.set(indices);

  // Set counts
  wasm.setVertexCount(vertexCount);
  wasm.setIndexCount(indices.length);
}

/**
 * Helper to upload a 4x4 matrix to WASM
 */
export function uploadMatrixToWasm(
  target: Float32Array,
  matrix: Float32Array | number[]
): void {
  if (matrix instanceof Float32Array) {
    target.set(matrix);
  } else {
    for (let i = 0; i < 16; i++) {
      target[i] = matrix[i];
    }
  }
}

/**
 * Helper to upload texture to WASM
 */
export function uploadTextureToWasm(
  wasm: WasmRasterizerInstance,
  slot: number,
  imageData: ImageData
): void {
  const buffer = wasm.getTextureBuffer(slot);
  buffer.set(imageData.data);
  wasm.setTextureSize(slot, imageData.width, imageData.height);
}

// Constants export
export {
  MAX_RENDER_WIDTH,
  MAX_RENDER_HEIGHT,
  MAX_PIXEL_COUNT,
  MAX_VERTICES,
  MAX_INDICES,
  FLOATS_PER_VERTEX,
};
