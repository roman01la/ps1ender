import { Vector3, Matrix4, Ray, Color } from "./math";
import { Scene, SceneObject, Camera } from "./scene";
import { Vertex, Mesh } from "./primitives";
import { Rasterizer } from "./rasterizer";
import {
  History,
  HistoryAction,
  ObjectTransformState,
  VertexMoveState,
  SelectionHistoryState,
  ModeChangeState,
  serializeMesh,
  deserializeMesh,
} from "./systems/history";
import {
  SelectionManager,
  SelectionMode as SelectionModeType,
  Edge,
} from "./systems/selection";
import {
  TransformManager,
  TransformMode as TransformModeType,
  AxisConstraint as AxisConstraintType,
  AxisSpace as AxisSpaceType,
} from "./systems/transform";
import { MeshEditManager } from "./systems/mesh-edit";
import { getPositionKey } from "./utils/geometry";
import { PickingManager, PickContext } from "./systems/picking";
import {
  VisualizationManager,
  VisualizationContext,
  GizmoData,
  VertexPointData,
  LineData,
} from "./systems/visualization";

/**
 * Editor modes
 */
export type EditorMode = "object" | "edit";

/**
 * Selection modes for Edit mode (like Blender's 1/2/3 keys)
 * Re-exported from selection system for backward compatibility
 */
export type SelectionMode = SelectionModeType;

/**
 * Viewport shading modes (like Blender's Z menu)
 */
export type ViewMode = "wireframe" | "solid" | "material";

/**
 * Transform modes
 * Re-exported from transform system for backward compatibility
 */
export type TransformMode = TransformModeType;

/**
 * Axis constraint for transforms
 * Re-exported from transform system for backward compatibility
 */
export type AxisConstraint = AxisConstraintType;

/**
 * Axis space for transforms (world or local)
 * Re-exported from transform system
 */
export type AxisSpace = AxisSpaceType;

// Edge type is now imported from selection system and re-exported
export type { Edge } from "./systems/selection";

// Re-export visualization types from visualization system
export type {
  GizmoData,
  VertexPointData,
  LineData,
} from "./systems/visualization";

/**
 * Editor state and tools
 */
export class Editor {
  public mode: EditorMode = "object";
  public viewMode: ViewMode = "solid";

  // Selection manager (handles vertex/edge/face selection)
  private selection: SelectionManager = new SelectionManager();

  // Transform manager (handles G/R/S transforms)
  private transform: TransformManager = new TransformManager();

  // Mesh edit manager (handles delete operations)
  private meshEdit: MeshEditManager = new MeshEditManager();

  // Picking manager (handles raycasting and element picking)
  private picking: PickingManager = new PickingManager();

  // Visualization manager (handles edit mode visualization data)
  private visualization: VisualizationManager = new VisualizationManager();

  // Backward-compatible getters for selection state
  get selectionMode(): SelectionMode {
    return this.selection.mode;
  }
  set selectionMode(mode: SelectionMode) {
    const selected = this.scene.getSelectedObjects();
    const mesh = selected.length > 0 ? selected[0].mesh : undefined;
    this.selection.setMode(mode, mesh);
  }
  get selectedVertices(): ReadonlySet<number> {
    return this.selection.selectedVertices;
  }
  get selectedEdges(): ReadonlySet<string> {
    return this.selection.selectedEdges;
  }
  get selectedFaces(): ReadonlySet<number> {
    return this.selection.selectedFaces;
  }

  // Backward-compatible getters for transform state
  get transformMode(): TransformMode {
    return this.transform.mode;
  }
  get axisConstraint(): AxisConstraint {
    return this.transform.axisConstraint;
  }
  get axisSpace(): AxisSpace {
    return this.transform.axisSpace;
  }

  // History system (undo/redo)
  public history: History = new History(50);

  // Gizmo settings
  public gizmoSize: number = 1.5;
  public showGizmo: boolean = true;

  // Vertex display settings
  public vertexSize: number = 4; // Size in pixels
  public vertexPickRadius: number = 10; // Pick radius in pixels

  constructor(public scene: Scene) {}

  /**
   * Create a canonical edge key (sorted vertex indices)
   * Delegates to SelectionManager
   */
  private makeEdgeKey(v0: number, v1: number): string {
    return this.selection.makeEdgeKey(v0, v1);
  }

  /**
   * Parse an edge key back to vertex indices
   * Delegates to SelectionManager
   */
  private parseEdgeKey(key: string): [number, number] {
    return this.selection.parseEdgeKey(key);
  }

  /**
   * Get all unique edges from a mesh
   * Delegates to SelectionManager
   */
  getMeshEdges(mesh: Mesh): Edge[] {
    return this.selection.getMeshEdges(mesh);
  }

  /**
   * Record an object addition to the history stack (for undo support)
   */
  recordObjectAdd(obj: SceneObject): void {
    this.pushHistoryAction({
      type: "object-add",
      description: `Add ${obj.name}`,
      objectData: {
        name: obj.name,
        meshData: serializeMesh(obj.mesh),
        position: obj.position.clone(),
        rotation: obj.rotation.clone(),
        scale: obj.scale.clone(),
      },
    });
  }

  /**
   * Get current selection state for history tracking
   */
  getSelectionState(): SelectionHistoryState {
    const selectedObjectNames = this.scene.objects
      .filter((o) => o.selected)
      .map((o) => o.name);

    // Only capture edit mode selection if in edit mode
    let editModeSelection: SelectionHistoryState["editModeSelection"];
    if (this.mode === "edit") {
      const selected = this.scene.getSelectedObjects();
      if (selected.length > 0) {
        editModeSelection = {
          objectName: selected[0].name,
          mode: this.selection.mode,
          vertices: [...this.selection.selectedVertices],
          edges: [...this.selection.selectedEdges],
          faces: [...this.selection.selectedFaces],
        };
      }
    }

    return { selectedObjectNames, editModeSelection };
  }

  /**
   * Get current mode state for history tracking
   */
  getModeState(): ModeChangeState {
    return {
      mode: this.mode,
      selection: this.getSelectionState(),
    };
  }

  /**
   * Record a selection change to the history stack
   */
  recordSelectionChange(
    before: SelectionHistoryState,
    after: SelectionHistoryState,
    description: string
  ): void {
    // Don't record if nothing changed
    const sameObjects =
      before.selectedObjectNames.length === after.selectedObjectNames.length &&
      before.selectedObjectNames.every((n) =>
        after.selectedObjectNames.includes(n)
      );
    const sameEditSelection =
      JSON.stringify(before.editModeSelection) ===
      JSON.stringify(after.editModeSelection);

    if (sameObjects && sameEditSelection) return;

    this.pushHistoryAction({
      type: "selection-change",
      description,
      selectionChange: { before, after },
    });
  }

  /**
   * Push an action to the history (undo stack)
   */
  private pushHistoryAction(action: HistoryAction): void {
    this.history.push(action);
  }

  /**
   * Undo the last action
   */
  undo(): boolean {
    const action = this.history.popUndo();
    if (!action) return false;

    this.applyHistoryAction(action, true);
    return true;
  }

  /**
   * Redo the last undone action
   */
  redo(): boolean {
    const action = this.history.popRedo();
    if (!action) return false;

    this.applyHistoryAction(action, false);
    return true;
  }

