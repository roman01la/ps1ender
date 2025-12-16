/**
 * History System - Undo/Redo functionality
 *
 * This system manages the undo/redo stack for all editor operations.
 * It supports multiple named stacks for different contexts (3D editor, shader editor, etc.)
 * It's decoupled from the Editor class to allow for:
 * - Independent testing
 * - Potential persistence (save/load history)
 * - Clear separation of concerns
 */

import { Vector3, Color } from "../math";
import { Vertex, Mesh } from "../primitives";

// ============================================================================
// Generic History Stack
// ============================================================================

/**
 * Generic history stack that can store any serializable state
 */
export class GenericHistoryStack<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private maxLevels: number;
  private onChange: (() => void) | null = null;

  constructor(maxLevels: number = 50) {
    this.maxLevels = maxLevels;
  }

  /**
   * Set callback for when history changes (for UI updates)
   */
  setOnChange(callback: (() => void) | null): void {
    this.onChange = callback;
  }

  /**
   * Push a state to the undo stack
   */
  push(state: T): void {
    this.undoStack.push(state);
    this.redoStack = [];
    if (this.undoStack.length > this.maxLevels) {
      this.undoStack.shift();
    }
    this.onChange?.();
  }

  /**
   * Pop from undo stack and push current state to redo
   * Returns the state to restore, or null if empty
   */
  popUndo(currentState: T): T | null {
    const state = this.undoStack.pop();
    if (state !== undefined) {
      this.redoStack.push(currentState);
      this.onChange?.();
      return state;
    }
    return null;
  }

  /**
   * Pop from redo stack and push current state to undo
   * Returns the state to restore, or null if empty
   */
  popRedo(currentState: T): T | null {
    const state = this.redoStack.pop();
    if (state !== undefined) {
      this.undoStack.push(currentState);
      this.onChange?.();
      return state;
    }
    return null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }

  getStackSizes(): { undo: number; redo: number } {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }
}

// ============================================================================
// Multi-Stack History Manager
// ============================================================================

/**
 * Common interface for all history stacks
 */
export interface IHistoryStack {
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  getStackSizes(): { undo: number; redo: number };
}

/**
 * Manages multiple named history stacks
 * Each stack is independent and persists across component lifecycles
 * Supports both generic state-based stacks and action-based stacks (like 3D editor)
 */
class MultiStackHistoryManager {
  private genericStacks = new Map<string, GenericHistoryStack<unknown>>();
  private registeredStacks = new Map<string, IHistoryStack>();
  private maxLevels: number;

  constructor(maxLevels: number = 50) {
    this.maxLevels = maxLevels;
  }

  /**
   * Get or create a generic history stack for a given ID
   */
  getStack<T>(stackId: string): GenericHistoryStack<T> {
    let stack = this.genericStacks.get(stackId);
    if (!stack) {
      stack = new GenericHistoryStack<unknown>(this.maxLevels);
      this.genericStacks.set(stackId, stack);
    }
    return stack as GenericHistoryStack<T>;
  }

  /**
   * Register an external history stack (like the 3D editor's action-based History)
   */
  registerStack(stackId: string, stack: IHistoryStack): void {
    this.registeredStacks.set(stackId, stack);
  }

  /**
   * Get a registered stack by ID
   */
  getRegisteredStack<T extends IHistoryStack>(stackId: string): T | undefined {
    return this.registeredStacks.get(stackId) as T | undefined;
  }

  /**
   * Clear a specific stack (generic or registered)
   */
  clearStack(stackId: string): void {
    const genericStack = this.genericStacks.get(stackId);
    if (genericStack) {
      genericStack.clear();
      return;
    }
    const registeredStack = this.registeredStacks.get(stackId);
    if (registeredStack) {
      registeredStack.clear();
    }
  }

  /**
   * Clear all stacks
   */
  clearAll(): void {
    for (const stack of this.genericStacks.values()) {
      stack.clear();
    }
    for (const stack of this.registeredStacks.values()) {
      stack.clear();
    }
  }

  /**
   * Delete a generic stack entirely
   */
  deleteStack(stackId: string): void {
    this.genericStacks.delete(stackId);
  }

  /**
   * Unregister a registered stack
   */
  unregisterStack(stackId: string): void {
    this.registeredStacks.delete(stackId);
  }

  /**
   * Get all stack IDs
   */
  getAllStackIds(): string[] {
    return [
      ...Array.from(this.genericStacks.keys()),
      ...Array.from(this.registeredStacks.keys()),
    ];
  }

  /**
   * Get combined status of all stacks
   */
  getStatus(): Map<
    string,
    {
      canUndo: boolean;
      canRedo: boolean;
      sizes: { undo: number; redo: number };
    }
  > {
    const status = new Map<
      string,
      {
        canUndo: boolean;
        canRedo: boolean;
        sizes: { undo: number; redo: number };
      }
    >();

    for (const [id, stack] of this.genericStacks) {
      status.set(id, {
        canUndo: stack.canUndo(),
        canRedo: stack.canRedo(),
        sizes: stack.getStackSizes(),
      });
    }

    for (const [id, stack] of this.registeredStacks) {
      status.set(id, {
        canUndo: stack.canUndo(),
        canRedo: stack.canRedo(),
        sizes: stack.getStackSizes(),
      });
    }

    return status;
  }
}

// Global instance for the application
export const historyManager = new MultiStackHistoryManager(50);

// Stack ID constants
export const HISTORY_STACK_3D_EDITOR = "3d-editor";

// ============================================================================
// 3D Editor History Types (existing implementation)
// ============================================================================

/**
 * Types of actions that can be undone/redone
 */
