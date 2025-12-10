/**
 * Transform System - Handles object and vertex transforms (Grab/Rotate/Scale)
 *
 * This system manages:
 * - Transform modes (grab, rotate, scale)
 * - Axis constraints (X, Y, Z)
 * - Object transforms (position, rotation, scale)
 * - Edit mode vertex transforms
 * - Transform confirmation and cancellation
 */

import { Vector3 } from "../math";
import { Mesh } from "../primitives";
import { SceneObject, Camera } from "../scene";

/**
 * Transform mode types
 */
export type TransformMode = "none" | "grab" | "rotate" | "scale";

/**
 * Axis constraint for transforms
 */
export type AxisConstraint = "none" | "x" | "y" | "z";

/**
 * Transform state snapshot for undo/redo
 */
export interface TransformSnapshot {
  mode: TransformMode;
  axisConstraint: AxisConstraint;
  objectStartPos: Vector3 | null;
  objectStartRotation: Vector3 | null;
  objectStartScale: Vector3 | null;
  vertexStartPositions: Map<number, Vector3>;
  editPivot: Vector3 | null;
  transformOrigin: Vector3 | null;
}

/**
 * Vertex positions before/after transform
 */
export interface VertexTransformData {
  objectName: string;
  vertices: Map<number, Vector3>;
}

/**
 * Object transform data before/after
 */
export interface ObjectTransformData {
  objectName: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

/**
 * Result of a completed transform for history
 */
export interface TransformResult {
  type: "vertex" | "object";
  transformType: TransformMode;
  vertexData?: {
    before: VertexTransformData;
    after: VertexTransformData;
  };
  objectData?: {
    before: ObjectTransformData;
    after: ObjectTransformData;
  };
}

/**
 * Callback when transform completes
 */
export type TransformCompleteCallback = (
  result: TransformResult | null
) => void;

/**
 * Transform Manager - centralizes all transform handling
 */
export class TransformManager {
  // Transform mode
  private _mode: TransformMode = "none";
  private _axisConstraint: AxisConstraint = "none";

  // Object transform start state
  private objectStartPos: Vector3 | null = null;
  private objectStartRotation: Vector3 | null = null;
  private objectStartScale: Vector3 | null = null;

  // Transform origin (world space, for gizmo display)
  private _transformOrigin: Vector3 | null = null;

  // Whether transform has been initialized (to avoid initial jump)
  private transformInitialized: boolean = false;

  // Vertex transform state (for edit mode)
  private vertexStartPositions: Map<number, Vector3> = new Map();
  private editPivot: Vector3 | null = null;

  // Callback when transform completes
  private onCompleteCallback: TransformCompleteCallback | null = null;

  /**
   * Get current transform mode
   */
  get mode(): TransformMode {
    return this._mode;
  }

  /**
   * Get current axis constraint
   */
  get axisConstraint(): AxisConstraint {
    return this._axisConstraint;
  }

  /**
   * Get transform origin (world space)
   */
  get transformOrigin(): Vector3 | null {
    return this._transformOrigin;
  }

  /**
   * Check if a transform is active
   */
  get isActive(): boolean {
    return this._mode !== "none";
  }

  /**
   * Get current transform state for history/undo
   */
  getState(): {
    mode: TransformMode;
    axisConstraint: AxisConstraint;
    startPos: Vector3 | null;
    startRotation: Vector3 | null;
    startScale: Vector3 | null;
    vertexStartPositions: Map<number, Vector3>;
    editPivot: Vector3 | null;
  } {
    return {
      mode: this._mode,
      axisConstraint: this._axisConstraint,
      startPos: this.objectStartPos,
      startRotation: this.objectStartRotation,
      startScale: this.objectStartScale,
      vertexStartPositions: this.vertexStartPositions,
      editPivot: this.editPivot,
    };
  }