  /**
   * Apply a history action (undo=true) or redo it (undo=false)
   */
  private applyHistoryAction(action: HistoryAction, undo: boolean): void {
    switch (action.type) {
      case "object-transform":
        if (action.objectTransform) {
          const state = undo
            ? action.objectTransform.before
            : action.objectTransform.after;
          const obj = this.scene.objects.find(
            (o) => o.name === state.objectName
          );
          if (obj) {
            obj.position = state.position.clone();
            obj.rotation = state.rotation.clone();
            obj.scale = state.scale.clone();
          }
        }
        break;

      case "multi-object-transform":
        if (action.multiObjectTransform) {
          for (const objData of action.multiObjectTransform.objects) {
            const state = undo ? objData.before : objData.after;
            const obj = this.scene.objects.find(
              (o) => o.name === state.objectName
            );
            if (obj) {
              obj.position = state.position.clone();
              obj.rotation = state.rotation.clone();
              obj.scale = state.scale.clone();
            }
          }
        }
        break;

      case "vertex-move":
        if (action.vertexMove) {
          const state = undo
            ? action.vertexMove.before
            : action.vertexMove.after;
          const obj = this.scene.objects.find(
            (o) => o.name === state.objectName
          );
          if (obj) {
            for (const [idx, pos] of state.vertices) {
              if (idx < obj.mesh.vertices.length) {
                obj.mesh.vertices[idx].position = pos.clone();
              }
            }
            obj.mesh.rebuildTriangles();
          }
        }
        break;

      case "object-add":
        if (action.objectData) {
          if (undo) {
            // Remove the object
            const obj = this.scene.objects.find(
              (o) => o.name === action.objectData!.name
            );
            if (obj) {
              this.scene.removeObject(obj);
            }
          } else {
            // Re-add the object
            const mesh = deserializeMesh(action.objectData.meshData);
            const obj = new SceneObject(action.objectData.name, mesh);
            obj.position = action.objectData.position.clone();
            obj.rotation = action.objectData.rotation.clone();
            obj.scale = action.objectData.scale.clone();
            this.scene.addObject(obj);
          }
        }
        break;

      case "object-delete":
        if (action.objectData) {
          if (undo) {
            // Re-add the object
            const mesh = deserializeMesh(action.objectData.meshData);
            const obj = new SceneObject(action.objectData.name, mesh);
            obj.position = action.objectData.position.clone();
            obj.rotation = action.objectData.rotation.clone();
            obj.scale = action.objectData.scale.clone();
            this.scene.addObject(obj);
          } else {
            // Remove the object again
            const obj = this.scene.objects.find(
              (o) => o.name === action.objectData!.name
            );
            if (obj) {
              this.scene.removeObject(obj);
            }
          }
        }
        break;

      case "mesh-edit":
        if (action.meshEdit) {
          const meshData = undo
            ? action.meshEdit.before
            : action.meshEdit.after;
          const obj = this.scene.objects.find(
            (o) => o.name === action.meshEdit!.objectName
          );
          if (obj) {
            // Replace the mesh entirely
            const newMesh = deserializeMesh(meshData);
            obj.mesh = newMesh;
            // Clear selections since indices have changed
            this.clearEditSelections();
          }
        }
        break;

      case "selection-change":
        if (action.selectionChange) {
          const state = undo
            ? action.selectionChange.before
            : action.selectionChange.after;

          // Restore object selection
          this.scene.deselectAll();
          for (const name of state.selectedObjectNames) {
            const obj = this.scene.objects.find((o) => o.name === name);
            if (obj) {
              obj.selected = true;
            }
          }

          // Restore edit mode selection if present
          if (state.editModeSelection) {
            this.selection.setMode(state.editModeSelection.mode);
            this.selection.setVertices(state.editModeSelection.vertices);
            this.selection.setEdges(state.editModeSelection.edges);
            this.selection.setFaces(state.editModeSelection.faces);
          } else {
            this.clearEditSelections();
          }
        }
        break;

      case "mode-change":
        if (action.modeChange) {
          const state = undo
            ? action.modeChange.before
            : action.modeChange.after;

          // Restore the mode
          this.mode = state.mode;

          // Restore object selection
          this.scene.deselectAll();
          for (const name of state.selection.selectedObjectNames) {
            const obj = this.scene.objects.find((o) => o.name === name);
            if (obj) {
              obj.selected = true;
            }
          }

          // Restore edit mode selection if present
          if (state.selection.editModeSelection) {
            this.selection.setMode(state.selection.editModeSelection.mode);
            this.selection.setVertices(
              state.selection.editModeSelection.vertices
            );
            this.selection.setEdges(state.selection.editModeSelection.edges);
            this.selection.setFaces(state.selection.editModeSelection.faces);
          } else {
            this.clearEditSelections();
          }
        }
        break;
    }
  }

  /**
   * Get undo/redo status for UI
   */
  getUndoRedoStatus(): {
    canUndo: boolean;
    canRedo: boolean;
    undoDesc: string;
    redoDesc: string;
  } {
    return this.history.getStatus();
  }

  /**
   * Create a ray from screen coordinates
   */
  screenToRay(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ): Ray {
    return this.picking.screenToRay(screenX, screenY, {
      camera: this.scene.camera,
      canvasWidth,
      canvasHeight,
    });
  }

  /**
   * Pick object at screen position
   */
  pickObject(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ): SceneObject | null {
    return this.picking.pickObject(screenX, screenY, this.scene.objects, {
      camera: this.scene.camera,
      canvasWidth,
      canvasHeight,
    });
  }

  /**
   * Toggle between Object and Edit mode
   */
  toggleMode(): void {
    const before = this.getModeState();

    if (this.mode === "object") {
      // Can only enter Edit mode with a selected object
      const selected = this.scene.getSelectedObjects();
      if (selected.length > 0) {
        this.mode = "edit";
        this.clearEditSelections();
      }
    } else {
      this.mode = "object";
      this.clearEditSelections();
    }

    const after = this.getModeState();

    // Only record if mode actually changed
    if (before.mode !== after.mode) {
      this.pushHistoryAction({
        type: "mode-change",
        description: `Switch to ${
          after.mode === "edit" ? "Edit" : "Object"
        } mode`,
        modeChange: { before, after },
      });
    }

    // Cancel any active transform
    if (this.transformMode !== "none") {
      this.cancelTransform();
    }
  }

  /**
   * Set editor mode directly
   */
  setMode(mode: EditorMode): void {
    if (mode === this.mode) return;

    const before = this.getModeState();

    if (mode === "edit") {
      // Can only enter Edit mode with a selected object
      const selected = this.scene.getSelectedObjects();
      if (selected.length > 0) {
        this.mode = "edit";
        this.clearEditSelections();
      }
    } else {
      this.mode = "object";
      this.clearEditSelections();
    }

    const after = this.getModeState();

    // Only record if mode actually changed
    if (before.mode !== after.mode) {
      this.pushHistoryAction({
        type: "mode-change",
        description: `Switch to ${
          after.mode === "edit" ? "Edit" : "Object"
        } mode`,
        modeChange: { before, after },
      });
    }

    // Cancel any active transform
    if (this.transformMode !== "none") {
      this.cancelTransform();
    }
  }

  /**
   * Project a 3D point to screen coordinates
   */
  projectToScreen(
    point: Vector3,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number; z: number } | null {
    return this.picking.projectToScreen(point, {
      camera: this.scene.camera,
      canvasWidth,
      canvasHeight,
    });
  }

