# PS1ender Implementation Knowledge

This document captures implementation details, edge cases, and lessons learned during development. Use this as a reference when debugging or extending features.

---

## Architecture Overview

### Current State (refactored)

The codebase has been refactored to extract systems into separate modules:

```
src/
├── App.tsx (~1100 lines)    ← UI + Event handlers (uses all systems)
├── editor.ts (~2100 lines)  ← Editor orchestration (uses all systems)
├── scene.ts (371 lines)     ← Scene graph + Camera
├── rasterizer.ts (860 lines)← Software renderer
├── math.ts (594 lines)      ← Vector/Matrix math
├── primitives.ts (~1300 lines)← Vertex/Triangle types + mesh factories + logical faces
├── obj-loader.ts (344 lines)← OBJ file parser
├── texture.ts (352 lines)   ← Texture loading
├── material.ts (~1200 lines) ← Material system + WASM baking + bytecode compiler ✅
├── svg.d.ts                 ← TypeScript SVG module declaration
├── systems/
│   ├── history.ts (~550 lines)      ← Unified undo/redo with multi-stack manager ✅
│   ├── input.ts (~360 lines)        ← Keyboard/mouse + context-aware shortcuts ✅
│   ├── selection.ts (~700 lines)    ← Selection state + queries ✅
│   ├── transform.ts (~500 lines)    ← Grab/rotate/scale operations ✅
│   ├── mesh-edit.ts (~1100 lines)   ← Delete/extrude vertices/edges/faces ✅
│   ├── picking.ts (~800 lines)      ← Raycasting + element picking + box select ✅
│   ├── visualization.ts (~600 lines)← Edit mode visualization + quad handling ✅
│   ├── ui-state.ts (~280 lines)     ← UI state sync hook ✅
│   ├── render-loop.ts (~330 lines)  ← Animation loop + rendering ✅
│   └── worker-render-loop.ts        ← Frame building for WASM rasterizer ✅
├── components/
│   ├── NodeEditor.tsx (~1500 lines) ← Shader node editor ✅
│   ├── AddMenu.tsx          ← Shift+A primitive add menu (7 primitives)
│   ├── PrimitiveSettings.tsx← Modal for configuring primitive parameters
│   ├── ToolbarButton.tsx    ← Reusable toolbar button component
│   ├── Toolbar.tsx          ← Main toolbar with workspace tabs
│   ├── WorkspaceTabs.tsx    ← Workspace switching (Modeling/Shading)
│   ├── StatusBar.tsx        ← Mode, selection info, FPS display
│   ├── SceneTree.tsx        ← Object list with multi-select support
│   ├── PropertiesPanel.tsx  ← Transform property editing
│   ├── ShadingContextMenu.tsx ← Right-click context menu for shading
│   ├── ViewportGizmo.tsx    ← 3D axis gizmo in viewport corner
│   ├── WelcomeModal.tsx     ← Initial welcome dialog
│   └── Instructions.tsx     ← Keyboard shortcut overlay
└── icons/                   ← Blender SVG icons (500+)
```

### Systems & Their Locations

| System                  | Location                       | Status       |
| ----------------------- | ------------------------------ | ------------ |
| Undo/Redo               | `src/systems/history.ts`       | ✅ Extracted |
| Keyboard/Mouse Input    | `src/systems/input.ts`         | ✅ Extracted |
| Selection (vertex/edge) | `src/systems/selection.ts`     | ✅ Extracted |
| Transforms (G/R/S)      | `src/systems/transform.ts`     | ✅ Extracted |
| Mesh editing            | `src/systems/mesh-edit.ts`     | ✅ Extracted |
| Picking (ray cast)      | `src/systems/picking.ts`       | ✅ Extracted |
| Edit mode visualization | `src/systems/visualization.ts` | ✅ Extracted |
| UI state sync           | `src/systems/ui-state.ts`      | ✅ Extracted |
| Render loop             | `src/systems/render-loop.ts`   | ✅ Extracted |

### Refactoring Strategy (incremental)

1. **Phase 1: Extract History System** ✅ COMPLETE (+ Extended)

   - Moved undo/redo types and logic to `src/systems/history.ts`
   - Editor uses `History` class instance (`this.history`)
   - Exports: `History`, `HistoryAction`, `serializeMesh`, `deserializeMesh`
   - **Selection changes:** `selection-change` action type tracks vertex/edge/face selection state
   - **Mode changes:** `mode-change` action type tracks edit mode, selection mode, and selected object

   **Extended with Unified History Manager:**

   - `GenericHistoryStack<T>` - Generic state-snapshot based undo/redo
   - `IHistoryStack` - Common interface for all history stacks
   - `MultiStackHistoryManager` - Manages multiple named stacks
   - `historyManager` - Global singleton instance
   - `HISTORY_STACK_3D_EDITOR` - Constant for 3D editor stack ID
   - 3D editor registers its `History` instance with the manager
   - Shader editor uses `GenericHistoryStack<ShaderEditorState>` per material
   - ~550 lines in dedicated module

2. **Phase 2: Extract Input System** ✅ COMPLETE

   - Moved keyboard/mouse handling to `src/systems/input.ts`
   - Created `InputManager` class with context-aware shortcut support
   - Tracks: held keys, mouse state, viewport focus, transform state
   - Methods: `isKeyHeld()`, `getPointerOverViewport()`, `setMouseDragging()`
   - App.tsx uses `inputManagerRef` instead of separate refs
   - ~400 lines in dedicated module

3. **Phase 3: Extract Selection System** ✅ COMPLETE

   - Moved selection state + operations to `src/systems/selection.ts`
   - Created `SelectionManager` class
   - Manages: selection mode, selectedVertices/Edges/Faces sets
   - Edge utilities: `makeEdgeKey()`, `parseEdgeKey()`, `getMeshEdges()`
   - Co-located vertex handling: `getColocatedVerticesForPositions()`, `getConnectedColocatedVertices()`
   - Bulk operations: `selectAll()`, `selectLinked()`, `clearAll()`
   - Editor exposes selection via getters that delegate to SelectionManager
   - ~700 lines in dedicated module

