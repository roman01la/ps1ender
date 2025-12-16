# PS1ender - PS1-Style 3D Graphics Editor

## Overview

A Blender-inspired 3D graphics editor with PS1-style rendering. Built with a custom software rasterizer using Canvas 2D API.

---

## Completed: Software Rasterizer ✅

- [x] Vector3, Vector4, Matrix4 math utilities
- [x] Triangle rasterization with barycentric coordinates
- [x] Z-buffer depth testing (16-bit fixed-point, PS1 style)
- [x] Gouraud shading (per-vertex lighting)
- [x] PS1 effects: dithering, vertex snapping, affine texture mapping
- [x] OBJ/MTL file loading with textures
- [x] Near-plane clipping (PS1 style - reject crossing triangles)
- [x] Optimized rendering (~1ms per frame)

---

## Phase 1: Basic Editor Framework ✅

### 1.1 Editor Modes

- [x] Object Mode - Select and transform whole objects
- [x] Edit Mode - Select and modify vertices (Tab to toggle)

### 1.2 Selection System

- [x] Click to select objects
- [x] Ray casting for accurate picking (Ray-AABB intersection)
- [x] Visual selection highlight (color change)
- [x] Box selection in object mode (click+drag with 5px threshold)
- [x] Multi-select in scene tree (Shift+click for range, Ctrl/Cmd+click for toggle)

### 1.3 Transform Gizmos

- [x] Move gizmo (translate X/Y/Z axes)
- [x] Rotate gizmo
- [x] Scale gizmo
- [x] Keyboard shortcuts: G (grab/move), R (rotate), S (scale)
- [x] Axis constraints: X, Y, Z keys
- [x] Confirm/cancel: Enter/Escape

### 1.4 Grid & Viewport

- [x] Infinite ground grid
- [x] Axis indicator (RGB = XYZ) - via gizmo
- [x] Orthographic view option (1/3/7 for Front/Right/Top, 5 to toggle, 0 for Persp)
- [x] Viewport shading modes (Z key to cycle, toolbar buttons):
  - Wireframe - edges only, no shading
  - Solid - flat shading, no textures
  - Material Preview - textured with lighting

### 1.5 Status Bar

- [x] Status bar showing current mode/selection
- [x] Instructions panel with keyboard shortcuts

### 1.6 UI Layout ✅

- [x] Toolbar with mode switching and transform tools
- [x] Workspace tabs (Modeling/Shading) in toolbar
- [x] Scene tree panel in right sidebar - object list with visibility toggle
- [x] Properties panel in right sidebar - position, rotation, scale editing
- [x] Status bar (bottom) - mode, selection info, FPS
- [x] Resizable viewport with PS1-style rendering

---

## Phase 2: Basic Mesh Editing ✅

### 2.1 Vertex Editing

- [x] Select vertices (click with co-located vertex merging)
- [x] Move vertices (G key)
- [x] Rotate vertices (R key)
- [x] Scale vertices (S key)
- [x] Depth-based occlusion for edit mode display (uses Z-buffer)
- [x] Wireframe overlay in vertex mode
- [ ] Box select (B key)
- [ ] Snap to grid

### 2.2 Edge/Face Selection Modes ✅

- [x] Selection mode switching (1/2/3 keys for vertex/edge/face)
- [x] Edge picking and selection
- [x] Face picking and selection
- [x] Transforms (G/R/S) for edges and faces
- [x] Depth-based occlusion in all edit modes
- [x] Wireframe overlay in all modes
- [x] Select Linked (Ctrl+L) - select connected geometry components
- [x] Topology-aware transforms (disconnected geometry stays separate)
- [x] Selection preserved when switching modes (Blender behavior)
- [x] Selected face highlight with transparent orange fill
- [x] Smart picking (Blender-like) - clicking on face selects closest vertex/edge with depth filtering
- [x] Edge loop selection (Alt+click) - selects connected edges through vertices
- [x] Edge ring selection (Ctrl+Alt+click) - selects opposite edges across quads

### 2.3 Primitive Creation ✅

- [x] Add Cube (Shift+A menu)
- [x] Add Plane (Shift+A menu)
- [x] Add UV Sphere (with segments/rings settings)
- [x] Add Ico Sphere (with subdivisions setting)
- [x] Add Cylinder (with vertices/depth settings)
- [x] Add Cone (with vertices/radius/depth settings)
- [x] Add Torus (with major/minor segments/radius settings)
- [x] PrimitiveSettings modal for configuring primitive parameters