  /**
   * Pick vertex at screen position (Edit mode)
   * Uses smart picking that prefers vertices even when clicking on faces
   */
  pickVertex(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ): number | null {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    return this.picking.pickVertexSmart(
      screenX,
      screenY,
      obj.mesh,
      obj.getModelMatrix(),
      {
        camera: this.scene.camera,
        canvasWidth,
        canvasHeight,
      }
    );
  }

  /**
   * Find all vertices at the same position as the given vertex (co-located vertices)
   * This handles meshes where vertices are duplicated per-face for normals/UVs
   */
  getColocatedVertices(vertexIdx: number): number[] {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return [vertexIdx];

    return this.picking.getColocatedVertices(selected[0].mesh, vertexIdx);
  }

  /**
   * Handle click for selection
   */
  handleClick(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    shiftKey: boolean,
    altKey: boolean = false,
    ctrlKey: boolean = false
  ): void {
    if (this.transformMode !== "none") {
      // Confirm transform
      this.confirmTransform();
      return;
    }

    // Capture selection state before the click
    const before = this.getSelectionState();

    if (this.mode === "edit") {
      // Edit mode: select based on current selection mode
      if (this.selectionMode === "vertex") {
        this.handleVertexClick(
          screenX,
          screenY,
          canvasWidth,
          canvasHeight,
          shiftKey,
          altKey,
          ctrlKey
        );
      } else if (this.selectionMode === "edge") {
        this.handleEdgeClick(
          screenX,
          screenY,
          canvasWidth,
          canvasHeight,
          shiftKey,
          altKey,
          ctrlKey
        );
      } else if (this.selectionMode === "face") {
        this.handleFaceClick(
          screenX,
          screenY,
          canvasWidth,
          canvasHeight,
          shiftKey
        );
      }
    } else {
      // Object mode: select objects
      const obj = this.pickObject(screenX, screenY, canvasWidth, canvasHeight);
      this.scene.selectObject(obj, shiftKey);
    }

    // Capture selection state after the click and record if changed
    const after = this.getSelectionState();
    this.recordSelectionChange(before, after, "Select");
  }

  /**
   * Handle vertex selection click
   */
  private handleVertexClick(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    shiftKey: boolean,
    altKey: boolean = false,
    ctrlKey: boolean = false
  ): void {
    const vertexIdx = this.pickVertex(
      screenX,
      screenY,
      canvasWidth,
      canvasHeight
    );

    if (vertexIdx !== null) {
      const selected = this.scene.getSelectedObjects();
      if (selected.length === 0) return;
      const obj = selected[0];

      if (altKey) {
        // Edge loop or ring selection - find direction based on mouse position
        const ctx = {
          camera: this.scene.camera,
          canvasWidth,
          canvasHeight,
        };

        // Project vertex to screen
        const vertexScreen = this.picking.projectToScreen(
          obj
            .getModelMatrix()
            .transformPoint(obj.mesh.vertices[vertexIdx].position),
          ctx
        );

        if (vertexScreen) {
          // Find edge in direction of mouse
          const directionEdge = this.selection.findEdgeInDirection(
            obj.mesh,
            vertexIdx,
            screenX,
            screenY,
            vertexScreen.x,
            vertexScreen.y,
            (vIdx: number) => {
              const worldPos = obj
                .getModelMatrix()
                .transformPoint(obj.mesh.vertices[vIdx].position);
              return this.picking.projectToScreen(worldPos, ctx);
            }
          );

          if (directionEdge) {
            if (ctrlKey) {
              // Ctrl+Alt: Edge ring
              this.selection.selectEdgeRingFromVertex(
                obj.mesh,
                vertexIdx,
                directionEdge,
                shiftKey
              );
            } else {
              // Alt only: Edge loop
              this.selection.selectEdgeLoopFromVertex(
                obj.mesh,
                vertexIdx,
                directionEdge,
                shiftKey
              );
            }
            return;
          }
        }
      }

      // Normal vertex selection
      // Get all co-located vertices (vertices at the same position)
      const colocated = this.getColocatedVertices(vertexIdx);

      if (shiftKey) {
        // Toggle selection - check if the primary vertex is selected
        if (this.selection.selectedVertices.has(vertexIdx)) {
          // Deselect all co-located vertices
          for (const idx of colocated) {
            this.selection.removeVertex(idx);
          }
        } else {
          // Select all co-located vertices
          for (const idx of colocated) {
            this.selection.addVertex(idx);
          }
        }
      } else {
        // Replace selection with all co-located vertices
        this.selection.setVertices(colocated);
      }
    } else if (!shiftKey) {
      // Clicked on nothing, deselect all
      this.selection.clearAll();
    }
  }

  /**
   * Handle edge selection click
   */
  private handleEdgeClick(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    shiftKey: boolean,
    altKey: boolean = false,
    ctrlKey: boolean = false
  ): void {
    const edgeKey = this.pickEdge(screenX, screenY, canvasWidth, canvasHeight);

    if (edgeKey !== null) {
      if (altKey) {
        // Edge loop or ring selection
        const selected = this.scene.getSelectedObjects();
        if (selected.length > 0) {
          if (ctrlKey) {
            // Ctrl+Alt: Edge ring (parallel edges across quads)
            this.selection.selectEdgeRing(selected[0].mesh, edgeKey, shiftKey);
          } else {
            // Alt only: Edge loop (connected edges end-to-end)
            this.selection.selectEdgeLoop(selected[0].mesh, edgeKey, shiftKey);
          }
          return;
        }
      }

      // Normal edge selection
      if (shiftKey) {
        // Toggle selection
        if (this.selection.selectedEdges.has(edgeKey)) {
          const [v0, v1] = this.selection.parseEdgeKey(edgeKey);
          this.selection.removeEdge(v0, v1);
        } else {
          this.selection.addEdgeByKey(edgeKey);
        }
      } else {
        // Replace selection
        this.selection.setEdges([edgeKey]);
      }
    } else if (!shiftKey) {
      // Clicked on nothing, deselect all
      this.selection.clearAll();
    }
  }

  /**
   * Handle face selection click
   */
  private handleFaceClick(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    shiftKey: boolean
  ): void {
    const faceIdx = this.pickFace(screenX, screenY, canvasWidth, canvasHeight);

    if (faceIdx !== null) {
      if (shiftKey) {
        // Toggle selection
        if (this.selection.selectedFaces.has(faceIdx)) {
          this.selection.removeFace(faceIdx);
        } else {
          this.selection.addFace(faceIdx);
        }
      } else {
        // Replace selection
        this.selection.setFaces([faceIdx]);
      }
    } else if (!shiftKey) {
      // Clicked on nothing, deselect all
      this.selection.clearAll();
    }
  }

  /**
   * Pick an edge at screen coordinates
   * Uses smart picking that prefers edges even when clicking on faces
   */
  private pickEdge(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ): string | null {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    return this.picking.pickEdgeSmart(
      screenX,
      screenY,
      obj.mesh,
      obj.getModelMatrix(),
      {
        camera: this.scene.camera,
        canvasWidth,
        canvasHeight,
      }
    );
  }

