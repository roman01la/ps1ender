# PS1ender

A Blender-inspired 3D graphics editor with PlayStation 1-style rendering. Built with a custom software rasterizer using Canvas 2D API and WebAssembly.

![PS1ender](https://img.shields.io/badge/status-beta-orange)
![License](https://img.shields.io/badge/license-ISC-blue)

## Features

### 🎨 PS1-Style Rendering
- **Software Rasterizer** - Custom implementation using Canvas 2D API
- **16-bit Depth Buffer** - Authentic PS1-style precision
- **Gouraud Shading** - Per-vertex lighting interpolation
- **Affine Texture Mapping** - Characteristic PS1 texture warping
- **Vertex Snapping** - Low-precision vertex positioning
- **Ordered Dithering** - 8×8 Bayer matrix for color banding
- **WebAssembly Acceleration** - SIMD-optimized rasterization (3-4× faster)

### 🛠️ 3D Modeling Tools
- **Object & Edit Modes** - Toggle with Tab key
- **Selection Modes** - Vertex, Edge, and Face selection (1/2/3 keys)
- **Transform Operations** - Move (G), Rotate (R), Scale (S) with axis constraints (X/Y/Z)
- **Mesh Editing** - Extrude (E), Delete (X), Fill (F), Duplicate (Shift+D)
- **Primitive Meshes** - Cube, Plane, UV Sphere, Ico Sphere, Cylinder, Cone, Torus
- **Advanced Selection** - Box select, edge loops (Alt+click), edge rings (Ctrl+Alt+click)
- **Undo/Redo** - Full history system (Ctrl+Z / Ctrl+Shift+Z)

### 🎭 Material & Shading System
- **Node-Based Shader Editor** - Visual material creation
- **Node Types** - Texture, Color, Mix, Color Ramp, Voronoi, Output
- **Material Baking** - Real-time texture generation from node graphs
- **WASM Bytecode Compiler** - Optimized material evaluation
- **Per-Object Materials** - Independent material assignment

### 📐 Viewport & Camera
- **Orthographic Views** - Front (1), Right (3), Top (7), toggle with (5)
- **Perspective View** - Camera view (0)
- **Shading Modes** - Wireframe, Solid, Material Preview (Z key)
- **Infinite Grid** - 3D workspace visualization
- **Viewport Gizmo** - Quick view switching

## Installation

### Prerequisites

- [Bun](https://bun.sh) - Fast JavaScript runtime and build tool
- Modern web browser with Canvas 2D support

### Quick Start

```bash
# Clone the repository
git clone https://github.com/roman01la/ps1ender.git
cd ps1ender

# Install dependencies
bun install

# Build and run
bun run dev
```

The application will be available at `http://localhost:3000`

### Building for Production

```bash
# Build optimized bundle
bun run prod

# Serve the public directory
bunx serve public
```

## Development

### Project Structure

```
ps1ender/
├── src/
│   ├── App.tsx              # Main application component
│   ├── editor.ts            # Editor orchestration
│   ├── scene.ts             # Scene graph and camera
│   ├── render-worker.ts     # Software renderer worker
│   ├── wasm-rasterizer.ts   # WASM rasterizer wrapper
│   ├── math.ts              # Vector/Matrix math
│   ├── primitives.ts        # Mesh factories
│   ├── obj-loader.ts        # OBJ file parser
│   ├── texture.ts           # Texture loading
│   ├── material.ts          # Material system
│   ├── systems/             # Editor subsystems
│   │   ├── history.ts       # Undo/redo system
│   │   ├── input.ts         # Input handling
│   │   ├── selection.ts     # Selection state
│   │   ├── transform.ts     # Transform operations
│   │   ├── mesh-edit.ts     # Mesh editing
│   │   ├── picking.ts       # Raycasting & picking
│   │   └── visualization.ts # Edit mode rendering
│   └── components/          # React UI components
│       ├── NodeEditor.tsx   # Shader node editor
│       ├── Toolbar.tsx      # Main toolbar
│       ├── SceneTree.tsx    # Object hierarchy
│       └── PropertiesPanel.tsx
├── wasm/
│   ├── rasterizer.cpp       # WASM rasterizer
│   └── README.md            # WASM build instructions
└── public/                  # Static assets

```

### Build Commands

```bash
# Development build with watch mode
bun run watch

# Development server (build + serve)
bun run dev

# Production build (minified)
bun run prod

# Build WASM rasterizer
cd wasm && make install
```

## Keyboard Shortcuts

### General
- `Tab` - Toggle Object/Edit mode
- `Z` - Cycle shading modes (Wireframe/Solid/Material)
- `Shift+A` - Add menu (primitives)
- `Shift+D` - Duplicate selected
- `X` / `Delete` - Delete selected
- `Ctrl+Z` - Undo
- `Ctrl+Shift+Z` - Redo

### Transform
- `G` - Move/Grab
- `R` - Rotate
- `S` - Scale
- `X/Y/Z` - Constrain to axis (after G/R/S)
- `Enter` - Confirm operation
- `Esc` - Cancel operation

### Edit Mode
- `1` - Vertex selection mode
- `2` - Edge selection mode
- `3` - Face selection mode
- `E` - Extrude (edges/faces)
- `F` - Fill/Create face
- `Ctrl+L` - Select linked geometry
- `Alt+Click` - Edge loop selection
- `Ctrl+Alt+Click` - Edge ring selection

### Camera
- `0` - Perspective view
- `1` - Front view
- `3` - Right view
- `7` - Top view
- `5` - Toggle orthographic/perspective
- `Mouse Drag` - Orbit camera
- `Mouse Wheel` - Zoom

### Shading Workspace
- `Right Click` / `Shift+A` - Add node menu
- `Click+Drag` - Pan node editor
- `Scroll` - Zoom node editor
- `X` / `Delete` - Delete node

## Technical Details

### Software Rasterizer

PS1ender uses a custom software rasterizer that mimics PlayStation 1 graphics characteristics:

- **Triangle Rasterization** - Barycentric coordinates for interpolation
- **Near-Plane Clipping** - PS1-style triangle rejection
- **Fixed-Point Depth** - 16-bit Z-buffer for authentic precision
- **Backface Culling** - Optimized rendering pipeline
- **Zero-Copy Rendering** - Direct buffer sharing with Canvas

### WebAssembly Acceleration

The WASM module provides significant performance improvements over the JavaScript implementation:

| Operation | JavaScript | WASM+SIMD | Speedup |
|-----------|-----------|-----------|---------|
| Clear buffers | 0.1ms | 0.02ms | 5× |
| Vertex transform | 0.2ms | 0.05ms | 4× |
| Rasterization | 0.8ms | 0.2ms | 4× |
| **Total** | ~1.1ms | ~0.3ms | **3-4×** |

*Benchmarks measured on 640×480 resolution with typical scene geometry. Performance may vary based on hardware and scene complexity.*

See [wasm/README.md](wasm/README.md) for WASM build instructions.

### BMesh-Style Topology

The mesh representation uses a face-based architecture similar to Blender's BMesh:

- Faces support quads, triangles, and n-gons
- Fan triangulation for rendering
- Preserves quad topology for editing operations
- Hides internal quad diagonal edges

## OBJ File Support

PS1ender can load OBJ files with MTL materials and textures:

```typescript
// Sample OBJ files included in public/
- roman_head.obj
- roman_head.mtl
- head.png
```

## Browser Compatibility

- Chrome/Edge 91+ (recommended)
- Firefox 89+
- Safari 15+

Requires Canvas 2D API and WebAssembly support.

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Acknowledgments

- Inspired by [Blender](https://www.blender.org/) UI/UX
- PlayStation 1 graphics techniques
- Uses [Blender icons](https://github.com/blender/blender) (GPL)