### 2.4 Basic Operations ✅

- [x] Delete selected (X or Delete key - vertices/edges/faces in edit mode, objects in object mode)
- [x] Extrude edges (E key in edge mode) - creates quad ribbon and starts grab
- [x] Extrude faces (E key in face mode) - extrudes selected faces, selects only top faces
- [x] Fill edges (F key in edge mode) - creates face from 2+ selected edges
- [x] Join vertices (F key in vertex mode with 2 vertices) - creates edge
- [x] Fill vertices (F key in vertex mode with 3+ vertices) - creates face
- [x] Duplicate objects (Shift+D) - preserves texture assignment
- [x] Undo/Redo system (Ctrl+Z / Ctrl+Shift+Z)
- [x] Selection changes in undo stack (both object and edit modes)
- [x] Mode changes in undo stack (Tab key)

### 2.5 BMesh-Style Face-Based Architecture

- [x] `Face` interface: `{ vertices: number[], material?: number }`
- [x] `faceData: Face[]` as primary topology storage (supports quads, tris, n-gons)
- [x] `rebuildFromFaces()` generates indices from faceData using fan triangulation
- [x] `extractQuadVertices()` preserves winding order when extracting quads
- [x] Face selection mode shows quads, not individual triangles
- [x] Edge mode hides internal quad diagonal edges
- [x] Vertex wireframe hides internal quad diagonals
- [x] Fill operations create faces via faceData (preserves topology)
- [x] Extrude operations add quads to faceData with correct winding

### 2.6 Texture System ✅

- [x] Per-object texture assignment (SceneObject.texture property)
- [x] RenderObject.hasTexture flag for selective texturing
- [x] OBJ-imported textures don't bleed to primitives
- [x] Texture preserved when duplicating objects

---

## Phase 3: Shading Workspace ✅

### 3.1 Material System ✅

- [x] Material data structure (nodes, connections)
- [x] Material registry (create, get, list, delete)
- [x] Per-object material assignment
- [x] Material baking to texture (evaluates node graph)
- [x] Bake caching with hash-based invalidation
- [x] WASM-accelerated material baking with SIMD (4 pixels/iteration)
- [x] Bytecode compiler for node graphs → WASM interpreter

### 3.2 Node Editor ✅

- [x] Canvas-based node editor with pan/zoom
- [x] Zoom relative to mouse pointer position
- [x] Node types: Output, Texture, Flat Color, Mix, Color Ramp, Voronoi
- [x] Socket types: Color, Float (with color→float implicit conversion)
- [x] Bezier curve connections between nodes
- [x] Drag-and-drop node onto connection (auto-insert)
- [x] Color Ramp with draggable color stops
- [x] Voronoi with scale setting and mode (F1 distance / Edge)
- [x] Context menu (right-click or Shift+A)
- [x] Node deletion (X or Delete)
- [x] Undo/redo (Cmd+Z / Cmd+Shift+Z)

### 3.3 Unified History System ✅

- [x] Generic history stack (`GenericHistoryStack<T>`)
- [x] Multi-stack history manager (`historyManager`)
- [x] Stack registration for different editors
- [x] 3D editor uses action-based history (efficient deltas)
- [x] Shader editor uses state-snapshot history (per-material)
- [x] History persists across workspace switches

---

## Phase 4: Advanced Features (Future)

- [ ] Loop cut
- [ ] Subdivide
- [ ] Box select in edit mode (B key)
- [ ] Export OBJ
- [ ] Hierarchy/parenting
- [ ] Proportional editing

---

## UI Layout (Current)

```
+----------------------------------------------------+
| [Workspace Tabs] | Mode | Add | Transform tools    |
+---------------+---------------------------+--------+
|               |                           | Scene  |
|               |      3D Viewport          | Tree   |
|               |                           +--------+
|               |                           | Props  |
|               |                           | Panel  |
+---------------+---------------------------+--------+
|  Status bar / coordinates / FPS                    |
+----------------------------------------------------+
```

---

## Tech Stack

- **React** - UI components
- **TypeScript** - Type safety
- **Canvas 2D** - Software rasterizer (no WebGL)
- **Bun** - Build tool