4. **Phase 4: Extract Transform System** ✅ COMPLETE

   - Moved transform operations to `src/systems/transform.ts`
   - Created `TransformManager` class
   - Types: `TransformMode`, `AxisConstraint`, `TransformState`, `TransformContext`
   - Vertex transforms: `startVertexGrab/Rotate/Scale()` with pivot calculation
   - Object transforms: `startObjectGrab/Rotate/Scale()`
   - Methods: `setAxisConstraint()`, `update()`, `confirm()`, `cancel()`
   - Helper: `rotateVectorAroundAxis()` for rotation math
   - Returns `TransformResult` with before/after state for history integration
   - Editor delegates all transform operations to TransformManager
   - ~500 lines in dedicated module

5. **Phase 5: Extract Mesh Edit System** ✅ COMPLETE

   - Moved mesh editing operations to `src/systems/mesh-edit.ts`
   - Created `MeshEditManager` class
   - Methods: `deleteVertices()`, `deleteEdges()`, `deleteFaces()`
   - Helper: `removeUnusedVertices()` for mesh cleanup
   - Returns `MeshEditResult` with success/deletedFaces/deletedVertices
   - Editor delegates all delete operations to MeshEditManager
   - ~250 lines in dedicated module

6. **Phase 6: Extract Picking System** ✅ COMPLETE

   - Moved picking/raycasting to `src/systems/picking.ts`
   - Created `PickingManager` class
   - Methods: `screenToRay()`, `projectToScreen()`, `pickObject()`, `pickVertex()`, `pickEdge()`, `pickFace()`
   - Helper: `getColocatedVertices()`, `getMeshEdges()`
   - Types: `PickContext`, `ScreenPoint`, `PickEdge`
   - Editor delegates all picking operations to PickingManager
   - ~350 lines in dedicated module

7. **Phase 7: Extract Edit Mode Visualization** ✅ COMPLETE

   - Extracted visualization data generation from `editor.ts`
   - Created `VisualizationManager` class in `src/systems/visualization.ts`
   - Methods extracted:
     - `createGizmoData()` - Transform gizmo XYZ axes with axis constraint highlighting
     - `createAxisIndicator()` - Viewport corner axis indicator using camera orientation
     - `createVertexPointData()` - Vertex points with depth occlusion
     - `createVertexWireframeData()` - Wireframe overlay in vertex mode
     - `createEdgeLineData()` - Edge lines with selection highlighting
     - `createFaceHighlightData()` - Face outlines with selection highlighting
   - Types: `GizmoData`, `VertexPointData`, `LineData`, `VisualizationContext`
   - Helpers: `makeEdgeKey()`, `parseEdgeKey()`, `getMeshEdges()`
   - Shared `isPointVisible()` helper for depth-based occlusion
   - ~450 lines in dedicated module
   - Editor.ts reduced from ~1612 to ~1337 lines

8. **Phase 8: Extract UI State Sync** ✅ COMPLETE

   - Extracted UI state synchronization from `App.tsx`
   - Created `useEditorUIState()` custom React hook in `src/systems/ui-state.ts`
   - Functionality extracted:
     - All UI state variables (mode, viewMode, selectedObject, transform props, etc.)
     - `updateUIState()` with throttling (50ms interval)
     - `handleModeChange()`, `handleViewModeChange()`, `handleSettingsChange()`
     - Force update logic for immediate user action feedback
   - Types: `UIState`, `UIStateSetters`, `UIStateActions`, `RendererSettings`, `SceneObjectInfo`
   - ~260 lines in dedicated module
   - App.tsx reduced from ~773 to ~685 lines

9. **Phase 9: Extract Render Loop** ✅ COMPLETE

   - Extracted render loop from `App.tsx` useEffect
   - Created `RenderLoop` class in `src/systems/render-loop.ts`
   - Functionality extracted:
     - `RenderLoop` class with start/stop methods
     - FPS-limited animation frame management
     - `renderFrame()` - Full scene rendering orchestration
     - `renderEditorOverlays()` - Gizmo + edit mode visualizations
     - `applyViewMode()` - Wireframe/solid/material mode switching
     - `updateCameraFromInput()` - Camera movement from held keys
   - Types: `RenderContext`, `RenderCallbacks`, `TimingState`, `GridData`
   - ~350 lines in dedicated module
   - App.tsx reduced from ~685 to ~493 lines

---

## Refactoring Progress

✅ **All 9 phases of the architecture refactoring are complete!**

| Phase | System        | Lines | Status |
| ----- | ------------- | ----- | ------ |
| 1     | History       | ~260  | ✅     |
| 2     | Input         | ~400  | ✅     |
| 3     | Selection     | ~700  | ✅     |
| 4     | Transform     | ~500  | ✅     |
| 5     | MeshEdit      | ~250  | ✅     |
| 6     | Picking       | ~800  | ✅     |
| 7     | Visualization | ~450  | ✅     |
| 8     | UI State      | ~260  | ✅     |
| 9     | Render Loop   | ~350  | ✅     |
|       | **Total**     | ~3520 |        |

**Results:**

- `editor.ts` reduced from ~2300 lines to ~1340 lines
- `App.tsx` reduced from ~773 lines to ~493 lines
- 9 dedicated system modules in `src/systems/`
- Clean separation of concerns

---

## Mesh Data Structure

### Per-Face Vertex Duplication

The mesh structure uses **per-face vertex duplication** for smooth normals. This means:

- Each triangle has its own set of 3 vertex indices
- Vertices at the same geometric position can have different indices
- A cube has 24 vertices (4 per face × 6 faces), not 8
- Suzanne has ~1966 vertices but only ~505 unique positions

**Key arrays:**

