# PS1ender - AI Coding Agent Instructions

## Project Overview

PS1ender is a **Blender-inspired 3D graphics editor** with PlayStation 1-style rendering. It uses a custom software rasterizer built on Canvas 2D API with optional WebAssembly acceleration.

**Key Technologies:**

- **Runtime:** Bun (JavaScript/TypeScript)
- **Frontend:** React 19, TypeScript
- **Build:** Bun bundler (`bun build`)
- **Testing:** Bun test (`bun test`)
- **Rendering:** Software rasterizer (Canvas 2D + WASM)

---

## Essential Commands

```bash
# Install dependencies
bun install

# Development build + serve
bun run dev

# Watch mode (auto-rebuild)
bun run watch

# Production build
bun run prod

# Run all tests
bun test

# Run specific test file
bun test src/systems/history.test.ts

# Run headless renderer test (requires Node.js for SIMD WASM support)
bun run test:headless

# Run MCP server (for AI visual debugging)
bun run mcp
```

---

## After Making Changes

**Always verify changes by:**

1. **Check TypeScript errors** - Use `get_errors` tool to catch type errors
2. **Run tests** - Execute `bun test` to ensure no regressions
3. **Rebuild WASM** (if editing `wasm/rasterizer.cpp`) - Run `bun run build:wasm`

Common issues to watch for:

- Variable scope issues (especially in React useEffect cleanup)
- Missing imports after refactoring
- Type mismatches when extracting components
- Aspect ratio / dimension calculations that break on edge cases

---

## Architecture

### Directory Structure

```
src/
├── App.tsx              # Main React component, UI + event handlers
├── editor.ts            # Editor orchestration, uses all systems
├── scene.ts             # Scene graph + Camera
├── math.ts              # Vector3, Vector4, Matrix4, Color, Ray
├── primitives.ts        # Mesh, Vertex, Triangle, Face types + factories
├── render-worker.ts     # Software renderer web worker
├── wasm-rasterizer.ts   # WASM rasterizer wrapper
├── headless-rasterizer.ts # Headless rendering for tests/MCP
├── material.ts          # Material system + WASM baking
├── obj-loader.ts        # OBJ/MTL file parser
├── texture.ts           # Texture loading
├── systems/             # Modular editor subsystems
│   ├── history.ts       # Undo/redo (GenericHistoryStack, History)
│   ├── input.ts         # Keyboard/mouse (InputManager)
│   ├── selection.ts     # Selection state (SelectionManager)
│   ├── transform.ts     # G/R/S operations (TransformManager)
│   ├── mesh-edit.ts     # Delete/extrude/fill (MeshEditManager)
│   ├── picking.ts       # Raycasting (PickingManager)
│   ├── visualization.ts # Edit mode rendering
│   ├── ui-state.ts      # React UI state sync hook
│   └── worker-render-loop.ts
├── components/          # React UI components
│   ├── NodeEditor.tsx   # Shader node editor (~1500 lines)
│   ├── AddMenu.tsx      # Shift+A primitive menu
│   ├── SceneTree.tsx    # Object list panel
│   ├── PropertiesPanel.tsx
│   └── ...
└── icons/               # Blender SVG icons
```

### System Architecture Pattern

Each system in `src/systems/` follows a **manager class pattern**:

```typescript
export class SomeManager {
  // Dependencies injected via constructor or methods
  constructor() {}

  // Pure functions that take context objects
  someOperation(context: SomeContext): SomeResult {
    // Implementation
  }
}
```

Systems are stateless or minimally stateful, receiving context objects with scene, camera, and other dependencies.

### Key Classes

| Class                                | File                   | Purpose                         |
| ------------------------------------ | ---------------------- | ------------------------------- |
| `Vector3`, `Vector4`                 | `math.ts`              | 3D/4D vector operations         |
| `Matrix4`                            | `math.ts`              | 4x4 transformation matrices     |
| `Color`                              | `math.ts`              | RGBA color with utility methods |
| `Ray`                                | `math.ts`              | Ray for raycasting              |
| `Mesh`, `Vertex`, `Triangle`, `Face` | `primitives.ts`        | Mesh data structures            |
| `History`, `GenericHistoryStack`     | `systems/history.ts`   | Undo/redo                       |
| `SelectionManager`                   | `systems/selection.ts` | Vertex/edge/face selection      |
| `TransformManager`                   | `systems/transform.ts` | Grab/rotate/scale operations    |
| `PickingManager`                     | `systems/picking.ts`   | Screen-space picking            |
| `MeshEditManager`                    | `systems/mesh-edit.ts` | Mesh editing operations         |
| `InputManager`                       | `systems/input.ts`     | Keyboard/mouse handling         |

