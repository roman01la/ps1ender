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

import { Vector3, Matrix4 } from "../math";
import { Mesh } from "../primitives";
import { SceneObject, Camera } from "../scene";

/**
 * Transform mode types
 */
export type TransformMode = "none" | "grab" | "rotate" | "scale";

/**
 * Axis constraint for transforms
 * Single axis: "x", "y", "z" - movement locked to that axis
 * Plane (two axes): "yz", "xz", "xy" - movement on that plane (excludes the missing axis)
 */
export type AxisConstraint = "none" | "x" | "y" | "z" | "yz" | "xz" | "xy";

/**
 * Axis space for transforms
 * "world" - axes aligned to world coordinates
 * "local" - axes aligned to object's local coordinates
 */
export type AxisSpace = "world" | "local";

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
 * Result of a multi-object transform for history
 */
export interface MultiObjectTransformResult {
  type: "multi-object";
  transformType: TransformMode;
  objects: Array<{
    before: ObjectTransformData;
    after: ObjectTransformData;
  }>;
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
  private _axisSpace: AxisSpace = "world";

  // Object transform start states (for multiple objects)
  private objectStartPositions: Map<string, Vector3> = new Map();
  private objectStartRotations: Map<string, Vector3> = new Map();
  private objectStartScales: Map<string, Vector3> = new Map();

  // Legacy single-object (for backward compatibility with edit mode)
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
   * Get current axis space (world or local)
   */
  get axisSpace(): AxisSpace {
    return this._axisSpace;
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
   * Get multi-object start positions
   */
  getMultiObjectStartPositions(): Map<string, Vector3> {
    return this.objectStartPositions;
  }

  /**
   * Get multi-object start rotations
   */
  getMultiObjectStartRotations(): Map<string, Vector3> {
    return this.objectStartRotations;
  }

  /**
   * Set callback for transform completion
   */
  setOnComplete(callback: TransformCompleteCallback | null): void {
    this.onCompleteCallback = callback;
  }

  // ==================== Transform Start ====================

  /**
   * Start grab (move) transform for object mode (supports multiple objects)
   */
  startObjectGrab(obj: SceneObject): boolean {
    this._mode = "grab";
    this._axisConstraint = "none";
    this._axisSpace = "world";
    this.transformInitialized = false;
    this.objectStartPos = obj.position.clone();
    this._transformOrigin = obj.getWorldCenter();
    return true;
  }

  /**
   * Start grab (move) transform for multiple objects
   */
  startMultiObjectGrab(objects: SceneObject[]): boolean {
    if (objects.length === 0) return false;

    this._mode = "grab";
    this._axisConstraint = "none";
    this._axisSpace = "world";
    this.transformInitialized = false;

    // Store start positions for all objects
    this.objectStartPositions.clear();
    for (const obj of objects) {
      this.objectStartPositions.set(obj.name, obj.position.clone());
    }

    // Calculate combined center for gizmo
    let center = Vector3.zero();
    for (const obj of objects) {
      center = center.add(obj.getWorldCenter());
    }
    center = center.div(objects.length);
    this._transformOrigin = center;

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
    this._axisSpace = "world";
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
    this._axisSpace = "world";
    this.transformInitialized = false;
    this.objectStartRotation = obj.rotation.clone();
    this._transformOrigin = obj.getWorldCenter();
    return true;
  }

  /**
   * Start rotate transform for multiple objects
   */
  startMultiObjectRotate(objects: SceneObject[]): boolean {
    if (objects.length === 0) return false;

    this._mode = "rotate";
    this._axisConstraint = "none";
    this._axisSpace = "world";
    this.transformInitialized = false;

    // Store start rotations and positions for all objects
    this.objectStartRotations.clear();
    this.objectStartPositions.clear();
    for (const obj of objects) {
      this.objectStartRotations.set(obj.name, obj.rotation.clone());
      this.objectStartPositions.set(obj.name, obj.position.clone());
    }

    // Calculate combined center for rotation pivot
    let center = Vector3.zero();
    for (const obj of objects) {
      center = center.add(obj.getWorldCenter());
    }
    center = center.div(objects.length);
    this._transformOrigin = center;

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
    this._axisSpace = "world";
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
    this._axisSpace = "world";
    this.transformInitialized = false;
    this.objectStartScale = obj.scale.clone();
    this._transformOrigin = obj.getWorldCenter();
    return true;
  }

  /**
   * Start scale transform for multiple objects
   */
  startMultiObjectScale(objects: SceneObject[]): boolean {
    if (objects.length === 0) return false;

    this._mode = "scale";
    this._axisConstraint = "none";
    this._axisSpace = "world";
    this.transformInitialized = false;

    // Store start scales for all objects
    this.objectStartScales.clear();
    for (const obj of objects) {
      this.objectStartScales.set(obj.name, obj.scale.clone());
    }

    // Calculate combined center for scale pivot
    let center = Vector3.zero();
    for (const obj of objects) {
      center = center.add(obj.getWorldCenter());
    }
    center = center.div(objects.length);
    this._transformOrigin = center;

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
    this._axisSpace = "world";
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
   * Set axis constraint and optionally axis space
   */
  setAxisConstraint(axis: AxisConstraint, space?: AxisSpace): void {
    if (this._mode === "none") return;
    this._axisConstraint = axis;
    if (space !== undefined) {
      this._axisSpace = space;
    } else if (axis === "none") {
      // Reset to world when constraint is cleared
      this._axisSpace = "world";
    }
  }

  /**
   * Reset transform origin (used when switching axis constraints)
   */
  resetTransformOrigin(origin: Vector3): void {
    this._transformOrigin = origin;
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
    isEditMode: boolean,
    ctrlKey: boolean = false,
    screenX: number = 0,
    screenY: number = 0,
    canvasWidth: number = 0,
    canvasHeight: number = 0,
    selectedVertices?: ReadonlySet<number>
  ): void {
    if (this._mode === "none") return;

    // Skip the first update to avoid initial jump
    if (!this.transformInitialized) {
      this.transformInitialized = true;
      return;
    }

    // Get camera-relative directions
    const forward = camera.target.sub(camera.position).normalize();
    const right = forward.cross(new Vector3(0, 0, 1)).normalize();
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
        isEditMode,
        ctrlKey,
        screenX,
        screenY,
        canvasWidth,
        canvasHeight,
        camera,
        selectedVertices
      );
    } else if (this._mode === "rotate") {
      this.updateRotate(rotateSensitivity, getAxisMovement, obj, isEditMode);
    } else if (this._mode === "scale") {
      this.updateScale(deltaX, deltaY, scaleSensitivity, obj, isEditMode);
    }
  }