  /**
   * Pick a face at screen coordinates
   */
  private pickFace(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ): number | null {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    return this.picking.pickFace(
      screenX,
      screenY,
      obj.mesh,
      obj.getModelMatrix(),
      {
        camera: this.scene.camera,
        canvasWidth,
        canvasHeight,
      }
    );
  }

  /**
   * Select all elements based on current selection mode
   */
  selectAll(): void {
    if (this.mode === "edit") {
      const selected = this.scene.getSelectedObjects();
      if (selected.length === 0) return;

      const before = this.getSelectionState();
      const mesh = selected[0].mesh;
      this.selection.selectAll(mesh);
      const after = this.getSelectionState();
      this.recordSelectionChange(before, after, "Select All");
    }
  }

  /**
   * Get vertices affected by current selection (for transforms)
   * Returns vertex indices that should be transformed
   *
   * For vertex mode: includes selected vertices and topologically-connected co-located vertices
   * For edge/face mode: includes co-located vertices from the same connected mesh component
   * (this ensures the mesh stays connected when moving edges/faces, but doesn't affect
   * disconnected geometry like Suzanne's eyes)
   */
  private getSelectedVertexIndices(): Set<number> {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return new Set();

    const mesh = selected[0].mesh;
    return this.selection.getSelectedVertexIndices(mesh);
  }

  /**
   * Get all co-located vertices at the same positions as the source vertices,
   * but ONLY if they belong to the same connected mesh component.
   *
   * This expands the selection to include duplicate vertices (for per-face normals)
   * at the exact same positions, ensuring the mesh stays connected when transforming.
   *
   * Uses geometric edge connectivity to determine mesh components, so disconnected
   * geometry (like Suzanne's eyes) won't be included even if they share vertex positions.
   */
  private getColocatedVerticesForPositions(
    sourceVertices: Set<number>
  ): Set<number> {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return sourceVertices;

    const mesh = selected[0].mesh;
    return this.selection.getColocatedVerticesForPositions(
      mesh,
      sourceVertices
    );
  }

  /**
   * Find co-located vertices that are topologically connected to the given vertices.
   * Delegates to SelectionManager.
   */
  private getConnectedColocatedVertices(
    sourceVertices: ReadonlySet<number>
  ): Set<number> {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return new Set();

    const mesh = selected[0].mesh;
    return this.selection.getConnectedColocatedVertices(
      mesh,
      new Set(sourceVertices)
    );
  }

  /**
   * Check if there's any selection in current mode
   */
  hasSelection(): boolean {
    return this.selection.hasSelection();
  }

  /**
   * Set selection mode (vertex/edge/face)
   * When going to a lower-level mode, selection is converted (Blender behavior)
   */
  setSelectionMode(mode: SelectionMode): void {
    if (this.selection.mode === mode) return;
    const before = this.getSelectionState();

    // Get the selected object's mesh for selection conversion
    const selected = this.scene.getSelectedObjects();
    const mesh = selected.length > 0 ? selected[0].mesh : undefined;

    this.selection.setMode(mode, mesh);
    const after = this.getSelectionState();
    this.recordSelectionChange(before, after, `Switch to ${mode} mode`);
  }