---

## Testing Guidelines

### Test Framework

Uses **bun:test** (similar to Jest API):

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
```

### Test File Naming

- Test files: `*.test.ts`
- Place next to source: `systems/history.ts` → `systems/history.test.ts`
- Math tests: `src/math.test.ts`

### Test Structure Pattern

```typescript
/**
 * Unit tests for [Module Name]
 *
 * Tests [description of what's tested]
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { SomeClass } from "./module";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestFixture(): SomeType {
  // Create test data
}

// ============================================================================
// Category Tests
// ============================================================================

describe("ModuleName - Category", () => {
  let instance: SomeClass;

  beforeEach(() => {
    instance = new SomeClass();
  });

  test("should do something specific", () => {
    const result = instance.method();
    expect(result).toBe(expected);
  });
});
```

### Window/DOM Mocking

For tests requiring browser APIs, mock at module level:

```typescript
// Mock window/DOM before imports
class MockEventTarget {
  private listeners: Map<string, Set<EventListener>> = new Map();
  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  // ...
}

(globalThis as any).window = new MockEventTarget();
(globalThis as any).KeyboardEvent = MockKeyboardEvent;
// etc.
```

### Floating Point Comparisons

Use `toBeCloseTo()` for floating point assertions:

```typescript
expect(result.x).toBeCloseTo(expected, 5); // 5 decimal places
```

### Existing Tests

| File                        | Tests | Coverage                                    |
| --------------------------- | ----- | ------------------------------------------- |
| `systems/history.test.ts`   | 47    | GenericHistoryStack, History, serialization |
| `systems/selection.test.ts` | 41    | SelectionManager operations                 |
| `systems/transform.test.ts` | 37    | TransformManager G/R/S operations           |
| `systems/input.test.ts`     | 50    | InputManager with window mocks              |
| `systems/picking.test.ts`   | 50    | PickingManager raycasting                   |
| `systems/mesh-edit.test.ts` | 40    | Delete/extrude/join/fill operations         |
| `math.test.ts`              | 78    | Vector3, Vector4, Matrix4, Color, Ray       |

---

## Code Patterns

### Immutable Operations

Math classes return new instances:

```typescript
const v1 = new Vector3(1, 0, 0);
const v2 = v1.mul(2); // Returns new Vector3, v1 unchanged
```

### Edge Keys

Edges are stored as sorted string keys:

```typescript
function makeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
```

### Position Keys (Co-located Vertex Handling)

**CRITICAL:** The epsilon value (0.0001) must be consistent across ALL position comparisons:

```typescript
const epsilon = 0.0001;
const getPositionKey = (pos) =>
  `${Math.round(pos.x / epsilon)},${Math.round(pos.y / epsilon)},${Math.round(
    pos.z / epsilon
  )}`;
```

### Face-Based Topology (BMesh-style)

- `Face` interface: `{ vertices: number[], material?: number }`
- `mesh.faceData: Face[]` is the primary topology storage
- Supports quads, tris, and n-gons
- `rebuildFromFaces()` generates triangle indices via fan triangulation
- Fan triangulation: Quad `[v0, v1, v2, v3]` → triangles `[v0, v1, v2]` and `[v0, v2, v3]`

### Per-Face Vertex Duplication

Meshes use **per-face vertex duplication** for smooth normals:

- Each triangle has its own set of 3 vertex indices
- A cube has 24 vertices (4 per face × 6 faces), not 8
- Use `mesh.indices[]` for editing, NOT `mesh.triangles[]` (triangles are cloned copies)

```typescript
// CORRECT: Use indices for editing
const i0 = mesh.indices[faceIdx * 3];
const pos = mesh.vertices[i0].position;

// WRONG: triangles contains cloned data
const pos = mesh.triangles[faceIdx].v0.position; // This is a copy!
```

### Co-located Vertex Strategies

Due to per-face vertex duplication, multiple indices exist at the same position:

| Mode      | Strategy                  | Method                               |
| --------- | ------------------------- | ------------------------------------ |
| Vertex    | Direct edge adjacency     | `getConnectedColocatedVertices()`    |
| Edge/Face | Full component flood-fill | `getColocatedVerticesForPositions()` |

**Why different strategies?**

- Vertex mode: Only immediately adjacent duplicates should move
- Edge/Face mode: ALL co-located vertices in the connected component must move

### Transform Results

Transform operations return result objects for history:

```typescript
interface TransformResult {
  success: boolean;
  beforeState?: TransformState;
  afterState?: TransformState;
}
```

### Picking Context

Picking functions receive a context object:

```typescript
interface PickContext {
  camera: Camera;
  scene: Scene;
  canvasWidth: number;
  canvasHeight: number;
}
```

---

## Important Notes

### Coordinate System

- Z-up coordinate system (Blender convention)
- Camera uses pitch/yaw for rotation
- Orthographic views: Front (1), Right (3), Top (7), Perspective (0), Toggle (5)

### Edit Mode vs Object Mode

- **Object Mode:** Select/transform whole objects
- **Edit Mode:** Select/modify vertices, edges, faces (Tab to toggle)
- Selection modes: Vertex (1), Edge (2), Face (3)

### Keyboard Shortcuts

| Key            | Action                |
| -------------- | --------------------- |
| `G`            | Grab/move             |
| `R`            | Rotate                |
| `S`            | Scale                 |
| `X/Y/Z`        | Axis constraint       |
| `Tab`          | Toggle edit mode      |
| `1/2/3`        | Vertex/Edge/Face mode |
| `E`            | Extrude               |
| `F`            | Fill/join             |
| `X/Del`        | Delete                |
| `Shift+D`      | Duplicate             |
| `Ctrl+Z`       | Undo                  |
| `Ctrl+Shift+Z` | Redo                  |

### WASM Rasterizer

- Located in `wasm/` directory
- Build with `bun run build:wasm`
- SIMD-optimized (v128 registers) for 3-4× performance improvement
- 16-bit fixed-point Z-buffer (PS1 style)

### Material System Bytecode

Materials compile to bytecode executed in WASM. Opcodes use a stack-based VM:

| Opcode                   | Value | Description                             |
| ------------------------ | ----- | --------------------------------------- |
| `BAKE_OP_FLAT_COLOR`     | 0     | Push RGBA color (4 bytes follow)        |
| `BAKE_OP_SAMPLE_TEXTURE` | 1     | Sample texture at UV                    |
| `BAKE_OP_MIX_MULTIPLY`   | 2     | Pop 2 colors, push multiplied result    |
| `BAKE_OP_MIX_ADD`        | 3     | Pop 2 colors, push added result         |
| `BAKE_OP_MIX_LERP`       | 4     | Pop 2 colors, push lerped result        |
| `BAKE_OP_COLOR_RAMP`     | 5     | Evaluate gradient with factor           |
| `BAKE_OP_VORONOI`        | 6     | Generate cell noise (scale, mode bytes) |
| `BAKE_OP_ALPHA_CUTOFF`   | 7     | Binary alpha threshold                  |
| `BAKE_OP_NOISE`          | 8     | Procedural noise (scale, octaves, mode) |
| `BAKE_OP_END`            | 255   | End of program                          |

### Headless Rendering

The project includes a headless rendering module (`src/headless-rasterizer.ts`) for:

- Screenshot tests
- Visual debugging
- MCP service integration for AI visual debugging

**Usage:**

```typescript
import { HeadlessRenderer } from "./headless-rasterizer";
import { createCubeMesh } from "./primitives";
import { SceneObject, Camera } from "./scene";

const renderer = await HeadlessRenderer.create(640, 480);
const cube = new SceneObject("Cube", createCubeMesh());
const camera = new Camera();
renderer.renderScene([cube], camera);
await renderer.savePNG("output.png");
```

**Note:** Requires Node.js (not Bun) for SIMD WASM support. Run with `npx tsx` or `bun run test:headless`.

### MCP Server

The project includes an MCP (Model Context Protocol) server (`src/mcp-server.ts`) that exposes the headless renderer and editor functionality to AI agents for visual debugging and scene manipulation.

**Run the server:**

```bash
bun run mcp
```

**Available Tools:**

| Tool                    | Description                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| `render_scene`          | Render current scene to PNG (returns base64 image)                            |
| `add_primitive`         | Add primitive (cube, sphere, cylinder, cone, torus, plane, circle, icosphere) |
| `delete_object`         | Remove object by name                                                         |
| `list_objects`          | List all objects with transforms                                              |
| `transform_object`      | Move/rotate/scale object                                                      |
| `select_object`         | Select object by name                                                         |
| `deselect_all`          | Deselect all objects                                                          |
| `set_camera`            | Configure camera position/target/FOV                                          |
| `set_view`              | Set predefined view (front, back, left, right, top, bottom, persp)            |
| `get_scene_info`        | Get detailed scene information                                                |
| `set_render_settings`   | Configure PS1-style effects (dithering, vertex snap, lighting)                |
| `create_material`       | Create new material                                                           |
| `set_object_material`   | Assign material to object                                                     |
| `set_object_color`      | Set vertex colors for object                                                  |
| `clear_scene`           | Remove all objects                                                            |
| `duplicate_object`      | Duplicate object with optional offset                                         |
| `set_object_visibility` | Show/hide object                                                              |

**Example MCP Client Usage:**

```typescript
// Add a cube
await client.callTool("add_primitive", {
  type: "cube",
  position: { x: 0, y: 0, z: 1 },
  settings: { size: 2 },
});

// Set camera view
await client.callTool("set_view", { view: "persp" });

// Enable PS1 effects
await client.callTool("set_render_settings", {
  enableDithering: true,
  enableVertexSnapping: true,
  snapResolutionX: 320,
  snapResolutionY: 240,
});

// Render scene
const result = await client.callTool("render_scene", {
  width: 640,
  height: 480,
});
// result.content[0] contains base64 PNG image
```

---

## Documentation References

- **KNOWLEDGE.md** - Detailed implementation notes, edge cases, lessons learned
- **PLAN.md** - Feature roadmap and completion status
- **README.md** - User-facing documentation

---

## Common Tasks

### Adding a New System

1. Create `src/systems/new-system.ts` with manager class
2. Export types and class from module
3. Create `src/systems/new-system.test.ts` with tests
4. Integrate with `editor.ts` or relevant component

### Adding a New Primitive

1. Add factory function to `src/primitives.ts`
2. Add to `AddMenu.tsx` component
3. Optionally add settings to `PrimitiveSettings.tsx`

### Adding a New Shader Node Type

When adding a new node to the material/shader editor:

**TypeScript Side:**

1. **Add NodeType** - Add type name to `NodeType` union in `src/material.ts`
2. **Add BAKE_OP constant** - Add `BAKE_OP_YOUR_NODE = N` in `src/wasm-rasterizer.ts`
3. **Add compilation case** - Add case in `compileNode()` function in `src/material.ts`
4. **Add evaluateNode case** - Add case in `evaluateNode()` for JS fallback in `src/material.ts`
5. **Add node color** - Add entry to `NODE_COLORS` record in `src/components/NodeEditor.tsx`
6. **Add createNode factory** - Add case in `createNode()` with width, height, inputs, outputs, and default data
7. **Add getNodeTitle** - Add case in `getNodeTitle()` for display name
8. **Add context menu button** - Add button in the appropriate category (Generator, Converter, etc.)
9. **Add UI controls** - Add sliders/dropdowns for node parameters (follow Voronoi/Noise pattern)

**WASM Side:**

10. **Add enum value** - Add `BAKE_OP_YOUR_NODE = N` to `BakeOp` enum in `wasm/rasterizer.cpp`
11. **Add case handler** - Add `case BAKE_OP_YOUR_NODE:` in `bake_material()` switch statement
12. **Rebuild WASM** - Run `bun run build:wasm`

**Verify:**

13. Check for TypeScript errors with `get_errors` tool
14. Run `bun test` to ensure no regressions

### Adding a Test File

1. Create `module.test.ts` next to source file
2. Import from `bun:test`
3. Follow existing test patterns with helpers and describe blocks
4. Run with `bun test module.test.ts`

### Debugging

- Check browser console for runtime errors
- Use `console.log` in render-worker for rasterizer debugging
- WASM errors logged to console with stack traces

### Common Issues & Solutions

**"Geometry is tearing/stretching"**

- Check if co-located vertices are being handled correctly
- For vertex mode: use `getConnectedColocatedVertices()` (adjacent only)
- For edge/face mode: use `getColocatedVerticesForPositions()` (full component)

**"Transform affects unexpected vertices"**

- Verify the correct expansion strategy for current selection mode
- Print selected vertex indices to debug
- Check component filtering for disconnected geometry (e.g., Suzanne's eyes)

**"Deletion leaves orphan vertices"**

- Mesh rebuild should handle this - check index remapping
- Verify triangles array is rebuilt from indices

**"Select Linked selects wrong geometry"**

- Verify geometric edge detection uses position-based keys
- Check epsilon value consistency (must be 0.0001 everywhere)

**"Quad diagonals showing in edge mode"**

- `getQuadDiagonalEdges()` must return position-based edge keys
- Diagonal key format: `[posKey0, posKey1].sort().join("|")`