- `mesh.vertices[]` - Array of Vertex objects with position, color, normal, UV
- `mesh.indices[]` - Flat array of vertex indices (every 3 = one triangle)
- `mesh.triangles[]` - CLONED vertices for rendering (don't use for editing!)

### Triangle vs Index Access

```typescript
// CORRECT: Use indices for editing
const i0 = mesh.indices[faceIdx * 3];
const i1 = mesh.indices[faceIdx * 3 + 1];
const i2 = mesh.indices[faceIdx * 3 + 2];
const pos = mesh.vertices[i0].position;

// WRONG: triangles contains cloned data
const pos = mesh.triangles[faceIdx].v0.position; // This is a copy!
```

---

## Logical Faces / Quad Detection

### Overview

Blender displays quads (4-sided faces) rather than raw triangles. PS1ender implements this with a **logical face** system that groups triangle pairs into quads.

### Data Structure

```typescript
interface LogicalFace {
  triangles: number[];  // Triangle indices (1 for tri, 2 for quad)
  isQuad: boolean;      // true if this is a quad
}

// In Mesh class:
faces: LogicalFace[]  // Built automatically from triangles
```

### Quad Detection Algorithm

OBJ files triangulate quads into consecutive triangle pairs:

- Original quad: `[v0, v1, v2, v3]`
- Triangle 1: `[v0, v1, v2]`
- Triangle 2: `[v0, v2, v3]`

The algorithm checks consecutive triangle pairs:

1. Count shared vertex positions (using epsilon = 0.0001)
2. If exactly 2 positions are shared (the diagonal), AND
3. The triangles are roughly coplanar (normal dot > 0.9)
4. → Mark as a quad

```typescript
// In Mesh.buildFaces()
while (i < numTris) {
  if (i + 1 < numTris) {
    const sharedCount = countSharedPositions(keys1, keys2);
    if (sharedCount === 2 && areCoplanar(i, i + 1)) {
      this.faces.push({ triangles: [i, i + 1], isQuad: true });
      i += 2;
      continue;
    }
  }
  this.faces.push({ triangles: [i], isQuad: false });
  i += 1;
}
```

### Quad Diagonal Edges

Internal diagonal edges (inside quads) should be hidden in edge mode. The `getQuadDiagonalEdges()` method returns position-based edge keys for all quad diagonals.

```typescript
// In Mesh class
getQuadDiagonalEdges(): Set<string> {
  // For each quad face, find the 2 shared positions (diagonal)
  // Return as position-based edge keys for matching
}

// In getMeshEdges(mesh, skipQuadDiagonals = false)
if (skipQuadDiagonals) {
  // Filter out edges that match quad diagonal positions
}
```

### Usage in Visualization

| Mode   | Quad Handling                                   |
| ------ | ----------------------------------------------- |
| Face   | `createFaceHighlightData()` draws quad outlines |
| Edge   | `createEdgeLineData()` skips diagonal edges     |
| Vertex | `createVertexWireframeData()` skips diagonals   |

### Face Selection Workflow

1. **Picking:** `pickFace()` returns logical face index via `mesh.getFaceForTriangle(triIdx)`
2. **Selection:** `selectedFaces` contains logical face indices (not triangle indices)
3. **Transforms:** Convert logical faces to vertex indices via `getTrianglesForFace()`
4. **Deletion:** `deleteFaces()` expands logical faces to triangle indices before removing

---

## BMesh-Style Face Data Architecture

### Overview

The mesh now uses a BMesh-inspired `faceData` array as the primary topology storage. This supports quads, triangles, and n-gons natively, rather than storing everything as triangles.

### Data Structure

```typescript
interface Face {
  vertices: number[];  // Ordered vertex indices (2=edge, 3=tri, 4=quad, 5+=n-gon)
  material?: number;   // Optional material index
}

// In Mesh class:
faceData: Face[]      // Primary topology storage
faces: LogicalFace[]  // Legacy structure (rebuilt from faceData)
indices: number[]     // Triangulated indices for rendering
```

### Fan Triangulation Convention

Quads and n-gons are triangulated using fan triangulation from the first vertex:

- Quad `[v0, v1, v2, v3]` → triangles `[v0, v1, v2]` and `[v0, v2, v3]`
- The diagonal is always between `vertices[0]` and `vertices[2]`

### Winding Order Preservation

**Critical:** When extracting a quad from two triangles, the quad vertex order must be chosen such that fan triangulation produces triangles with the **same winding** as the originals.

The `extractQuadVertices()` method:

1. Identifies shared vertices (diagonal) and unique vertices (corners)
2. Tries all 8 possible quad orderings
3. For each ordering, checks if fan triangulation produces triangles that are **rotations** of the originals (same winding)
4. Returns the first ordering that matches

```typescript
// WRONG: Only checking vertex sets (ignores winding)
const sameTriangle = (t1, t2) => setEquals(new Set(t1), new Set(t2));
// [0,1,2] and [0,2,1] would match - but they have OPPOSITE winding!

// CORRECT: Checking for rotation match (same winding)
const sameWindingTriangle = (t1, t2) => {
  for (let rot = 0; rot < 3; rot++) {
    if (
      t1[0] === t2[rot] &&
      t1[1] === t2[(rot + 1) % 3] &&
      t1[2] === t2[(rot + 2) % 3]
    ) {
      return true;
    }
  }
  return false;
};
```

### Key Methods

| Method                    | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `rebuildFromFaces()`      | Regenerate indices from faceData (call after modifying faceData) |
| `triangulateFromFaces()`  | Convert faceData to triangulated indices                         |
| `buildFacesFromIndices()` | Reconstruct faceData from indices (used by constructor)          |
| `extractQuadVertices()`   | Extract ordered quad vertices preserving winding                 |
| `addFace()`               | Add a face to faceData                                           |
| `getQuadDiagonalEdges()`  | Get diagonal edges (for hiding in edge mode)                     |

### Workflow for Mesh Operations

**Operations that modify faceData directly:**

- `fillEdges()` - adds face to faceData, calls `rebuildFromFaces()`
- `extrudeEdges()` - adds quad faces to faceData, calls `rebuildFromFaces()`
- `createFaceFromVertices()` - adds face with winding check, calls `rebuildFromFaces()`

**Operations that modify indices directly (legacy):**

- `extrudeVertices()` - creates degenerate triangles, calls `rebuildMesh()`
- `joinVertices()` - creates degenerate triangle, calls `rebuildMesh()`

### Winding Consistency for New Faces

When creating a new face adjacent to existing faces, `ensureConsistentWinding()` checks:

1. Build position-based edge keys for the new face
2. For each existing face, check if any edge is shared (by position)
3. If shared edge goes **same direction** in both faces → reverse new face winding
4. If shared edge goes **opposite direction** → winding is already consistent

---

## File Format Handling

### OBJ Format

OBJ files store faces as n-gons (quads, triangles, or higher). The `OBJLoader`:

1. Parses face commands (`f`) and stores original face vertex counts in `faceData`
2. Triangulates faces for rendering (fan triangulation)
3. **Preserves quads/n-gons** - faceData contains the original topology

### GLTF Format

GLTF files store **only triangulated geometry** (no quads/n-gons). The `GLTFLoader`:

1. Parses triangulated indices from GLTF
2. **Relies on Mesh constructor** to detect quads via `buildFacesFromIndices()`
3. Does NOT manually build faceData - lets quad detection reconstruct topology

**Key insight:** GLTF stores triangulated data, but consecutive triangle pairs that share exactly 2 vertex positions (the diagonal) and are coplanar are reconstructed as quads.

### Primitive Creation

Primitive creation functions (`createCubeMesh()`, etc.):

1. Build vertices and triangulated indices
2. Pass to `Mesh(vertices, indices)` constructor
3. Constructor calls `buildFacesFromIndices()` to detect quads

---

### Architecture

Selection is managed by `SelectionManager` class in `src/systems/selection.ts`. The Editor class delegates all selection operations to this manager.

```typescript
// Editor exposes selection via getters
get selectionMode(): SelectionMode { return this.selection.mode; }
get selectedVertices(): ReadonlySet<number> { return this.selection.selectedVertices; }
get selectedEdges(): ReadonlySet<string> { return this.selection.selectedEdges; }
get selectedFaces(): ReadonlySet<number> { return this.selection.selectedFaces; }
```

### Co-located Vertex Handling

Because of per-face vertex duplication, clicking one vertex visually may correspond to multiple vertex indices at the same position.

**Position Key Generation:**

```typescript
const epsilon = 0.0001;
const getPositionKey = (pos) =>
  `${Math.round(pos.x / epsilon)},${Math.round(pos.y / epsilon)},${Math.round(
    pos.z / epsilon
  )}`;
```

**CRITICAL:** The epsilon value (0.0001) must be consistent across all position comparisons. Changing it can break topology detection.

### Selection Mode Behaviors

| Mode   | Selection Storage               | Transform Vertex Expansion           |
| ------ | ------------------------------- | ------------------------------------ |
| Vertex | `selectedVertices: Set<number>` | Topology-aware co-located expansion  |
| Edge   | `selectedEdges: Set<string>`    | Component-aware co-located expansion |
| Face   | `selectedFaces: Set<number>`    | Component-aware co-located expansion |

### Selection Mode Conversion (Blender Behavior)

When switching selection modes, selection is preserved by converting to the new mode:

**Lower-level conversions (expand):**
| From | To | Behavior |
|------|--------|---------------------------------------------|
| Face | Edge | Select all boundary edges (exclude diagonals) |
| Face | Vertex | Select all vertices (with co-located) |
| Edge | Vertex | Select all endpoints (with co-located) |

**Higher-level conversions (contract):**
| From | To | Behavior |
|--------|------|---------------------------------------------|
| Vertex | Edge | Select edges where BOTH endpoints selected |
| Vertex | Face | Select faces where ALL vertices selected |
| Edge | Face | Select faces where ALL edges selected |

All conversions use position-based matching to handle co-located vertices correctly.

### Edge Key Format

Edges are stored as strings: `"minIndex-maxIndex"`

```typescript
makeEdgeKey(v0: number, v1: number): string {
  return `${Math.min(v0, v1)}-${Math.max(v0, v1)}`;
}
```

This ensures edge (5, 3) and edge (3, 5) produce the same key: `"3-5"`.

---

## Transform System

### The Co-located Vertex Problem

Due to per-face vertex duplication, multiple vertex indices exist at the same position. When transforming, we need to:

1. **Move all co-located vertices together** - otherwise geometry tears apart
2. **NOT include vertices from disconnected geometry** - even if at same/nearby positions

### Two Approaches for Different Scenarios

#### 1. Vertex Mode: `getConnectedColocatedVertices()`

For single vertex transforms, uses **direct edge adjacency**:

1. Find triangles containing source vertices
2. Find triangles sharing geometric edges with source triangles
3. Return co-located vertices only from those adjacent triangles

**Use case:** When user clicks single vertex, only immediately adjacent duplicates should move.

#### 2. Edge/Face Mode: `getColocatedVerticesForPositions()`

For edge/face transforms, uses **full component flood-fill**:

1. Find all triangles in the same connected mesh component (flood-fill via geometric edges)
2. Get all vertices at source positions that are in that component

**Why full flood-fill?** When moving an edge/face, ALL co-located vertices at those positions must move, not just immediately adjacent ones. But we still exclude disconnected geometry.

**Key insight:** Disconnected geometry (like Suzanne's eyes) may share vertex POSITIONS with the main mesh (at eye socket boundary), but they don't share geometric EDGES. The flood-fill stays within the connected component.

### Algorithm: `getColocatedVerticesForPositions()`

```typescript
// 1. Build geometric edge connectivity
// 2. Build triangle adjacency (triangles sharing geometric edges)
// 3. Find triangles containing source vertices
// 4. Flood-fill to find ALL triangles in same component
// 5. Get all vertices in connected component
// 6. Return co-located vertices at source positions, filtered by component membership
```

### Previous Bug: Geometry Tearing

**Symptom:** Moving edge/face would leave holes in mesh
**Cause:** Only checking immediately adjacent triangles, missing co-located vertices from triangles connected via longer paths
**Fix:** Full component flood-fill ensures ALL vertices at source positions (within component) are included

### Previous Bug: Eyes Moving with Head

**Symptom:** Moving head edge/face also moved eye vertices
**Cause:** Using `getColocatedVerticesForPositions()` without component filtering
**Fix:** Added component membership check - only include co-located vertices that are in triangles reachable via geometric edge flood-fill

---

## Select Linked (Ctrl+L)

### Algorithm

1. **Build geometric edge map**: Group triangles by their geometric edge positions (not vertex indices)
2. **Build vertex adjacency graph**:
   - Connect vertices within each triangle
   - Connect vertices across triangles that share a geometric edge
3. **Flood fill** from selected vertices to find all connected vertices
4. **Select geometry** based on mode:
   - Vertex: Select all connected vertices
   - Edge: Select edges where BOTH vertices are in connected set
   - Face: Select faces where ALL THREE vertices are in connected set

### Disconnected Geometry Detection

Two mesh components are "disconnected" if they share no geometric edges. Examples:

- Suzanne's eyes are disconnected from the head
- A mesh with separate islands

The adjacency graph naturally handles this - flood fill won't cross to disconnected components because there are no edges connecting them.

### Edge Case: Eye Socket Boundary

Suzanne's eyes are positioned inside the eye sockets. Some eye vertices may be at NEARLY the same position as head vertices (the socket rim). With the position epsilon (0.0001), these might hash to the same key.

**Current behavior:** These are considered "same position" but NOT topologically connected (no shared geometric edge), so they stay separate during vertex transforms. For edge/face transforms, we don't expand to co-located vertices at all.

---

## View Modes

### Three Shading Modes

| Mode      | Lighting | Textures | Wireframe         |
| --------- | -------- | -------- | ----------------- |
| wireframe | None     | None     | Edges only        |
| solid     | Flat     | None     | Filled triangles  |
| material  | Gouraud  | Yes      | Filled + textured |

### Implementation

```typescript
type ViewMode = "wireframe" | "solid" | "material";

// In render loop:
if (viewMode === "wireframe") {
  // Render edges only, skip triangle rasterization
} else if (viewMode === "solid") {
  // Render with flat shading, no textures
} else {
  // Full material rendering with textures
}
```

### Keyboard: Z cycles modes

### Toolbar: Three buttons (▢ wireframe, ◼ solid, ◉ material)

---

## Deletion System

### Delete Vertices (Vertex Mode)

1. Collect all vertices to delete
2. Find all triangles that use ANY of these vertices
3. Remove those triangles
4. Rebuild mesh (reindex remaining geometry)

### Delete Edges (Edge Mode)

1. For each selected edge, find triangles that contain that edge
2. Remove those triangles
3. Rebuild mesh

### Delete Faces (Face Mode)

1. Remove selected triangles directly
2. Rebuild mesh

### Mesh Rebuilding

After deletion, vertex indices change. The rebuild process:

1. Collect all remaining triangles' vertex indices
2. Create mapping: old index → new index
3. Build new vertices array (only used vertices)
4. Update indices array with new vertex indices
5. Rebuild triangles array from vertices + indices

---

## Primitive Creation (Shift+A Menu)

### Add Menu Component

The Add Menu (`src/components/AddMenu.tsx`) provides Blender-style primitive creation:

- **Trigger:** Shift+A keyboard shortcut
- **Position:** Appears at current mouse cursor position
- **Close:** Click outside, Escape key, or select an item

### Available Primitives

| Primitive | Function                | Structure                           |
| --------- | ----------------------- | ----------------------------------- |
| Plane     | `createPlaneMesh(size)` | 4 vertices, 2 triangles (XZ plane)  |
| Cube      | `createCubeMesh(size)`  | 24 vertices, 12 triangles (6 faces) |

### Mesh Factory Functions (`src/primitives.ts`)

```typescript
// Plane: Single quad on XZ plane at Y=0
createPlaneMesh(size: number = 2): Mesh

// Cube: 6 faces with proper normals (per-face vertex duplication)
createCubeMesh(size: number = 2): Mesh
```

### Object Naming

New objects get unique names with Blender-style numbering:

- First plane: "Plane"
- Second plane: "Plane.001"
- Third plane: "Plane.002"

### Mouse Position Tracking

The InputManager tracks mouse position on every `mousemove` event to ensure the Add Menu appears at the correct cursor position when Shift+A is pressed.

---

## UI Components

### Blender SVG Icons

The project uses official Blender icons from `src/icons/` (~500+ SVG files):

- **Shading modes:** `shading_solid.svg`, `shading_wire.svg`, `shading_texture.svg`
- **Editor modes:** `editmode_hlt.svg`, `object_datamode.svg`
- **Primitives:** `mesh_plane.svg`, `mesh_cube.svg`

Icons are imported as string paths (Bun handles asset copying):

```typescript
import meshCubeIcon from "../icons/mesh_cube.svg";
// Use: <img src={meshCubeIcon} width={16} height={16} />
```

TypeScript declaration (`src/svg.d.ts`):

```typescript
declare module "*.svg" {
  const src: string;
  export default src;
}
```

### Reusable ToolbarButton Component

`src/components/ToolbarButton.tsx` provides consistent button styling:

```typescript
<ToolbarButton
  active={isActive}
  onClick={handler}
  title="Tooltip text"
  icon={iconPath} // Optional SVG icon
  iconAlt="Alt text" // Optional alt text
>
  Button Label // Optional children
</ToolbarButton>
```

---

## Depth-Based Occlusion

### Why Not Normal-Based Backface Culling?

Initially we tried normal-based backface culling for edit mode display:

- A vertex is visible if its normal points toward the camera
- An edge is visible if both vertices' normals point toward camera

**Problem with thin geometry (like Suzanne's ears):**

- Ears have triangles on both front and back sides that share vertices
- A vertex on the back of the ear might also belong to a front-facing triangle
- Normal-based culling fails because vertices have averaged normals that may point "outward" on both sides

### Depth-Based Solution

Instead of using normals, we use the actual Z-buffer from the rendered mesh:

1. After rendering the mesh, the depth buffer contains the depth of the closest surface at each pixel
2. To check if a vertex/edge is visible, we:
   - Transform the world position to screen coordinates
   - Convert depth to 16-bit fixed-point (same as rasterizer)
   - Compare against the depth buffer value at that screen position
   - If the vertex depth is close to or in front of the buffer depth, it's visible

**Implementation:**

```typescript
const isVertexVisible = (worldPos: Vector3): boolean => {
  const viewPos = viewMatrix.transformPoint(worldPos);
  const clipPos = projectionMatrix.transformPoint(viewPos);

  const screenX = (clipPos.x * 0.5 + 0.5) * rasterizer.renderWidth;
  const screenY = (1 - (clipPos.y * 0.5 + 0.5)) * rasterizer.renderHeight;
  const depth = Math.floor((clipPos.z * 0.5 + 0.5) * 65535);

  return rasterizer.isPointVisible(screenX, screenY, depth);
};
```

**Rasterizer method:**

```typescript
isPointVisible(screenX: number, screenY: number, depth: number): boolean {
  // Add small bias to avoid z-fighting
  return depth < this.depthBuffer[index] + 100;
}
```

### Visibility Rules by Mode

- **Vertex mode:** Each vertex is tested individually
- **Edge mode:** Both vertices of edge must be visible
- **Face mode:** Face centroid must be visible

---

## Coordinate Spaces

### Local vs World Space

- Mesh vertices are stored in **local space**
- Transforms (G/R/S) operate in **world space**
- Model matrix converts local → world

```typescript
// Transform workflow:
const modelMatrix = object.getModelMatrix();
const worldPos = modelMatrix.transformPoint(localPos);
// ... apply transform delta in world space ...
const inverseModel = modelMatrix.inverse();
const newLocalPos = inverseModel.transformPoint(newWorldPos);
mesh.vertices[i].position = newLocalPos;
```

### Screen Space Picking

Ray casting for selection:

1. Convert mouse (screenX, screenY) to NDC (-1 to 1)
2. Unproject near and far points using inverse(projection × view)
3. Create ray from near point in direction of (far - near)
4. Intersect with geometry in world space

### Smart Picking (Blender-like Behavior)

When in vertex or edge mode, clicking anywhere on a face selects the closest vertex/edge to the click point, not just elements directly under the cursor. This matches Blender's behavior.

**Algorithm:**

1. Check if click hits a face (get face index and depth)
2. If on a face:
   - Find closest vertex/edge with **depth filtering** (only consider elements in front of or at the clicked face's depth)
   - Return the closest element regardless of screen distance
3. If in empty space:
   - Only select if within pick radius (25px for vertex, 30px for edge)

**Depth Filtering (Critical):**

```typescript
// Get face depth in clip space
const faceResult = this.pickFaceWithDepth(...);
const maxDepth = faceResult.depth + 0.01; // Small tolerance

// Only consider vertices/edges in front of the clicked face
if (screen.z > maxDepth) continue;
```

The depth tolerance (0.01) is kept small to prevent selecting backface elements. Clip space Z ranges from -1 to 1, so 0.01 is tight enough to exclude elements on the back side while allowing elements on the face surface.

**Quad Diagonal Edge Filtering:**

Diagonal edges inside quads must not be pickable. The key format must match `getQuadDiagonalEdges()`:

```typescript
// Position key format (must match primitives.ts)
const epsilon = 0.0001;
const getPosKey = (pos) =>
  `${Math.round(pos.x / epsilon)},${Math.round(pos.y / epsilon)},${Math.round(
    pos.z / epsilon
  )}`;

// Canonical diagonal key (sorted and joined with |)
const diagonalKey = [posKey0, posKey1].sort().join("|");
```

---

## Performance Notes

### Avoid Rebuilding Unnecessarily

- `getMeshEdges()` iterates all triangles - cache if called multiple times
- Position-to-vertex maps can be expensive for large meshes
- Flood fill is O(V + E) where V = vertices, E = edges

### Rendering Optimizations

- Wireframe overlay uses separate vertex/index arrays
- Point rendering for vertices uses small triangles (pseudo-points)
- Z-buffer is 16-bit fixed point (PS1 style)

---

## Common Debugging Tips

### "Geometry is tearing/stretching"

- Check if co-located vertices are being handled correctly
- For edge/face mode: ensure NO co-located expansion
- For vertex mode: check topology-aware expansion

### "Select Linked selects wrong geometry"

- Verify geometric edge detection uses position-based keys
- Check epsilon value consistency
- Ensure adjacency graph connects across shared geometric edges

### "Transform affects unexpected vertices"

- Print `getSelectedVertexIndices()` result
- Check which vertices are at shared positions
- Verify the correct expansion strategy for current selection mode
- For edge/face: ensure using `getColocatedVerticesForPositions()` with component filtering
- For vertex: ensure using `getConnectedColocatedVertices()` with adjacent triangle filtering

### "Deletion leaves orphan vertices"

- Mesh rebuild should handle this, but check index remapping
- Verify triangles array is rebuilt from indices

---

## Input & Focus Management

### Context-Aware Keyboard Shortcuts (Blender-style)

Keyboard shortcuts are only active when the mouse pointer is over the viewport canvas. This allows typing in input fields (properties panel, etc.) without shortcuts being intercepted.

**Implementation:**

```typescript
// Track pointer position
const isPointerOverViewportRef = useRef(false);

// Update on mouse enter/leave viewport
canvas.addEventListener("mouseenter", () => {
  isPointerOverViewportRef.current = true;
});
canvas.addEventListener("mouseleave", () => {
  isPointerOverViewportRef.current = false;
});

// In keyboard handler
const handleKeyDown = (e: KeyboardEvent) => {
  // Skip shortcuts if pointer not over viewport
  // Exceptions: Escape (cancel) and active transforms
  const isEscape = e.key === "Escape";
  const isActiveTransform = editor?.transformMode !== "none";

  if (!isPointerOverViewportRef.current && !isEscape && !isActiveTransform) {
    return; // Let event propagate to input fields
  }
  // ... handle shortcuts
};
```

**Exceptions (always work regardless of pointer position):**

- **Escape key** - Cancel transforms should always work
- **Active transform** - Once G/R/S is started, axis constraints (X/Y/Z) continue to work

**Affected shortcuts:**

- Selection modes: 1, 2, 3
- Transforms: G, R, S
- Axis constraints: X, Y, Z
- View modes: Z
- Viewpoints: 0, 5, 7

---

## Performance Optimizations

### UI Update Throttling

The React UI (properties panel, status bar, scene tree) was updating every frame (~60 times/second), causing unnecessary re-renders.

**Solution:** Throttle `updateUIState()` to run at most every 100ms.

```typescript
// In App.tsx
const lastUIUpdateRef = useRef<number>(0);
const UI_UPDATE_INTERVAL = 100; // ms

// Core implementation
const updateUIStateImpl = useCallback(() => {
  // ... update all React state from editor/scene
}, []);

// Throttled wrapper
const updateUIState = useCallback(
  (force = false) => {
    const now = performance.now();
    if (force || now - lastUIUpdateRef.current >= UI_UPDATE_INTERVAL) {
      lastUIUpdateRef.current = now;
      updateUIStateImpl();
    }
  },
  [updateUIStateImpl]
);
```

**Usage:**

- **Render loop:** `updateUIState()` - throttled, runs every 100ms max
- **User actions:** `updateUIState(true)` - forced immediate update for responsiveness

**When to force update:**

- Mode changes (object/edit, selection mode, view mode)
- Object selection from scene tree
- Visibility toggles
- Property panel changes
- Keyboard shortcuts (Z for view mode cycling)

---

## Future Considerations

### Extrude Faces

Will need to:

1. Duplicate face vertices
2. Create side faces connecting original and new vertices
3. Handle co-located vertices at extrusion boundaries

### Loop Cut

Will need to:

1. Use existing edge loop detection from `SelectionManager.findEdgeLoop()`
2. Split edges and faces along the loop
3. Maintain proper vertex indexing

---

## Edge Loop & Ring Selection

### Edge Loop (Alt+click)

Selects a sequence of edges that continue "straight through" vertices.

**Algorithm:**

1. At each vertex, find edges that do NOT share any face with the current edge
2. These are the "continuation" edges that go straight through
3. Only continue if there's exactly ONE such candidate (unambiguous path)
4. Stop at vertices with 0 or 2+ candidates (corners, mesh boundaries, irregular topology)

**Implementation:** `SelectionManager.findEdgeLoop()` and `selectEdgeLoop()`

**Why it stops:**

- 0 candidates: boundary edge, nowhere to go
- 2+ candidates: ambiguous vertex (e.g., more than 4 faces meeting), user must choose

### Edge Ring (Ctrl+Alt+click)

Selects edges that are opposite to each other across quad faces.

**Algorithm:**

1. For each quad face the current edge belongs to, find the "opposite" edge (2 positions away in the quad's edge list)
2. Continue through all connected quads in both directions
3. Stop at non-quad faces (triangles) or mesh boundaries

**Implementation:** `SelectionManager.findEdgeRing()` and `selectEdgeRing()`

### Vertex Mode Support

Both edge loop and ring work in vertex mode:

- `selectEdgeLoopFromVertex()` / `selectEdgeRingFromVertex()`
- Direction is determined by mouse position relative to the clicked vertex
- `findEdgeInDirection()` finds the edge closest to the mouse direction

### Position-Based Edge Keys

Both algorithms use position-based edge keys (not vertex indices) to handle co-located vertices:

```typescript
const epsilon = 0.0001;
const getPosKey = (pos) =>
  `${Math.round(pos.x / epsilon)},${Math.round(pos.y / epsilon)},${Math.round(
    pos.z / epsilon
  )}`;
const edgeKey = p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;
```

This ensures the algorithms work correctly with per-face vertex duplication.

---

## Box Selection (Object Mode)

### Implementation

Box selection allows selecting multiple objects by click+dragging a rectangle in the viewport.

**Location:** `PickingManager.boxSelectObjects()` in `src/systems/picking.ts`

**Algorithm:**

1. When mouse down, record start position
2. On mouse move, check if drag distance exceeds 5px threshold (prevents accidental box select)
3. Draw selection box visually (canvas overlay)
4. On mouse up, test each object's screen-space center against the box bounds
5. Select all objects whose center falls within the box

**Usage in App.tsx:**

```typescript
const selectedObjects = editor.boxSelectObjects(boxStart, boxEnd);
if (selectedObjects.length > 0) {
  // First object becomes active
  scene.selectObject(selectedObjects[0]);
  // Rest are added to selection
  for (let i = 1; i < selectedObjects.length; i++) {
    selectedObjects[i].selected = true;
  }
}
```

---

## Scene Tree Multi-Select

### Shift+Click (Range Selection)

Selects all objects between the last clicked object and the current object.

**Implementation:**

1. Track `lastSelectedRef` to remember previous selection
2. On shift+click, find indices of both objects in `scene.objects` array
3. Select all objects in that index range

### Ctrl/Cmd+Click (Toggle Selection)

Toggles selection of individual objects without affecting others.

**Implementation:**

1. On Ctrl+click (or Cmd+click on macOS), toggle `obj.selected`
2. If toggling on, make it the active object
3. If toggling off and it was active, find another selected object to be active

**Location:** `handleSelectObject()` in `App.tsx` with `SelectionModifiers` interface

---

## Per-Object Textures

### Problem

Previously, loading an OBJ with a texture would apply that texture to ALL objects, including primitives added later.

### Solution

Textures are now assigned per-object via `SceneObject.texture` property.

**Key Files:**

- `src/scene.ts`: `SceneObject.texture: ImageData | null`
- `src/systems/worker-render-loop.ts`: Sets `hasTexture: !!obj.texture` in `RenderObject`
- `src/render-worker.ts`: `RenderObject.hasTexture` flag controls texturing per-object

**Texture Assignment:**

- OBJ import: texture assigned to imported object only
- Primitives: no texture by default
- Duplicate (Shift+D): copies texture from source object

```typescript
// In editor.ts duplicateSelected()
newObj.texture = obj.texture;
```

---

## Primitive Mesh Creation

### Available Primitives

| Primitive  | Function                | Parameters                                 |
| ---------- | ----------------------- | ------------------------------------------ |
| Cube       | `createCubeMesh()`      | size                                       |
| Plane      | `createPlaneMesh()`     | size                                       |
| UV Sphere  | `createUVSphereMesh()`  | radius, segments, rings                    |
| Ico Sphere | `createIcoSphereMesh()` | radius, subdivisions                       |
| Cylinder   | `createCylinderMesh()`  | radius, depth, vertices                    |
| Cone       | `createConeMesh()`      | radius1, radius2, depth, vertices          |
| Torus      | `createTorusMesh()`     | majorRadius, minorRadius, majSegs, minSegs |

### PrimitiveSettings Modal

Located in `src/components/PrimitiveSettings.tsx`.

**Features:**

- Shows immediately after adding a primitive (bottom-left corner)
- Allows modifying parameters before confirming
- Re-creates mesh when parameters change
- Keyboard events use `e.stopPropagation()` to prevent viewport shortcuts

**State Management:**

```typescript
interface PrimitiveSettings {
  type:
    | "cube"
    | "plane"
    | "uv-sphere"
    | "ico-sphere"
    | "cylinder"
    | "cone"
    | "torus";
  size?: number;
  segments?: number;
  rings?: number;
  // ... other type-specific settings
}
```

---

## Face Extrusion

### Implementation

Located in `MeshEditManager.extrudeFaces()` in `src/systems/mesh-edit.ts`.

**Algorithm:**

1. For each selected face, duplicate all vertices offset by face normal
2. Create side faces connecting original and extruded vertices
3. Update original face to use new (extruded) vertices
4. Track which faces are "top" faces (the extruded originals)
5. Return only top face indices for selection

**Key Insight:** After extrusion, only the top faces should be selected (not the side faces). This matches Blender behavior and allows immediate grab to move extruded region.

```typescript
// Return only top faces for selection
return {
  success: true,
  topFaceIndices: newTopFaceIndices, // NOT all newFaceIndices
  // ...
};
```

---

## Workspace System

### Overview

Workspaces allow switching between different editor layouts/contexts (like Blender).

**Current Workspaces:**

- **Modeling** (default): Full 3D editing environment
- **Shading**: Placeholder for material/shader editing

**Components:**

- `WorkspaceTabs.tsx`: Tab buttons in toolbar
- `WorkspaceType`: `"modeling" | "shading"`

### UI Layout

The current layout uses CSS Grid with a right sidebar:

```css
.editor-container {
  display: grid;
  grid-template-columns: 1fr 220px;
  grid-template-rows: auto 1fr auto;
}

.sidebar {
  display: flex;
  flex-direction: column;
  /* Contains SceneTree + PropertiesPanel */
}
```

---

## Material System

### Overview

Node-based material system inspired by Blender's shader nodes. Materials are compiled to bytecode and evaluated via WASM with SIMD acceleration.

### Data Structures

```typescript
interface Material {
  id: string;
  name: string;
  nodes: MaterialNode[];
  connections: Connection[];
}

interface MaterialNode {
  id: string;
  type: "output" | "texture" | "flat-color" | "mix" | "color-ramp" | "voronoi";
  position: { x: number; y: number };
  inputs: Socket[];
  outputs: Socket[];
  data?: Record<string, any>; // Node-specific data
}

interface Connection {
  id: string;
  fromNodeId: string;
  fromSocketId: string;
  toNodeId: string;
  toSocketId: string;
}
```

### Node Types

| Node       | Inputs                 | Outputs | Description                           |
| ---------- | ---------------------- | ------- | ------------------------------------- |
| Output     | Color                  | -       | Final material color                  |
| Texture    | -                      | Color   | UV-mapped texture                     |
| Flat Color | -                      | Color   | Solid color picker                    |
| Mix        | Color1, Color2, Factor | Color   | Blends two colors                     |
| Color Ramp | Factor                 | Color   | Gradient with draggable stops         |
| Voronoi    | -                      | Float   | Cell noise (F1 distance or Edge mode) |

### WASM Material Baking

Material node graphs are compiled to bytecode and executed in WASM with SIMD:

**Bytecode Opcodes:**

```
BAKE_OP_FLAT_COLOR     = 0   // R, G, B, A bytes follow
BAKE_OP_SAMPLE_TEXTURE = 1   // Texture slot byte follows
BAKE_OP_MIX_MULTIPLY   = 2   // Factor byte follows (0-255)
BAKE_OP_MIX_ADD        = 3   // Factor byte follows
BAKE_OP_MIX_LERP       = 4   // Factor byte follows
BAKE_OP_COLOR_RAMP     = 5   // Uses color ramp buffer
BAKE_OP_VORONOI        = 6   // Scale byte (1-255), Mode byte (0=F1, 1=Edge)
BAKE_OP_END            = 255 // End of program
```

**Texture Slots:**

- Slot 0: Frame rendering texture
- Slot 1: Bake output texture
- Slot 2: Bake source texture (for texture nodes)

**SIMD Optimization:**

- Processes 4 pixels per iteration using v128_t registers
- Separate RGBA channel vectors for parallel operations
- ~4x speedup over scalar implementation

**JS Fallback Evaluator:**
A simplified JS evaluator exists for vertex color generation (single-point evaluation at UV 0,0):

- `flat-color`: Returns actual color
- `mix`: Evaluates inputs for flat-color chains
- Other nodes: Return neutral gray (need WASM baking for proper results)

### Shader Node Editor (`NodeEditor.tsx`)

Canvas-based visual editor with:

- Pan/zoom (scroll wheel, middle-mouse drag)
- Zoom relative to mouse position
- Node creation via context menu (Shift+A or right-click)
- Drag node onto connection to auto-insert
- Connection hit detection using `distanceToBezier()`
- Per-material undo/redo via `GenericHistoryStack<ShaderEditorState>`
- Stack ID: `shader-editor:${materialId}`

---

## Development Notes

**REMINDER:** After completing a task successfully, always update:

- `PLAN.md` - Mark completed items, add new items if scope changed
- `KNOWLEDGE.md` - Document any non-obvious implementation details, bugs fixed, or lessons learned

This helps maintain project continuity and prevents re-discovering the same issues.