  /**
   * Set viewport shading mode (wireframe/solid/material)
   */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
  }

  /**
   * Clear all edit mode selections
   */
  clearEditSelections(): void {
    this.selection.clearAll();
  }

  /**
   * Select all geometry connected to the current selection (Ctrl+L)
   * Works in all edit modes - finds connected components via shared vertices
   */
  selectLinked(): void {
    if (this.mode !== "edit") return;
    if (!this.hasSelection()) return;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return;

    const before = this.getSelectionState();
    const mesh = selected[0].mesh;
    this.selection.selectLinked(mesh);
    const after = this.getSelectionState();
    this.recordSelectionChange(before, after, "Select Linked");
  }

  /**
   * Delete selected geometry (vertices, edges, or faces) based on current selection mode
   * - Vertex mode: Deletes selected vertices and all faces that use them
   * - Edge mode: Deletes faces that use the selected edges
   * - Face mode: Deletes the selected faces
   */
  deleteSelected(): boolean {
    if (this.mode !== "edit") return false;
    if (!this.hasSelection()) return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const obj = selected[0];
    const mesh = obj.mesh;

    // Store before state for undo
    const beforeMesh = serializeMesh(mesh);

    let result = { success: false, deletedFaces: 0, deletedVertices: 0 };

    if (this.selectionMode === "vertex") {
      const verticesToDelete = this.getSelectedVertexIndices();
      result = this.meshEdit.deleteVertices(mesh, verticesToDelete);
    } else if (this.selectionMode === "edge") {
      result = this.meshEdit.deleteEdges(
        mesh,
        this.selectedEdges as Set<string>
      );
    } else if (this.selectionMode === "face") {
      result = this.meshEdit.deleteFaces(
        mesh,
        this.selectedFaces as Set<number>
      );
    }

    if (result.success) {
      // Rebuild the mesh (including faces since topology changed)
      mesh.rebuildMesh();

      // Store undo action
      const afterMesh = serializeMesh(mesh);
      this.pushHistoryAction({
        type: "mesh-edit",
        description: `Delete ${this.selectionMode}s`,
        meshEdit: {
          objectName: obj.name,
          before: beforeMesh,
          after: afterMesh,
        },
      });

      // Clear selections since indices have changed
      this.clearEditSelections();
    }

    return result.success;
  }

  /**
   * Duplicate selected objects - creates copies and starts grab transform
   * Called with Shift+D in object mode
   */
  duplicateSelected(): boolean {
    if (this.mode !== "object") return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const newObjects: SceneObject[] = [];

    for (const obj of selected) {
      // Generate unique name with .001, .002 suffix
      const baseName = obj.name.replace(/\.\d{3}$/, ""); // Strip existing suffix
      let name = baseName;
      let counter = 1;
      while (this.scene.objects.some((o) => o.name === name)) {
        name = `${baseName}.${String(counter).padStart(3, "0")}`;
        counter++;
      }

      // Clone the mesh using serialize/deserialize
      const meshData = serializeMesh(obj.mesh);
      const newMesh = deserializeMesh(meshData);
      newMesh.smoothShading = obj.mesh.smoothShading;

      // Create new object with same transform
      const newObj = new SceneObject(name, newMesh);
      newObj.position = obj.position.clone();
      newObj.rotation = obj.rotation.clone();
      newObj.scale = obj.scale.clone();

      // Add to scene
      this.scene.addObject(newObj);
      newObjects.push(newObj);

      // Record in history
      this.pushHistoryAction({
        type: "object-add",
        description: `Duplicate ${obj.name}`,
        objectData: {
          name: newObj.name,
          meshData: serializeMesh(newObj.mesh),
          position: newObj.position.clone(),
          rotation: newObj.rotation.clone(),
          scale: newObj.scale.clone(),
        },
      });
    }

    // Deselect original objects, select the new ones
    this.scene.deselectAll();
    for (const newObj of newObjects) {
      newObj.selected = true;
    }
    // Set the last duplicated object as active
    if (newObjects.length > 0) {
      this.scene.activeObject = newObjects[newObjects.length - 1];
    }

    // Start grab transform on the new objects
    if (newObjects.length > 0) {
      this.startGrab();
    }

    return true;
  }

  /**
   * Parent selected objects to the active object
   * Called with Ctrl+P in object mode
   */
  parentToActive(): boolean {
    if (this.mode !== "object") return false;

    const selected = this.scene.getSelectedObjects();
    const active = this.scene.getActiveObject();

    // Need at least 2 selected objects and an active object
    if (selected.length < 2 || !active) return false;

    // The active object must be in the selection
    if (!active.selected) return false;

    // Get the inverse of the new parent's world transform
    const parentWorldMatrix = active.getModelMatrix();
    const parentWorldMatrixInverse = parentWorldMatrix.invert();
    if (!parentWorldMatrixInverse) return false; // Can't parent if matrix is singular

    // Parent all other selected objects to the active one
    let parentedCount = 0;
    for (const obj of selected) {
      if (obj !== active) {
        // Prevent circular parenting
        if (this.wouldCreateCycle(obj, active)) continue;

        // Get current world position before parenting
        const worldPos = obj.getModelMatrix().transformPoint(Vector3.zero());

        // Set the parent
        obj.parent = active;

        // Convert world position to local position relative to new parent
        const localPos = parentWorldMatrixInverse.transformPoint(worldPos);
        obj.position = localPos;

        parentedCount++;
      }
    }

    if (parentedCount > 0) {
      // TODO: Add undo support for parenting
      return true;
    }

    return false;
  }

  /**
   * Check if parenting child to parent would create a cycle
   */
  private wouldCreateCycle(
    child: SceneObject,
    newParent: SceneObject
  ): boolean {
    let current: SceneObject | null = newParent;
    while (current) {
      if (current === child) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * Clear parent of selected objects
   * Called with Alt+P in object mode
   */
  clearParent(): boolean {
    if (this.mode !== "object") return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    let clearedCount = 0;
    for (const obj of selected) {
      if (obj.parent) {
        obj.parent = null;
        clearedCount++;
      }
    }

    return clearedCount > 0;
  }

  /**
   * Extrude selected edges - creates new geometry and starts grab transform
   * Called with E key in edge mode
   */
  extrudeEdges(): boolean {
    if (this.mode !== "edit") return false;
    if (this.selectionMode !== "edge") return false;
    if (this.selectedEdges.size === 0) return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const obj = selected[0];
    const mesh = obj.mesh;

    // Store before state for undo
    const beforeMesh = serializeMesh(mesh);

    // Perform the extrusion
    const result = this.meshEdit.extrudeEdges(
      mesh,
      this.selectedEdges as Set<string>
    );

    if (!result.success) return false;

    // Store undo action
    const afterMesh = serializeMesh(mesh);
    this.pushHistoryAction({
      type: "mesh-edit",
      description: "Extrude Edges",
      meshEdit: {
        objectName: obj.name,
        before: beforeMesh,
        after: afterMesh,
      },
    });

    // Update selection to the new edge (the extruded edge)
    // Stay in edge mode - don't switch to vertex mode
    this.selection.clearAll();
    // Select the new edge connecting the extruded vertices
    for (const edgeKey of result.newEdges) {
      const [v0, v1] = edgeKey.split("-").map(Number);
      // Only select edges between new vertices (the extruded edge)
      if (result.newVertices.has(v0) && result.newVertices.has(v1)) {
        this.selection.addEdge(v0, v1);
      }
    }

    // Immediately start grab transform on the new vertices ONLY
    // (don't use startGrab() which expands to co-located vertices)
    this.transform.startVertexGrab(
      mesh,
      result.newVertices,
      obj.getModelMatrix()
    );

    return true;
  }

  /**
   * Extrude selected vertices - creates new vertices connected by edges
   * Called with E key in vertex mode
   */
  extrudeVertices(): boolean {
    if (this.mode !== "edit") return false;
    if (this.selectionMode !== "vertex") return false;
    if (this.selectedVertices.size === 0) return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const obj = selected[0];
    const mesh = obj.mesh;

    // Store before state for undo
    const beforeMesh = serializeMesh(mesh);

    // Perform the extrusion
    const result = this.meshEdit.extrudeVertices(
      mesh,
      this.selectedVertices as Set<number>
    );

    if (!result.success) return false;

    // Store undo action
    const afterMesh = serializeMesh(mesh);
    this.pushHistoryAction({
      type: "mesh-edit",
      description: "Extrude Vertices",
      meshEdit: {
        objectName: obj.name,
        before: beforeMesh,
        after: afterMesh,
      },
    });

    // Update selection to the new vertices
    // Stay in vertex mode
    this.selection.clearAll();
    this.selection.addVertices(result.newVertices);

    // Immediately start grab transform on the new vertices ONLY
    // (don't use startGrab() which expands to co-located vertices)
    this.transform.startVertexGrab(
      mesh,
      result.newVertices,
      obj.getModelMatrix()
    );

    return true;
  }

  /**
   * Extrude selected faces - creates new geometry and starts grab transform
   * Called with E key in face mode
   */
  extrudeFaces(): boolean {
    if (this.mode !== "edit") return false;
    if (this.selectionMode !== "face") return false;
    if (this.selectedFaces.size === 0) return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const obj = selected[0];
    const mesh = obj.mesh;

    // Store before state for undo
    const beforeMesh = serializeMesh(mesh);

    // Perform the extrusion
    const result = this.meshEdit.extrudeFaces(
      mesh,
      this.selectedFaces as Set<number>
    );

    if (!result.success) return false;

    // Store undo action
    const afterMesh = serializeMesh(mesh);
    this.pushHistoryAction({
      type: "mesh-edit",
      description: "Extrude Faces",
      meshEdit: {
        objectName: obj.name,
        before: beforeMesh,
        after: afterMesh,
      },
    });

    // Update selection to the new faces (the extruded top faces)
    // Stay in face mode
    this.selection.clearAll();
    for (const faceIdx of result.newFaces) {
      this.selection.addFace(faceIdx);
    }

    // Immediately start grab transform on the new vertices ONLY
    // (don't use startGrab() which expands to co-located vertices)
    this.transform.startVertexGrab(
      mesh,
      result.newVertices,
      obj.getModelMatrix()
    );

    return true;
  }

  /**
   * Join/fill selected vertices
   * - 2 vertices: creates an edge
   * - 3+ vertices: creates a face (polygon)
   * Called with F key in vertex mode
   */
  joinVertices(): boolean {
    if (this.mode !== "edit") return false;
    if (this.selectionMode !== "vertex") return false;
    if (this.selectedVertices.size < 2) return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const obj = selected[0];
    const mesh = obj.mesh;

    // Find unique positions from selected vertices
    // (handles co-located vertices from meshes with per-face normals)
    const positionToVertex = new Map<string, number>();
    for (const vIdx of this.selectedVertices) {
      const pos = mesh.vertices[vIdx].position;
      const key = getPositionKey(pos);
      if (!positionToVertex.has(key)) {
        positionToVertex.set(key, vIdx);
      }
    }

    const numUniquePositions = positionToVertex.size;
    if (numUniquePositions < 2) return false;

    // Get the representative vertex indices
    const vertexIndices = Array.from(positionToVertex.values());

    // Store before state for undo
    const beforeMesh = serializeMesh(mesh);

    if (numUniquePositions === 2) {
      // 2 vertices: create edge
      const joinSet = new Set(vertexIndices);
      const result = this.meshEdit.joinVertices(mesh, joinSet);

      if (!result.success) return false;

      // Store undo action
      const afterMesh = serializeMesh(mesh);
      this.pushHistoryAction({
        type: "mesh-edit",
        description: "Join Vertices",
        meshEdit: {
          objectName: obj.name,
          before: beforeMesh,
          after: afterMesh,
        },
      });

      // Switch to edge mode and select the new edge
      const [v0, v1] = result.edgeKey.split("-").map(Number);
      this.selection.clearAll();
      this.setSelectionMode("edge");
      this.selection.addEdge(v0, v1);

      return true;
    } else {
      // 3+ vertices: create face
      // Add face to faceData and rebuild
      mesh.faceData.push({ vertices: [...vertexIndices] });
      mesh.rebuildFromFaces();

      // Store undo action
      const afterMesh = serializeMesh(mesh);
      this.pushHistoryAction({
        type: "mesh-edit",
        description: "Fill Vertices",
        meshEdit: {
          objectName: obj.name,
          before: beforeMesh,
          after: afterMesh,
        },
      });

      // Switch to face mode and select the new face
      this.selection.clearAll();
      this.setSelectionMode("face");
      this.selection.addFace(mesh.faceData.length - 1);

      return true;
    }
  }

  /**
   * Fill selected edges to create a face
   * Called with F key in edge mode with 2+ edges selected
   */
  fillEdges(): boolean {
    if (this.mode !== "edit") return false;
    if (this.selectionMode !== "edge") return false;
    if (this.selectedEdges.size < 2) return false;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return false;

    const obj = selected[0];
    const mesh = obj.mesh;

    // Store before state for undo
    const beforeMesh = serializeMesh(mesh);

    // Perform the fill
    const result = this.meshEdit.fillEdges(
      mesh,
      this.selectedEdges as Set<string>
    );

    if (!result.success) return false;

    // Store undo action
    const afterMesh = serializeMesh(mesh);
    this.pushHistoryAction({
      type: "mesh-edit",
      description: "Fill Edges",
      meshEdit: {
        objectName: obj.name,
        before: beforeMesh,
        after: afterMesh,
      },
    });

    // Stay in edge mode, clear selection
    this.selection.clearAll();

    return true;
  }

  /**
   * Start grab (move) transform
   */
  startGrab(): void {
    if (this.mode === "edit") {
      const vertexIndices = this.getSelectedVertexIndices();
      if (vertexIndices.size === 0) return;

      const selected = this.scene.getSelectedObjects();
      if (selected.length === 0) return;

      const obj = selected[0];
      this.transform.startVertexGrab(
        obj.mesh,
        vertexIndices,
        obj.getModelMatrix()
      );
      return;
    }

    // Object mode - support multiple objects
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return;

    if (selected.length === 1) {
      this.transform.startObjectGrab(selected[0]);
    } else {
      this.transform.startMultiObjectGrab(selected);
    }
  }

  /**
   * Start rotate transform
   */
  startRotate(): void {
    if (this.mode === "edit") {
      const vertexIndices = this.getSelectedVertexIndices();
      if (vertexIndices.size === 0) return;

      const selected = this.scene.getSelectedObjects();
      if (selected.length === 0) return;

      const obj = selected[0];
      this.transform.startVertexRotate(
        obj.mesh,
        vertexIndices,
        obj.getModelMatrix()
      );
      return;
    }

    // Object mode - support multiple objects
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return;

    if (selected.length === 1) {
      this.transform.startObjectRotate(selected[0]);
    } else {
      this.transform.startMultiObjectRotate(selected);
    }
  }

  /**
   * Start scale transform
   */
  startScale(): void {
    if (this.mode === "edit") {
      const vertexIndices = this.getSelectedVertexIndices();
      if (vertexIndices.size === 0) return;

      const selected = this.scene.getSelectedObjects();
      if (selected.length === 0) return;

      const obj = selected[0];
      this.transform.startVertexScale(
        obj.mesh,
        vertexIndices,
        obj.getModelMatrix()
      );
      return;
    }

    // Object mode - support multiple objects
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return;

    if (selected.length === 1) {
      this.transform.startObjectScale(selected[0]);
    } else {
      this.transform.startMultiObjectScale(selected);
    }
  }

  /**
   * Set axis constraint and optionally axis space
   * When changing axis during an active transform, reset to original position first
   */
  setAxisConstraint(axis: AxisConstraint, space?: AxisSpace): void {
    // If in grab mode, reset to original positions before switching axis
    if (this.transform.mode === "grab") {
      const selected = this.scene.getSelectedObjects();
      if (selected.length > 0) {
        const state = this.transform.getState();

        if (this.mode === "edit" && state.vertexStartPositions.size > 0) {
          // Edit mode: reset vertices to original positions
          const obj = selected[0];
          const mesh = obj.mesh;
          for (const [idx, startPos] of state.vertexStartPositions) {
            mesh.vertices[idx].position = startPos.clone();
          }
          mesh.rebuildTriangles();

          // Reset gizmo origin to original center
          let center = Vector3.zero();
          for (const [, pos] of state.vertexStartPositions) {
            center = center.add(pos);
          }
          center = center.div(state.vertexStartPositions.size);
          const modelMatrix = obj.getModelMatrix();
          this.transform.resetTransformOrigin(
            modelMatrix.transformPoint(center)
          );
        } else if (this.transform.isMultiObjectTransform) {
          // Multi-object mode: reset all objects to original positions
          const startPositions = this.transform.getMultiObjectStartPositions();
          for (const obj of selected) {
            const startPos = startPositions.get(obj.name);
            if (startPos) {
              obj.position = startPos.clone();
            }
          }
          // Reset gizmo origin to original combined center
          let center = Vector3.zero();
          for (const pos of startPositions.values()) {
            center = center.add(pos);
          }
          center = center.div(startPositions.size);
          this.transform.resetTransformOrigin(center);
        } else if (state.startPos) {
          // Single object mode: reset object to original position
          const obj = selected[0];
          obj.position = state.startPos.clone();
          this.transform.resetTransformOrigin(obj.getWorldCenter());
        }
      }
    }

    this.transform.setAxisConstraint(axis, space);
  }

  /**
   * Update transform based on mouse movement
   */
  updateTransform(
    deltaX: number,
    deltaY: number,
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    ctrlKey: boolean = false
  ): void {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0 || this.transformMode === "none") return;

    if (this.mode === "edit" || selected.length === 1) {
      // Single object or edit mode - use single object update
      const obj = selected[0];
      this.transform.updateTransform(
        deltaX,
        deltaY,
        this.scene.camera,
        obj,
        this.mode === "edit",
        ctrlKey,
        screenX,
        screenY,
        canvasWidth,
        canvasHeight,
        this.selectedVertices
      );
    } else {
      // Multiple objects - use multi-object update
      this.transform.updateMultiObjectTransform(
        deltaX,
        deltaY,
        this.scene.camera,
        selected
      );
    }
  }

  /**
   * Confirm current transform
   */
  confirmTransform(): void {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return;

    // Check if this is a multi-object transform
    if (this.transform.isMultiObjectTransform) {
      const result = this.transform.confirmMultiObject(selected);
      if (result && result.objects.length > 0) {
        const actionNames = {
          grab: "Move",
          rotate: "Rotate",
          scale: "Scale",
          none: "Transform",
        };
        const actionName = actionNames[result.transformType];

        this.pushHistoryAction({
          type: "multi-object-transform",
          description: `${actionName} ${result.objects.length} objects`,
          multiObjectTransform: {
            objects: result.objects,
          },
        });
      }
      return;
    }

    const obj = selected[0];
    const result = this.transform.confirm(obj, this.mode === "edit");

    if (!result) return;

    // Create undo action from transform result
    if (result.type === "vertex" && result.vertexData) {
      const actionNames = {
        grab: "Move",
        rotate: "Rotate",
        scale: "Scale",
        none: "Transform",
      };
      const actionName = actionNames[result.transformType];

      this.pushHistoryAction({
        type: "vertex-move",
        description: `${actionName} ${result.vertexData.before.vertices.size} vertices`,
        vertexMove: {
          before: result.vertexData.before,
          after: result.vertexData.after,
        },
      });
    } else if (result.type === "object" && result.objectData) {
      const actionNames = {
        grab: "Move",
        rotate: "Rotate",
        scale: "Scale",
        none: "Transform",
      };
      const actionName = actionNames[result.transformType];

      this.pushHistoryAction({
        type: "object-transform",
        description: `${actionName} ${result.objectData.before.objectName}`,
        objectTransform: {
          before: result.objectData.before,
          after: result.objectData.after,
        },
      });
    }
  }

  /**
   * Cancel current transform (restore original values)
   */
  cancelTransform(): void {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return;

    // Check if this is a multi-object transform
    if (this.transform.isMultiObjectTransform) {
      this.transform.cancelMultiObject(selected);
    } else {
      this.transform.cancel(selected[0], this.mode === "edit");
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  handleKeyDown(
    key: string,
    ctrlKey: boolean = false,
    shiftKey: boolean = false,
    altKey: boolean = false
  ): boolean {
    const lowerKey = key.toLowerCase();

    // Undo: Ctrl+Z
    if (ctrlKey && lowerKey === "z" && !shiftKey) {
      return this.undo();
    }

    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if (ctrlKey && ((lowerKey === "z" && shiftKey) || lowerKey === "y")) {
      return this.redo();
    }

    // Parent selected objects to active: Ctrl+P (in Object mode)
    if (ctrlKey && lowerKey === "p" && this.mode === "object") {
      return this.parentToActive();
    }

    // Clear parent: Alt+P (in Object mode)
    if (altKey && lowerKey === "p" && this.mode === "object") {
      return this.clearParent();
    }

    // Select Linked: Ctrl+L (in Edit mode)
    if (ctrlKey && lowerKey === "l" && this.mode === "edit") {
      this.selectLinked();
      return true;
    }

    // Toggle Edit/Object mode with Tab
    if (key === "Tab") {
      this.toggleMode();
      return true;
    }

    // Cancel transform with Escape
    if (lowerKey === "escape") {
      if (this.transformMode !== "none") {
        this.cancelTransform();
        return true;
      }
      // In Edit mode, Escape also deselects
      if (this.mode === "edit" && this.hasSelection()) {
        const before = this.getSelectionState();
        this.clearEditSelections();
        const after = this.getSelectionState();
        this.recordSelectionChange(before, after, "Deselect");
        return true;
      }
    }

    // Confirm transform with Enter
    if (lowerKey === "enter") {
      if (this.transformMode !== "none") {
        this.confirmTransform();
        return true;
      }
    }

    // Selection mode switching (1/2/3) in Edit mode
    if (this.mode === "edit") {
      if (key === "1") {
        this.setSelectionMode("vertex");
        return true;
      }
      if (key === "2") {
        this.setSelectionMode("edge");
        return true;
      }
      if (key === "3") {
        this.setSelectionMode("face");
        return true;
      }
    }

    // Select all with A (Edit mode)
    if (lowerKey === "a" && this.mode === "edit") {
      if (this.hasSelection()) {
        // If something selected, deselect all (like Blender's Alt+A)
        this.clearEditSelections();
      } else {
        this.selectAll();
      }
      return true;
    }

    // Shift+D to duplicate selected objects (object mode)
    if (lowerKey === "d" && shiftKey && this.transformMode === "none") {
      if (this.mode === "object") {
        return this.duplicateSelected();
      }
    }

    // Start transforms
    if (lowerKey === "g") {
      this.startGrab();
      return true;
    }
    if (lowerKey === "r") {
      this.startRotate();
      return true;
    }
    if (lowerKey === "s" && this.transformMode === "none") {
      // Only if not already transforming (S could conflict with movement)
      this.startScale();
      return true;
    }

    // E key for extrude (in vertex, edge, or face mode)
    if (lowerKey === "e" && this.transformMode === "none") {
      if (this.mode === "edit") {
        if (this.selectionMode === "vertex") {
          return this.extrudeVertices();
        } else if (this.selectionMode === "edge") {
          return this.extrudeEdges();
        } else if (this.selectionMode === "face") {
          return this.extrudeFaces();
        }
      }
    }

    // F key for fill/join (in vertex or edge mode)
    if (lowerKey === "f" && this.transformMode === "none") {
      if (this.mode === "edit") {
        if (
          this.selectionMode === "vertex" &&
          this.selectedVertices.size >= 2
        ) {
          return this.joinVertices();
        } else if (
          this.selectionMode === "edge" &&
          this.selectedEdges.size >= 2
        ) {
          return this.fillEdges();
        }
      }
    }

    // Axis constraints (only during transform)
    if (this.transformMode !== "none") {
      if (lowerKey === "x") {
        if (shiftKey) {
          // Shift+X = YZ plane (exclude X)
          // Cycle: none → yz(world) → yz(local) → none
          if (this.axisConstraint !== "yz") {
            this.setAxisConstraint("yz", "world");
          } else if (this.axisSpace === "world") {
            this.setAxisConstraint("yz", "local");
          } else {
            this.setAxisConstraint("none");
          }
        } else {
          // Cycle: none → x(world) → x(local) → none
          if (this.axisConstraint !== "x") {
            this.setAxisConstraint("x", "world");
          } else if (this.axisSpace === "world") {
            this.setAxisConstraint("x", "local");
          } else {
            this.setAxisConstraint("none");
          }
        }
        return true;
      }
      if (lowerKey === "y") {
        if (shiftKey) {
          // Shift+Y = XZ plane (exclude Y)
          // Cycle: none → xz(world) → xz(local) → none
          if (this.axisConstraint !== "xz") {
            this.setAxisConstraint("xz", "world");
          } else if (this.axisSpace === "world") {
            this.setAxisConstraint("xz", "local");
          } else {
            this.setAxisConstraint("none");
          }
        } else {
          // Cycle: none → y(world) → y(local) → none
          if (this.axisConstraint !== "y") {
            this.setAxisConstraint("y", "world");
          } else if (this.axisSpace === "world") {
            this.setAxisConstraint("y", "local");
          } else {
            this.setAxisConstraint("none");
          }
        }
        return true;
      }
      if (lowerKey === "z") {
        if (shiftKey) {
          // Shift+Z = XY plane (exclude Z)
          // Cycle: none → xy(world) → xy(local) → none
          if (this.axisConstraint !== "xy") {
            this.setAxisConstraint("xy", "world");
          } else if (this.axisSpace === "world") {
            this.setAxisConstraint("xy", "local");
          } else {
            this.setAxisConstraint("none");
          }
        } else {
          // Cycle: none → z(world) → z(local) → none
          if (this.axisConstraint !== "z") {
            this.setAxisConstraint("z", "world");
          } else if (this.axisSpace === "world") {
            this.setAxisConstraint("z", "local");
          } else {
            this.setAxisConstraint("none");
          }
        }
        return true;
      }
    }

    // X key for delete (like Blender), but not during transforms
    if (lowerKey === "x" && this.transformMode === "none") {
      if (this.mode === "edit") {
        // Edit mode: delete selected vertices/edges/faces
        return this.deleteSelected();
      } else {
        // Object mode: delete selected objects
        const selected = this.scene.getSelectedObjects();
        for (const obj of selected) {
          // Create undo action for deletion
          this.pushHistoryAction({
            type: "object-delete",
            description: `Delete ${obj.name}`,
            objectData: {
              name: obj.name,
              meshData: serializeMesh(obj.mesh),
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            },
          });
          this.scene.removeObject(obj);
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Create gizmo line data for selected object
   */
  createGizmoData(): GizmoData | null {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0 || !this.showGizmo) return null;

    const obj = selected[0];
    const center = obj.getWorldCenter();
    return this.visualization.createGizmoData(
      center,
      this.gizmoSize,
      this.axisConstraint,
      // Pass object's rotation only for local space gizmo
      this.axisSpace === "local" ? obj.rotation : undefined
    );
  }

  /**
   * Get the origin point (position) of the selected object for rendering
   * Returns null if no object is selected
   */
  getSelectedObjectOrigin(): Vector3 | null {
    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;
    return selected[0].position.clone();
  }

  /**
   * Create axis indicator for viewport corner (RGB = XYZ)
   */
  createAxisIndicator(
    screenX: number,
    screenY: number,
    size: number
  ): GizmoData {
    return this.visualization.createAxisIndicator(
      screenX,
      screenY,
      size,
      this.scene.camera
    );
  }

  /**
   * Create vertex point data for rendering in Edit mode
   * Uses depth-based occlusion - vertices behind other geometry are hidden
   */
  createVertexPointData(
    rasterizer?: Rasterizer,
    viewMatrix?: Matrix4,
    projectionMatrix?: Matrix4
  ): VertexPointData | null {
    // Only show vertex points in vertex selection mode
    if (this.mode !== "edit" || this.selectionMode !== "vertex") return null;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    const ctx: VisualizationContext = {
      rasterizer,
      viewMatrix,
      projectionMatrix,
    };

    return this.visualization.createVertexPointData(
      obj.mesh,
      obj.getModelMatrix(),
      this.selectedVertices,
      ctx
    );
  }

  /**
   * Create wireframe data for vertex edit mode (shows edges with depth-based occlusion)
   */
  createVertexWireframeData(
    rasterizer?: Rasterizer,
    viewMatrix?: Matrix4,
    projectionMatrix?: Matrix4
  ): LineData | null {
    if (this.mode !== "edit" || this.selectionMode !== "vertex") return null;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    const ctx: VisualizationContext = {
      rasterizer,
      viewMatrix,
      projectionMatrix,
    };

    return this.visualization.createVertexWireframeData(
      obj.mesh,
      obj.getModelMatrix(),
      ctx
    );
  }

  /**
   * Create edge line data for rendering in Edit mode (edge selection mode)
   * Uses depth-based occlusion - edges behind other geometry are hidden
   */
  createEdgeLineData(
    rasterizer?: Rasterizer,
    viewMatrix?: Matrix4,
    projectionMatrix?: Matrix4
  ): LineData | null {
    if (this.mode !== "edit" || this.selectionMode !== "edge") return null;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    const ctx: VisualizationContext = {
      rasterizer,
      viewMatrix,
      projectionMatrix,
    };

    return this.visualization.createEdgeLineData(
      obj.mesh,
      obj.getModelMatrix(),
      this.selectedEdges,
      ctx
    );
  }

  /**
   * Create face highlight data for rendering in Edit mode (face selection mode)
   * Returns line data for face outlines with depth-based occlusion
   */
  createFaceHighlightData(
    rasterizer?: Rasterizer,
    viewMatrix?: Matrix4,
    projectionMatrix?: Matrix4
  ): LineData | null {
    if (this.mode !== "edit" || this.selectionMode !== "face") return null;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    const ctx: VisualizationContext = {
      rasterizer,
      viewMatrix,
      projectionMatrix,
    };

    return this.visualization.createFaceHighlightData(
      obj.mesh,
      obj.getModelMatrix(),
      this.selectedFaces,
      ctx
    );
  }

  /**
   * Create filled triangle data for selected faces (transparent highlight)
   */
  createSelectedFaceFillData(
    rasterizer?: Rasterizer,
    viewMatrix?: Matrix4,
    projectionMatrix?: Matrix4
  ): { vertices: Vertex[]; triangleIndices: number[] } | null {
    if (this.mode !== "edit" || this.selectionMode !== "face") return null;

    const selected = this.scene.getSelectedObjects();
    if (selected.length === 0) return null;

    const obj = selected[0];
    const ctx: VisualizationContext = {
      rasterizer,
      viewMatrix,
      projectionMatrix,
    };

    return this.visualization.createSelectedFaceFillData(
      obj.mesh,
      obj.getModelMatrix(),
      this.selectedFaces,
      ctx
    );
  }

  /**
   * Get status text for current state
   */
  getStatusText(): string {
    const modePrefix = this.mode === "edit" ? "[Edit] " : "[Object] ";

    if (this.transformMode === "none") {
      if (this.mode === "edit") {
        const selModeNames = { vertex: "Vertex", edge: "Edge", face: "Face" };
        const selModePrefix = selModeNames[this.selectionMode];

        if (this.selectionMode === "vertex") {
          const count = this.selectedVertices.size;
          if (count > 0) {
            return `${modePrefix}${selModePrefix}: ${count} selected | G: Grab | 1/2/3: Mode | Tab: Object`;
          }
        } else if (this.selectionMode === "edge") {
          const count = this.selectedEdges.size;
          if (count > 0) {
            return `${modePrefix}${selModePrefix}: ${count} selected | G: Grab | 1/2/3: Mode | Tab: Object`;
          }
        } else if (this.selectionMode === "face") {
          const count = this.selectedFaces.size;
          if (count > 0) {
            return `${modePrefix}${selModePrefix}: ${count} selected | G: Grab | 1/2/3: Mode | Tab: Object`;
          }
        }
        return `${modePrefix}${selModePrefix} Mode | Click: Select | A: All | 1/2/3: Mode | Tab: Object`;
      }

      const selected = this.scene.getSelectedObjects();
      if (selected.length > 0) {
        return `${modePrefix}${selected[0].name} | G: Grab | R: Rotate | S: Scale | Tab: Edit Mode`;
      }
      return `${modePrefix}Click to select | Tab: Edit Mode`;
    }

    const modeNames = { grab: "Grab", rotate: "Rotate", scale: "Scale" };
    const axisNames: Record<AxisConstraint, string> = {
      none: "",
      x: " [X]",
      y: " [Y]",
      z: " [Z]",
      yz: " [YZ]",
      xz: " [XZ]",
      xy: " [XY]",
    };
    return `${modePrefix}${modeNames[this.transformMode]}${
      axisNames[this.axisConstraint]
    } | X/Y/Z: Axis | Enter: Confirm | Esc: Cancel`;
  }
}
