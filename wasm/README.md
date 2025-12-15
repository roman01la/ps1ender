# WASM Rasterizer

A SIMD-accelerated PS1-style software rasterizer compiled to WebAssembly.

## Features

- **SIMD acceleration**: Processes 4 pixels at a time using WebAssembly SIMD
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

Install LLVM with WASM support:

```bash
# macOS
brew install llvm

# Linux (Ubuntu/Debian)
apt install clang lld
```

### Build

```bash
# Using make
make

# Or directly
make install  # Copies to ../public/

# Check compiler
make check
```

### Manual build

```bash
clang++ -O3 -flto --target=wasm32 -msimd128 -nostdlib \
  -fno-exceptions -fno-rtti \
  -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined \
  -Wl,--initial-memory=67108864 \
  -o rasterizer.wasm rasterizer.cpp
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