  /**
   * Update transform for multiple objects based on mouse movement
   */
  updateMultiObjectTransform(
    deltaX: number,
    deltaY: number,
    camera: Camera,
    objects: SceneObject[]
  ): void {
    if (this._mode === "none" || objects.length === 0) return;

    // Skip the first update to avoid initial jump
    if (!this.transformInitialized) {
      this.transformInitialized = true;
      return;
    }

    // Get camera-relative directions
    const forward = camera.target.sub(camera.position).normalize();
    const right = forward.cross(new Vector3(0, 0, 1)).normalize();
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
      this.updateMultiObjectGrab(
        deltaX,
        deltaY,
        right,
        up,
        moveSensitivity,
        getAxisMovement,
        objects
      );
    } else if (this._mode === "rotate") {
      this.updateMultiObjectRotate(rotateSensitivity, getAxisMovement, objects);
    } else if (this._mode === "scale") {
      this.updateMultiObjectScale(deltaX, deltaY, scaleSensitivity, objects);
    }
  }

  private updateMultiObjectGrab(
    deltaX: number,
    deltaY: number,
    right: Vector3,
    up: Vector3,
    sensitivity: number,
    getAxisMovement: (axis: Vector3) => number,
    objects: SceneObject[]
  ): void {
    // Calculate movement based on axis constraint
    let movement = Vector3.zero();

    // Get local axes if in local space mode (use first object's rotation)
    let xAxis = new Vector3(1, 0, 0);
    let yAxis = new Vector3(0, 1, 0);
    let zAxis = new Vector3(0, 0, 1);

    if (this._axisSpace === "local" && objects.length > 0) {
      const rot = objects[0].rotation;
      const rotMatrix = Matrix4.rotationY(rot.y)
        .multiply(Matrix4.rotationX(rot.x))
        .multiply(Matrix4.rotationZ(rot.z));
      xAxis = rotMatrix.transformDirection(xAxis);
      yAxis = rotMatrix.transformDirection(yAxis);
      zAxis = rotMatrix.transformDirection(zAxis);
    }

    if (this._axisConstraint === "none") {
      movement = right
        .mul(deltaX * sensitivity)
        .add(up.mul(-deltaY * sensitivity));
    } else if (this._axisConstraint === "x") {
      const amount = getAxisMovement(xAxis);
      movement = xAxis.mul(amount * sensitivity);
    } else if (this._axisConstraint === "y") {
      const amount = getAxisMovement(yAxis);
      movement = yAxis.mul(amount * sensitivity);
    } else if (this._axisConstraint === "z") {
      const amount = getAxisMovement(zAxis);
      movement = zAxis.mul(amount * sensitivity);
    } else if (this._axisConstraint === "yz") {
      const amountY = getAxisMovement(yAxis);
      const amountZ = getAxisMovement(zAxis);
      movement = yAxis
        .mul(amountY * sensitivity)
        .add(zAxis.mul(amountZ * sensitivity));
    } else if (this._axisConstraint === "xz") {
      const amountX = getAxisMovement(xAxis);
      const amountZ = getAxisMovement(zAxis);
      movement = xAxis
        .mul(amountX * sensitivity)
        .add(zAxis.mul(amountZ * sensitivity));
    } else if (this._axisConstraint === "xy") {
      const amountX = getAxisMovement(xAxis);
      const amountY = getAxisMovement(yAxis);
      movement = xAxis
        .mul(amountX * sensitivity)
        .add(yAxis.mul(amountY * sensitivity));
    }

    // Apply movement to all objects
    for (const obj of objects) {
      obj.position = obj.position.add(movement);
    }

    // Update gizmo origin
    if (this._transformOrigin) {
      this._transformOrigin = this._transformOrigin.add(movement);
    }
  }

  private updateMultiObjectRotate(
    sensitivity: number,
    getAxisMovement: (axis: Vector3) => number,
    objects: SceneObject[]
  ): void {
    if (!this._transformOrigin) return;

    // Determine rotation axis - for rotation, local space means rotating in local axes
    // which is what we already do when we modify obj.rotation directly
    let axis = new Vector3(0, 0, 1); // Default to Z axis (up in Z-up)
    if (this._axisConstraint === "x") axis = new Vector3(1, 0, 0);
    else if (this._axisConstraint === "y") axis = new Vector3(0, 1, 0);

    // For world space rotation with axis constraint, we need to transform the axis
    // For local space, we rotate around the object's local axis (direct euler modification)
    if (
      this._axisSpace === "world" &&
      this._axisConstraint !== "none" &&
      objects.length > 0
    ) {
      // World space: compute world axis and convert rotation appropriately
      const amount = getAxisMovement(axis);
      const angle = amount * sensitivity;

      // For single-axis world space rotation, we directly apply to the euler angle
      // This is a simplification - full world space would require quaternion math
      for (const obj of objects) {
        if (this._axisConstraint === "x") obj.rotation.x += angle;
        else if (this._axisConstraint === "y") obj.rotation.y += angle;
        else if (this._axisConstraint === "z") obj.rotation.z += angle;
      }
    } else {
      // Local space (default behavior) or no constraint
      const amount = getAxisMovement(axis);
      const angle = amount * sensitivity;

      for (const obj of objects) {
        if (this._axisConstraint === "x" || this._axisConstraint === "none") {
          obj.rotation.x += angle;
        }
        if (this._axisConstraint === "y" || this._axisConstraint === "none") {
          obj.rotation.y += angle;
        }
        if (this._axisConstraint === "z" || this._axisConstraint === "none") {
          obj.rotation.z += angle;
        }
      }
    }
  }

  private updateMultiObjectScale(
    deltaX: number,
    deltaY: number,
    sensitivity: number,
    objects: SceneObject[]
  ): void {
    // Calculate scale factor from mouse movement
    const scaleFactor = 1.0 + (deltaX - deltaY) * sensitivity;

    for (const obj of objects) {
      if (this._axisConstraint === "none") {
        obj.scale = obj.scale.mul(scaleFactor);
      } else if (this._axisConstraint === "x") {
        obj.scale.x *= scaleFactor;
      } else if (this._axisConstraint === "y") {
        obj.scale.y *= scaleFactor;
      } else if (this._axisConstraint === "z") {
        obj.scale.z *= scaleFactor;
      }
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
    isEditMode: boolean,
    ctrlKey: boolean = false,
    screenX: number = 0,
    screenY: number = 0,
    canvasWidth: number = 0,
    canvasHeight: number = 0,
    camera?: Camera,
    selectedVertices?: ReadonlySet<number>
  ): void {
    // Vertex snapping: when Ctrl is held in edit mode, snap to nearest unselected vertex
    if (
      ctrlKey &&
      isEditMode &&
      this.vertexStartPositions.size > 0 &&
      camera &&
      selectedVertices &&
      canvasWidth > 0 &&
      canvasHeight > 0
    ) {
      const snapTarget = this.findSnapTarget(
        obj,
        screenX,
        screenY,
        canvasWidth,
        canvasHeight,
        camera,
        selectedVertices
      );

      if (snapTarget) {
        // Calculate the center of selected vertices
        const mesh = obj.mesh;
        let center = Vector3.zero();
        for (const idx of selectedVertices) {
          center = center.add(mesh.vertices[idx].position);
        }
        center = center.div(selectedVertices.size);

        // Calculate offset to move center to snap target
        // Apply axis constraint if active
        let offset = snapTarget.sub(center);
        if (this._axisConstraint === "x") {
          offset = new Vector3(offset.x, 0, 0);
        } else if (this._axisConstraint === "y") {
          offset = new Vector3(0, offset.y, 0);
        } else if (this._axisConstraint === "z") {
          offset = new Vector3(0, 0, offset.z);
        } else if (this._axisConstraint === "yz") {
          // YZ plane: snap Y and Z, keep X
          offset = new Vector3(0, offset.y, offset.z);
        } else if (this._axisConstraint === "xz") {
          // XZ plane: snap X and Z, keep Y
          offset = new Vector3(offset.x, 0, offset.z);
        } else if (this._axisConstraint === "xy") {
          // XY plane: snap X and Y, keep Z
          offset = new Vector3(offset.x, offset.y, 0);
        }

        // Move all selected vertices by the offset
        for (const idx of selectedVertices) {
          const pos = mesh.vertices[idx].position;
          mesh.vertices[idx].position = pos.add(offset);
        }
        mesh.rebuildTriangles();

        // Update gizmo origin
        const modelMatrix = obj.getModelMatrix();
        const newCenter = center.add(offset);
        this._transformOrigin = modelMatrix.transformPoint(newCenter);
        return;
      }
    }

    // Normal grab behavior
    let movement = Vector3.zero();

    // Get local axes if in local space mode
    let xAxis = new Vector3(1, 0, 0);
    let yAxis = new Vector3(0, 1, 0);
    let zAxis = new Vector3(0, 0, 1);

    if (this._axisSpace === "local") {
      const rot = obj.rotation;
      const rotMatrix = Matrix4.rotationY(rot.y)
        .multiply(Matrix4.rotationX(rot.x))
        .multiply(Matrix4.rotationZ(rot.z));
      xAxis = rotMatrix.transformDirection(xAxis);
      yAxis = rotMatrix.transformDirection(yAxis);
      zAxis = rotMatrix.transformDirection(zAxis);
    }

    if (this._axisConstraint === "none") {
      movement = right
        .mul(deltaX * sensitivity)
        .add(up.mul(-deltaY * sensitivity));
    } else if (this._axisConstraint === "x") {
      const amount = getAxisMovement(xAxis);
      movement = xAxis.mul(amount * sensitivity);
    } else if (this._axisConstraint === "y") {
      const amount = getAxisMovement(yAxis);
      movement = yAxis.mul(amount * sensitivity);
    } else if (this._axisConstraint === "z") {
      const amount = getAxisMovement(zAxis);
      movement = zAxis.mul(amount * sensitivity);
    } else if (this._axisConstraint === "yz") {
      // YZ plane: move on Y and Z axes (exclude X)
      const amountY = getAxisMovement(yAxis);
      const amountZ = getAxisMovement(zAxis);
      movement = yAxis
        .mul(amountY * sensitivity)
        .add(zAxis.mul(amountZ * sensitivity));
    } else if (this._axisConstraint === "xz") {
      // XZ plane: move on X and Z axes (exclude Y)
      const amountX = getAxisMovement(xAxis);
      const amountZ = getAxisMovement(zAxis);
      movement = xAxis
        .mul(amountX * sensitivity)
        .add(zAxis.mul(amountZ * sensitivity));
    } else if (this._axisConstraint === "xy") {
      // XY plane: move on X and Y axes (exclude Z)
      const amountX = getAxisMovement(xAxis);
      const amountY = getAxisMovement(yAxis);
      movement = xAxis
        .mul(amountX * sensitivity)
        .add(yAxis.mul(amountY * sensitivity));
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

  /**
   * Find the closest unselected vertex to the mouse pointer for snapping
   */
  private findSnapTarget(
    obj: SceneObject,
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number,
    camera: Camera,
    selectedVertices: ReadonlySet<number>
  ): Vector3 | null {
    const mesh = obj.mesh;
    const modelMatrix = obj.getModelMatrix();
    const viewMatrix = camera.getViewMatrix();
    const projMatrix = camera.getProjectionMatrix(canvasWidth / canvasHeight);
    const mvp = projMatrix.multiply(viewMatrix).multiply(modelMatrix);

    let closestVertex: Vector3 | null = null;
    let closestDist = 30; // Snap radius in pixels

    for (let i = 0; i < mesh.vertices.length; i++) {
      // Skip selected vertices
      if (selectedVertices.has(i)) continue;

      const pos = mesh.vertices[i].position;
      const clip = mvp.transformPoint(pos);

      // Skip vertices behind camera
      if (clip.z < -1 || clip.z > 1) continue;

      // Convert to screen coordinates
      const sx = ((clip.x + 1) / 2) * canvasWidth;
      const sy = ((1 - clip.y) / 2) * canvasHeight;

      // Calculate distance to mouse
      const dx = sx - screenX;
      const dy = sy - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestVertex = pos.clone();
      }
    }

    return closestVertex;
  }

  private updateRotate(
    sensitivity: number,
    getAxisMovement: (axis: Vector3) => number,
    obj: SceneObject,
    isEditMode: boolean
  ): void {
    if (isEditMode && this.vertexStartPositions.size > 0 && this.editPivot) {
      // Edit mode: rotate vertices around pivot
      let axis = new Vector3(0, 0, 1); // Default to Z axis (up in Z-up)
      if (this._axisConstraint === "x") axis = new Vector3(1, 0, 0);
      else if (this._axisConstraint === "y") axis = new Vector3(0, 1, 0);

      const amount = getAxisMovement(axis);
      const angle = amount * sensitivity;

      const mesh = obj.mesh;
      for (const idx of this.vertexStartPositions.keys()) {
        const pos = mesh.vertices[idx].position;
        const relative = pos.sub(this.editPivot);
        const rotated = this.rotateVectorAroundAxis(relative, axis, angle);
        mesh.vertices[idx].position = rotated.add(this.editPivot);
      }
      // Recalculate normals after rotation to update lighting
      mesh.recalculateNormals();
    } else if (this.objectStartRotation) {
      // Object mode: rotate object
      if (this._axisConstraint === "none" || this._axisConstraint === "z") {
        const amount = getAxisMovement(new Vector3(0, 0, 1));
        obj.rotation.z += amount * sensitivity;
      } else if (this._axisConstraint === "x") {
        const amount = getAxisMovement(new Vector3(1, 0, 0));
        obj.rotation.x += amount * sensitivity;
      } else if (this._axisConstraint === "y") {
        const amount = getAxisMovement(new Vector3(0, 1, 0));
        obj.rotation.y += amount * sensitivity;
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
        } else if (this._axisConstraint === "yz") {
          // Scale on YZ plane (exclude X)
          scaled = new Vector3(
            relative.x,
            relative.y * scaleAmount,
            relative.z * scaleAmount
          );
        } else if (this._axisConstraint === "xz") {
          // Scale on XZ plane (exclude Y)
          scaled = new Vector3(
            relative.x * scaleAmount,
            relative.y,
            relative.z * scaleAmount
          );
        } else if (this._axisConstraint === "xy") {
          // Scale on XY plane (exclude Z)
          scaled = new Vector3(
            relative.x * scaleAmount,
            relative.y * scaleAmount,
            relative.z
          );
        } else {
          scaled = relative;
        }

        mesh.vertices[idx].position = scaled.add(this.editPivot);
      }
      // Recalculate normals after scaling to update lighting
      mesh.recalculateNormals();
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
      } else if (this._axisConstraint === "yz") {
        // Scale on YZ plane (exclude X)
        obj.scale = new Vector3(
          obj.scale.x,
          obj.scale.y * scaleAmount,
          obj.scale.z * scaleAmount
        );
      } else if (this._axisConstraint === "xz") {
        // Scale on XZ plane (exclude Y)
        obj.scale = new Vector3(
          obj.scale.x * scaleAmount,
          obj.scale.y,
          obj.scale.z * scaleAmount
        );
      } else if (this._axisConstraint === "xy") {
        // Scale on XY plane (exclude Z)
        obj.scale = new Vector3(
          obj.scale.x * scaleAmount,
          obj.scale.y * scaleAmount,
          obj.scale.z
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
   * Cancel multi-object transform (restore original values)
   */
  cancelMultiObject(objects: SceneObject[]): void {
    if (this._mode === "none") return;

    if (this._mode === "grab" && this.objectStartPositions.size > 0) {
      for (const obj of objects) {
        const startPos = this.objectStartPositions.get(obj.name);
        if (startPos) {
          obj.position = startPos.clone();
        }
      }
    } else if (this._mode === "rotate" && this.objectStartRotations.size > 0) {
      for (const obj of objects) {
        const startRot = this.objectStartRotations.get(obj.name);
        if (startRot) {
          obj.rotation = startRot.clone();
        }
      }
    } else if (this._mode === "scale" && this.objectStartScales.size > 0) {
      for (const obj of objects) {
        const startScale = this.objectStartScales.get(obj.name);
        if (startScale) {
          obj.scale = startScale.clone();
        }
      }
    }

    // Clear state
    this.clearState();

    // Notify callback (null = cancelled)
    this.onCompleteCallback?.(null);
  }

  /**
   * Confirm multi-object transform
   * Returns transform results for all objects for undo history
   */
  confirmMultiObject(
    objects: SceneObject[]
  ): MultiObjectTransformResult | null {
    if (this._mode === "none") return null;

    const results: Array<{
      before: ObjectTransformData;
      after: ObjectTransformData;
    }> = [];

    if (this._mode === "grab" && this.objectStartPositions.size > 0) {
      for (const obj of objects) {
        const startPos = this.objectStartPositions.get(obj.name);
        if (startPos) {
          results.push({
            before: {
              objectName: obj.name,
              position: startPos.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            },
            after: {
              objectName: obj.name,
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            },
          });
        }
      }
    } else if (this._mode === "rotate" && this.objectStartRotations.size > 0) {
      for (const obj of objects) {
        const startRot = this.objectStartRotations.get(obj.name);
        const startPos = this.objectStartPositions.get(obj.name);
        if (startRot) {
          results.push({
            before: {
              objectName: obj.name,
              position: startPos?.clone() ?? obj.position.clone(),
              rotation: startRot.clone(),
              scale: obj.scale.clone(),
            },
            after: {
              objectName: obj.name,
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            },
          });
        }
      }
    } else if (this._mode === "scale" && this.objectStartScales.size > 0) {
      for (const obj of objects) {
        const startScale = this.objectStartScales.get(obj.name);
        if (startScale) {
          results.push({
            before: {
              objectName: obj.name,
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: startScale.clone(),
            },
            after: {
              objectName: obj.name,
              position: obj.position.clone(),
              rotation: obj.rotation.clone(),
              scale: obj.scale.clone(),
            },
          });
        }
      }
    }

    const transformType = this._mode;

    // Clear state
    this.clearState();

    if (results.length === 0) return null;

    return {
      type: "multi-object",
      transformType,
      objects: results,
    };
  }

  /**
   * Check if this is a multi-object transform
   */
  get isMultiObjectTransform(): boolean {
    return (
      this.objectStartPositions.size > 1 ||
      this.objectStartRotations.size > 1 ||
      this.objectStartScales.size > 1
    );
  }

  /**
   * Clear all transform state
   */
  private clearState(): void {
    this._mode = "none";
    this._axisConstraint = "none";
    this._axisSpace = "world";
    this.objectStartPos = null;
    this.objectStartRotation = null;
    this.objectStartScale = null;
    this.objectStartPositions.clear();
    this.objectStartRotations.clear();
    this.objectStartScales.clear();
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