  /**
   * Set callback for transform completion
   */
  setOnComplete(callback: TransformCompleteCallback | null): void {
    this.onCompleteCallback = callback;
  }

  // ==================== Transform Start ====================

  /**
   * Start grab (move) transform for object mode
   */
  startObjectGrab(obj: SceneObject): boolean {
    this._mode = "grab";
    this._axisConstraint = "none";
    this.transformInitialized = false;
    this.objectStartPos = obj.position.clone();
    this._transformOrigin = obj.getWorldCenter();
    return true;
  }

  /**
   * Start grab (move) transform for edit mode vertices
   */
  startVertexGrab(
    mesh: Mesh,
    vertexIndices: Set<number>,
    modelMatrix: { transformPoint: (v: Vector3) => Vector3 }
  ): boolean {
    if (vertexIndices.size === 0) return false;

    this._mode = "grab";
    this._axisConstraint = "none";
    this.transformInitialized = false;

    // Store initial vertex positions
    this.vertexStartPositions.clear();
    for (const idx of vertexIndices) {
      this.vertexStartPositions.set(idx, mesh.vertices[idx].position.clone());
    }

    // Calculate center of selected vertices for gizmo
    let center = Vector3.zero();
    for (const idx of vertexIndices) {
      center = center.add(mesh.vertices[idx].position);
    }
    center = center.div(vertexIndices.size);

    // Transform to world space
    this._transformOrigin = modelMatrix.transformPoint(center);
    return true;
  }

  /**
   * Start rotate transform for object mode
   */
  startObjectRotate(obj: SceneObject): boolean {
    this._mode = "rotate";
    this._axisConstraint = "none";
    this.transformInitialized = false;
    this.objectStartRotation = obj.rotation.clone();
    this._transformOrigin = obj.getWorldCenter();
    return true;
  }

  /**
   * Start rotate transform for edit mode vertices
   */
  startVertexRotate(
    mesh: Mesh,
    vertexIndices: Set<number>,
    modelMatrix: { transformPoint: (v: Vector3) => Vector3 }
  ): boolean {
    if (vertexIndices.size === 0) return false;

    this._mode = "rotate";
    this._axisConstraint = "none";
    this.transformInitialized = false;

    // Store initial vertex positions
    this.vertexStartPositions.clear();
    for (const idx of vertexIndices) {
      this.vertexStartPositions.set(idx, mesh.vertices[idx].position.clone());
    }

    // Calculate center of selected vertices
    let center = Vector3.zero();
    for (const idx of vertexIndices) {
      center = center.add(mesh.vertices[idx].position);
    }
    center = center.div(vertexIndices.size);

    // Store local pivot for rotation
    this.editPivot = center;

    // Transform to world space for gizmo
    this._transformOrigin = modelMatrix.transformPoint(center);
    return true;
  }

  /**
   * Start scale transform for object mode
   */
  startObjectScale(obj: SceneObject): boolean {
    this._mode = "scale";
    this._axisConstraint = "none";
    this.transformInitialized = false;
    this.objectStartScale = obj.scale.clone();
    this._transformOrigin = obj.getWorldCenter();
    return true;
  }

  /**
   * Start scale transform for edit mode vertices
   */
  startVertexScale(
    mesh: Mesh,
    vertexIndices: Set<number>,
    modelMatrix: { transformPoint: (v: Vector3) => Vector3 }
  ): boolean {
    if (vertexIndices.size === 0) return false;

    this._mode = "scale";
    this._axisConstraint = "none";
    this.transformInitialized = false;

    // Store initial vertex positions
    this.vertexStartPositions.clear();
    for (const idx of vertexIndices) {
      this.vertexStartPositions.set(idx, mesh.vertices[idx].position.clone());
    }

    // Calculate center of selected vertices
    let center = Vector3.zero();
    for (const idx of vertexIndices) {
      center = center.add(mesh.vertices[idx].position);
    }
    center = center.div(vertexIndices.size);

    // Store local pivot for scaling
    this.editPivot = center;

    // Transform to world space for gizmo
    this._transformOrigin = modelMatrix.transformPoint(center);
    return true;
  }