export type HistoryActionType =
  | "object-transform"
  | "multi-object-transform"
  | "vertex-move"
  | "object-add"
  | "object-delete"
  | "mesh-edit"
  | "selection-change"
  | "mode-change";

/**
 * Snapshot of object transform state
 */
export interface ObjectTransformState {
  objectName: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

/**
 * Snapshot of vertex positions
 */
export interface VertexMoveState {
  objectName: string;
  vertices: Map<number, Vector3>; // vertex index -> position
}

/**
 * Serialized mesh data for storage
 */
export interface SerializedMeshData {
  vertices: {
    position: Vector3;
    color: Color;
    normal: Vector3;
    u: number;
    v: number;
  }[];
  indices: number[];
}

/**
 * Object data for add/delete operations
 */
export interface ObjectData {
  name: string;
  meshData: SerializedMeshData;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

/**
 * Mesh edit data (before/after states)
 */
export interface MeshEditData {
  objectName: string;
  before: SerializedMeshData;
  after: SerializedMeshData;
}

/**
 * Selection state for undo/redo
 */
export interface SelectionHistoryState {
  // Object mode selection
  selectedObjectNames: string[];
  // Edit mode selection
  editModeSelection?: {
    objectName: string;
    mode: "vertex" | "edge" | "face";
    vertices: number[];
    edges: string[];
    faces: number[];
  };
}

/**
 * Mode change state for undo/redo
 */
export interface ModeChangeState {
  mode: "object" | "edit";
  // Capture full selection state to restore properly
  selection: SelectionHistoryState;
}

/**
 * A single action that can be undone/redone
 */
export interface HistoryAction {
  type: HistoryActionType;
  description: string;
  objectTransform?: {
    before: ObjectTransformState;
    after: ObjectTransformState;
  };
  multiObjectTransform?: {
    objects: Array<{
      before: ObjectTransformState;
      after: ObjectTransformState;
    }>;
  };
  vertexMove?: {
    before: VertexMoveState;
    after: VertexMoveState;
  };
  objectData?: ObjectData;
  meshEdit?: MeshEditData;
  selectionChange?: {
    before: SelectionHistoryState;
    after: SelectionHistoryState;
  };
  modeChange?: {
    before: ModeChangeState;
    after: ModeChangeState;
  };
}

/**
 * Callback for when history state changes
 */
export type HistoryChangeCallback = () => void;

/**
 * History manager - handles undo/redo stack for 3D editor (action-based)
 * Implements IHistoryStack for integration with historyManager
 */
export class History implements IHistoryStack {
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];
  private maxLevels: number;
  private onChange: HistoryChangeCallback | null = null;

  constructor(maxLevels: number = 50) {
    this.maxLevels = maxLevels;
  }

  /**
   * Set callback for when history changes (for UI updates)
   */
  setOnChange(callback: HistoryChangeCallback | null): void {
    this.onChange = callback;
  }

  /**
   * Push a new action to the undo stack
   */
  push(action: HistoryAction): void {
    this.undoStack.push(action);
    // Clear redo stack when new action is performed
    this.redoStack = [];
    // Limit undo stack size
    if (this.undoStack.length > this.maxLevels) {
      this.undoStack.shift();
    }
    this.onChange?.();
  }

  /**
   * Pop the last action from undo stack (for undo operation)
   * Returns the action to be undone, or null if stack is empty
   */
  popUndo(): HistoryAction | null {
    const action = this.undoStack.pop();
    if (action) {
      this.redoStack.push(action);
      this.onChange?.();
    }
    return action ?? null;
  }

  /**
   * Pop the last action from redo stack (for redo operation)
   * Returns the action to be redone, or null if stack is empty
   */
  popRedo(): HistoryAction | null {
    const action = this.redoStack.pop();
    if (action) {
      this.undoStack.push(action);
      this.onChange?.();
    }
    return action ?? null;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Get description of the action that would be undone
   */
  getUndoDescription(): string {
    if (this.undoStack.length === 0) return "";
    return this.undoStack[this.undoStack.length - 1].description;
  }

  /**
   * Get description of the action that would be redone
   */
  getRedoDescription(): string {
    if (this.redoStack.length === 0) return "";
    return this.redoStack[this.redoStack.length - 1].description;
  }

  /**
   * Get status for UI display
   */
  getStatus(): {
    canUndo: boolean;
    canRedo: boolean;
    undoDesc: string;
    redoDesc: string;
  } {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoDesc: this.getUndoDescription(),
      redoDesc: this.getRedoDescription(),
    };
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }

  /**
   * Get stack sizes (for debugging/UI)
   */
  getStackSizes(): { undo: number; redo: number } {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }
}

// ============================================================================
// Utility functions for mesh serialization (used by Editor)
// ============================================================================

/**
 * Serialize a mesh to a plain object for storage
 */
export function serializeMesh(mesh: Mesh): SerializedMeshData {
  return {
    vertices: mesh.vertices.map((v) => ({
      position: new Vector3(v.position.x, v.position.y, v.position.z),
      color: new Color(v.color.r, v.color.g, v.color.b),
      normal: new Vector3(v.normal.x, v.normal.y, v.normal.z),
      u: v.u,
      v: v.v,
    })),
    indices: [...mesh.indices],
  };
}

/**
 * Reconstruct a mesh from serialized data
 */
export function deserializeMesh(data: SerializedMeshData): Mesh {
  const vertices = data.vertices.map(
    (v) =>
      new Vertex(
        new Vector3(v.position.x, v.position.y, v.position.z),
        new Color(v.color.r, v.color.g, v.color.b),
        new Vector3(v.normal.x, v.normal.y, v.normal.z),
        v.u,
        v.v
      )
  );
  return new Mesh(vertices, [...data.indices]);
}
