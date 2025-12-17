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
```

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

### Face-Based Topology (BMesh-style)

- `Face` interface: `{ vertices: number[], material?: number }`
- `mesh.faceData: Face[]` is the primary topology storage
- Supports quads, tris, and n-gons
- `rebuildFromFaces()` generates triangle indices via fan triangulation

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
- Build with `make` in `wasm/` folder
- SIMD-optimized for 3-4× performance improvement

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

### Adding a Test File

1. Create `module.test.ts` next to source file
2. Import from `bun:test`
3. Follow existing test patterns with helpers and describe blocks
4. Run with `bun test module.test.ts`

### Debugging

- Check browser console for runtime errors
- Use `console.log` in render-worker for rasterizer debugging
- WASM errors logged to console with stack traces