  // ==================== Axis Constraint ====================

  /**
   * Set axis constraint
   */
  setAxisConstraint(axis: AxisConstraint): void {
    if (this._mode === "none") return;
    this._axisConstraint = axis;
  }

  // ==================== Transform Update ====================

  /**
   * Update transform based on mouse movement
   */
  updateTransform(
    deltaX: number,
    deltaY: number,
    camera: Camera,
    obj: SceneObject,
    isEditMode: boolean
  ): void {
    if (this._mode === "none") return;

    // Skip the first update to avoid initial jump
    if (!this.transformInitialized) {
      this.transformInitialized = true;
      return;
    }

    // Get camera-relative directions
    const forward = camera.target.sub(camera.position).normalize();
    const right = forward.cross(new Vector3(0, 1, 0)).normalize();
    const up = right.cross(forward).normalize();

    // Sensitivity
    const moveSensitivity = 0.02;
    const rotateSensitivity = 0.02;
    const scaleSensitivity = 0.02;

    // Helper: project world axis to screen and get best mouse direction
    const getAxisMovement = (axis: Vector3): number => {
      const screenX = axis.dot(right);
      const screenY = -axis.dot(up);

      const absX = Math.abs(screenX);
      const absY = Math.abs(screenY);

      if (absX + absY < 0.001) {
        return deltaX;
      }

      return (deltaX * screenX + deltaY * screenY) / (absX + absY);
    };

    if (this._mode === "grab") {
      this.updateGrab(
        deltaX,
        deltaY,
        right,
        up,
        moveSensitivity,
        getAxisMovement,
        obj,
        isEditMode
      );
    } else if (this._mode === "rotate") {
      this.updateRotate(rotateSensitivity, getAxisMovement, obj, isEditMode);
    } else if (this._mode === "scale") {
      this.updateScale(deltaX, deltaY, scaleSensitivity, obj, isEditMode);
    }
  }

  private updateGrab(
    deltaX: number,
    deltaY: number,
    right: Vector3,
    up: Vector3,
    sensitivity: number,
    getAxisMovement: (axis: Vector3) => number,
    obj: SceneObject,
    isEditMode: boolean
  ): void {
    let movement = Vector3.zero();

    if (this._axisConstraint === "none") {
      movement = right
        .mul(deltaX * sensitivity)
        .add(up.mul(-deltaY * sensitivity));
    } else if (this._axisConstraint === "x") {
      const amount = getAxisMovement(new Vector3(1, 0, 0));
      movement = new Vector3(amount * sensitivity, 0, 0);
    } else if (this._axisConstraint === "y") {
      const amount = getAxisMovement(new Vector3(0, 1, 0));
      movement = new Vector3(0, amount * sensitivity, 0);
    } else if (this._axisConstraint === "z") {
      const amount = getAxisMovement(new Vector3(0, 0, 1));
      movement = new Vector3(0, 0, amount * sensitivity);
    }

    if (isEditMode && this.vertexStartPositions.size > 0) {
      // Edit mode: move vertices in world space
      const modelMatrix = obj.getModelMatrix();
      const inverseModel = modelMatrix.invert();
      const localMovement = inverseModel
        ? inverseModel.transformDirection(movement)
        : movement;

      const mesh = obj.mesh;
      for (const idx of this.vertexStartPositions.keys()) {
        const pos = mesh.vertices[idx].position;
        mesh.vertices[idx].position = pos.add(localMovement);
      }
      mesh.rebuildTriangles();

      // Update gizmo origin
      if (this._transformOrigin) {
        this._transformOrigin = this._transformOrigin.add(movement);
      }
    } else if (this.objectStartPos) {
      // Object mode: move object
      obj.position = obj.position.add(movement);
    }
  }

