# WASM Rasterizer

A SIMD-accelerated PS1-style software rasterizer compiled to WebAssembly.

## Features

- **SIMD acceleration**: Processes 4 pixels at a time using WebAssembly SIMD
- **Optional pthread parallelization**: Multi-threaded triangle rasterization for large scenes
- **Zero-copy buffers**: JavaScript and WASM share memory directly
- **PS1-style rendering**:
  - 16-bit depth buffer
  - Gouraud shading
  - Affine texture mapping with characteristic warping
  - Ordered dithering (8x8 Bayer matrix)
  - Vertex snapping
  - Backface culling

## Building

### Prerequisites

Install Emscripten:

```bash
# macOS
brew install emscripten

# Linux (Ubuntu/Debian)
apt install emscripten
```

### Build

```bash
# Single-threaded build (default, no JS glue needed)
make

# Multi-threaded build (requires pthreads, produces JS + WASM + worker)
make threads

# Install to ../public/
make install          # Single-threaded
make install-threads  # Multi-threaded

# Check compiler
make check
```

### Manual build

```bash
# Single-threaded (standalone WASM)
emcc -O3 -msimd128 -mbulk-memory -s STANDALONE_WASM=1 --no-entry \
  -o rasterizer.wasm rasterizer.cpp

# Multi-threaded (requires JS glue)
emcc -O3 -msimd128 -mbulk-memory -pthread -s USE_PTHREADS=1 \
  -s PTHREAD_POOL_SIZE=4 -s MODULARIZE=1 \
  -o rasterizer.js rasterizer.cpp
```

## Usage

### TypeScript/JavaScript

```typescript
import {
  loadWasmRasterizer,
  uploadMeshToWasm,
  uploadMatrixToWasm,
} from "./wasm-rasterizer";

// Load the module
const wasm = await loadWasmRasterizer("/rasterizer.wasm");

// Configure settings
wasm.setEnableLighting(true);
wasm.setEnableDithering(true);
wasm.setAmbientLight(0.2);
wasm.setLightDirection(0.5, -1.0, 0.5);
wasm.setLightColor(1.0, 1.0, 1.0, 0.8);

// Upload mesh data
uploadMeshToWasm(wasm, positions, normals, uvs, colors, indices);

// Upload MVP matrix (from your Matrix4 class)
uploadMatrixToWasm(wasm.mvpMatrix, mvpMatrix.data);
uploadMatrixToWasm(wasm.modelMatrix, modelMatrix.data);

// Render frame
wasm.clear(0, 0, 0);
wasm.renderTriangles();

// Draw to canvas (zero-copy!)
ctx.putImageData(wasm.imageData, 0, 0);
```

### Memory Layout

The WASM module uses shared memory with JavaScript:

| Buffer        | Type           | Size     | Description                          |
| ------------- | -------------- | -------- | ------------------------------------ |
| `pixels`      | `Uint32Array`  | 640×480  | ABGR framebuffer                     |
| `depth`       | `Uint16Array`  | 640×480  | 16-bit depth buffer                  |
| `vertices`    | `Float32Array` | 65536×12 | Vertex data (pos, normal, uv, color) |
| `indices`     | `Uint32Array`  | 196608   | Triangle indices                     |
| `mvpMatrix`   | `Float32Array` | 16       | Model-View-Projection matrix         |
| `modelMatrix` | `Float32Array` | 16       | Model matrix (for normals)           |

### Vertex Format

Each vertex is 12 floats:

```
[x, y, z, nx, ny, nz, u, v, r, g, b, a]
```

- `x, y, z`: Position
- `nx, ny, nz`: Normal
- `u, v`: Texture coordinates
- `r, g, b, a`: Vertex color (0-255)

## Performance

Compared to the JavaScript rasterizer:

| Operation        | JS     | WASM+SIMD | Speedup  |
| ---------------- | ------ | --------- | -------- |
| Clear buffers    | 0.1ms  | 0.02ms    | 5×       |
| Vertex transform | 0.2ms  | 0.05ms    | 4×       |
| Rasterization    | 0.8ms  | 0.2ms     | 4×       |
| **Total**        | ~1.1ms | ~0.3ms    | **3-4×** |

## API Reference

### Initialization

```typescript
loadWasmRasterizer(wasmPath?: string): Promise<WasmRasterizerInstance>
```

### Rendering

```typescript
wasm.clear(r: number, g: number, b: number): void
wasm.renderTriangles(): void
wasm.renderTrianglesParallel(): void  // Multi-threaded (requires pthreads build)
wasm.drawLine(x0, y0, x1, y1, r, g, b, depth): void
```

### Settings

```typescript
wasm.setEnableLighting(enable: boolean): void
wasm.setEnableDithering(enable: boolean): void
wasm.setEnableTexturing(enable: boolean): void
wasm.setEnableBackfaceCulling(enable: boolean): void
wasm.setEnableVertexSnapping(enable: boolean): void
wasm.setAmbientLight(ambient: number): void
wasm.setSnapResolution(x: number, y: number): void
```

### Threading

```typescript
wasm.setThreadCount(count: number): void  // Set threads (1-8)
wasm.getThreadCount(): number             // Get current thread count
```

### Lighting

```typescript
wasm.setLightDirection(x: number, y: number, z: number): void
wasm.setLightColor(r: number, g: number, b: number, intensity: number): void
```

### Textures

```typescript
wasm.getTextureBuffer(slot: number): Uint8Array
wasm.setTextureSize(slot: number, width: number, height: number): void
wasm.setCurrentTexture(slot: number): void  // -1 for no texture
```

## Parallel Rendering with pthreads

The rasterizer supports optional multi-threaded triangle processing using WebAssembly pthreads.

### Browser Requirements

Threading requires:
- **SharedArrayBuffer** support
- **Cross-Origin-Opener-Policy** (COOP) header: `same-origin`
- **Cross-Origin-Embedder-Policy** (COEP) header: `require-corp`

Add these headers to your server configuration:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Usage

```typescript
// For large scenes, use parallel rendering
wasm.setThreadCount(4);  // Use 4 threads
wasm.renderTrianglesParallel();  // Parallel rasterization

// For small scenes, sequential is faster
wasm.renderTriangles();  // Single-threaded (default)
```

### When to Use Parallel Rendering

- **Use parallel rendering** for scenes with many triangles (>1000)
- **Use sequential rendering** for simple scenes (<64 triangles) due to threading overhead
- The parallel function automatically falls back to sequential for small batches

## Integration with PS1ender

To integrate with the existing rasterizer:

1. Build the WASM module: `cd wasm && make install`
2. Import the wrapper in your render loop
3. Replace `Rasterizer` calls with WASM equivalents
4. Use `wasm.imageData` directly with `ctx.putImageData()`

The WASM module handles the hot path (triangle rasterization) while JavaScript handles:

- UI and editor logic
- Scene management
- Event handling
- Overlays and gizmos