  private updateRotate(
    sensitivity: number,
    getAxisMovement: (axis: Vector3) => number,
    obj: SceneObject,
    isEditMode: boolean
  ): void {
    if (isEditMode && this.vertexStartPositions.size > 0 && this.editPivot) {
      // Edit mode: rotate vertices around pivot
      let axis = new Vector3(0, 1, 0);
      if (this._axisConstraint === "x") axis = new Vector3(1, 0, 0);
      else if (this._axisConstraint === "z") axis = new Vector3(0, 0, 1);

      const amount = getAxisMovement(axis);
      const angle = amount * sensitivity;

      const mesh = obj.mesh;
      for (const idx of this.vertexStartPositions.keys()) {
        const pos = mesh.vertices[idx].position;
        const relative = pos.sub(this.editPivot);
        const rotated = this.rotateVectorAroundAxis(relative, axis, angle);
        mesh.vertices[idx].position = rotated.add(this.editPivot);
      }
      mesh.rebuildTriangles();
    } else if (this.objectStartRotation) {
      // Object mode: rotate object
      if (this._axisConstraint === "none" || this._axisConstraint === "y") {
        const amount = getAxisMovement(new Vector3(0, 1, 0));
        obj.rotation.y += amount * sensitivity;
      } else if (this._axisConstraint === "x") {
        const amount = getAxisMovement(new Vector3(1, 0, 0));
        obj.rotation.x += amount * sensitivity;
      } else if (this._axisConstraint === "z") {
        const amount = getAxisMovement(new Vector3(0, 0, 1));
        obj.rotation.z += amount * sensitivity;
      }
    }
  }

  private updateScale(
    deltaX: number,
    deltaY: number,
    sensitivity: number,
    obj: SceneObject,
    isEditMode: boolean
  ): void {
    const rawAmount = deltaX - deltaY;
    const scaleAmount = 1 + rawAmount * sensitivity;

    if (isEditMode && this.vertexStartPositions.size > 0 && this.editPivot) {
      // Edit mode: scale vertices around pivot
      const mesh = obj.mesh;
      for (const idx of this.vertexStartPositions.keys()) {
        const pos = mesh.vertices[idx].position;
        const relative = pos.sub(this.editPivot);

        let scaled: Vector3;
        if (this._axisConstraint === "none") {
          scaled = relative.mul(scaleAmount);
        } else if (this._axisConstraint === "x") {
          scaled = new Vector3(
            relative.x * scaleAmount,
            relative.y,
            relative.z
          );
        } else if (this._axisConstraint === "y") {
          scaled = new Vector3(
            relative.x,
            relative.y * scaleAmount,
            relative.z
          );
        } else if (this._axisConstraint === "z") {
          scaled = new Vector3(
            relative.x,
            relative.y,
            relative.z * scaleAmount
          );
        } else {
          scaled = relative;
        }

        mesh.vertices[idx].position = scaled.add(this.editPivot);
      }
      mesh.rebuildTriangles();
    } else if (this.objectStartScale) {
      // Object mode: scale object
      if (this._axisConstraint === "none") {
        obj.scale = new Vector3(
          obj.scale.x * scaleAmount,
          obj.scale.y * scaleAmount,
          obj.scale.z * scaleAmount
        );
      } else if (this._axisConstraint === "x") {
        obj.scale = new Vector3(
          obj.scale.x * scaleAmount,
          obj.scale.y,
          obj.scale.z
        );
      } else if (this._axisConstraint === "y") {
        obj.scale = new Vector3(
          obj.scale.x,
          obj.scale.y * scaleAmount,
          obj.scale.z
        );
      } else if (this._axisConstraint === "z") {
        obj.scale = new Vector3(
          obj.scale.x,
          obj.scale.y,
          obj.scale.z * scaleAmount
        );
      }
    }
  }

  /**
   * Rotate a vector around an axis by an angle (radians)
   */
  private rotateVectorAroundAxis(
    v: Vector3,
    axis: Vector3,
    angle: number
  ): Vector3 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dot = v.dot(axis);
    const cross = axis.cross(v);

    return v
      .mul(cos)
      .add(cross.mul(sin))
      .add(axis.mul(dot * (1 - cos)));
  }

  // ==================== Transform Completion ====================

  /**
   * Confirm current transform
   * Returns transform result for history, or null if no transform
   */
  confirm(obj: SceneObject, isEditMode: boolean): TransformResult | null {
    if (this._mode === "none") return null;

    let result: TransformResult | null = null;

    if (isEditMode && this.vertexStartPositions.size > 0) {
      // Edit mode vertex transform result
      const beforeVertices = new Map<number, Vector3>();
      const afterVertices = new Map<number, Vector3>();

      for (const [idx, pos] of this.vertexStartPositions) {
        beforeVertices.set(idx, pos.clone());
        afterVertices.set(idx, obj.mesh.vertices[idx].position.clone());
      }

      result = {
        type: "vertex",
        transformType: this._mode,
        vertexData: {
          before: { objectName: obj.name, vertices: beforeVertices },
          after: { objectName: obj.name, vertices: afterVertices },
        },
      };
    } else if (this._mode === "grab" && this.objectStartPos) {
      result = {
        type: "object",
        transformType: "grab",
        objectData: {
          before: {
            objectName: obj.name,
            position: this.objectStartPos.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          },
          after: {
            objectName: obj.name,
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          },
        },
      };
    } else if (this._mode === "rotate" && this.objectStartRotation) {
      result = {
        type: "object",
        transformType: "rotate",
        objectData: {
          before: {
            objectName: obj.name,
            position: obj.position.clone(),
            rotation: this.objectStartRotation.clone(),
            scale: obj.scale.clone(),
          },
          after: {
            objectName: obj.name,
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          },
        },
      };
    } else if (this._mode === "scale" && this.objectStartScale) {
      result = {
        type: "object",
        transformType: "scale",
        objectData: {
          before: {
            objectName: obj.name,
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: this.objectStartScale.clone(),
          },
          after: {
            objectName: obj.name,
            position: obj.position.clone(),
            rotation: obj.rotation.clone(),
            scale: obj.scale.clone(),
          },
        },
      };
    }

    // Clear state
    this.clearState();

    // Notify callback
    this.onCompleteCallback?.(result);

    return result;
  }

  /**
   * Cancel current transform (restore original values)
   */
  cancel(obj: SceneObject, isEditMode: boolean): void {
    if (this._mode === "none") return;

    if (isEditMode && this.vertexStartPositions.size > 0) {
      // Restore vertex positions
      const mesh = obj.mesh;
      for (const [idx, pos] of this.vertexStartPositions) {
        mesh.vertices[idx].position = pos.clone();
      }
      mesh.rebuildTriangles();
    } else if (this._mode === "grab" && this.objectStartPos) {
      obj.position = this.objectStartPos.clone();
    } else if (this._mode === "rotate" && this.objectStartRotation) {
      obj.rotation = this.objectStartRotation.clone();
    } else if (this._mode === "scale" && this.objectStartScale) {
      obj.scale = this.objectStartScale.clone();
    }

    // Clear state
    this.clearState();

    // Notify callback (null = cancelled)
    this.onCompleteCallback?.(null);
  }

  /**
   * Clear all transform state
   */
  private clearState(): void {
    this._mode = "none";
    this._axisConstraint = "none";
    this.objectStartPos = null;
    this.objectStartRotation = null;
    this.objectStartScale = null;
    this._transformOrigin = null;
    this.transformInitialized = false;
    this.vertexStartPositions.clear();
    this.editPivot = null;
  }

  /**
   * Get vertex count being transformed
   */
  get vertexCount(): number {
    return this.vertexStartPositions.size;
  }
}
