import { Vector3, Matrix4, Color } from "./math";
import { Mesh, Vertex, Triangle } from "./primitives";

/**
 * A scene object that can be transformed and rendered
 */
export class SceneObject {
  public name: string;
  public mesh: Mesh;
  public position: Vector3;
  public rotation: Vector3; // Euler angles in radians
  public scale: Vector3;
  public selected: boolean = false;
  public visible: boolean = true;

  constructor(name: string, mesh: Mesh) {
    this.name = name;
    this.mesh = mesh;
    this.position = Vector3.zero();
    this.rotation = Vector3.zero();
    this.scale = new Vector3(1, 1, 1);
  }

  /**
   * Get the model matrix for this object
   */
  getModelMatrix(): Matrix4 {
    return Matrix4.translation(
      this.position.x,
      this.position.y,
      this.position.z
    )
      .multiply(Matrix4.rotationY(this.rotation.y))
      .multiply(Matrix4.rotationX(this.rotation.x))
      .multiply(Matrix4.rotationZ(this.rotation.z))
      .multiply(Matrix4.scaling(this.scale.x, this.scale.y, this.scale.z));
  }

  /**
   * Get axis-aligned bounding box in world space
   */
  getWorldBounds(): { min: Vector3; max: Vector3 } {
    const localBounds = this.mesh.getBounds();
    const modelMatrix = this.getModelMatrix();

    // Transform all 8 corners of the local AABB
    const corners = [
      new Vector3(localBounds.min.x, localBounds.min.y, localBounds.min.z),
      new Vector3(localBounds.max.x, localBounds.min.y, localBounds.min.z),
      new Vector3(localBounds.min.x, localBounds.max.y, localBounds.min.z),
      new Vector3(localBounds.max.x, localBounds.max.y, localBounds.min.z),
      new Vector3(localBounds.min.x, localBounds.min.y, localBounds.max.z),
      new Vector3(localBounds.max.x, localBounds.min.y, localBounds.max.z),
      new Vector3(localBounds.min.x, localBounds.max.y, localBounds.max.z),
      new Vector3(localBounds.max.x, localBounds.max.y, localBounds.max.z),
    ];

    const worldMin = new Vector3(Infinity, Infinity, Infinity);
    const worldMax = new Vector3(-Infinity, -Infinity, -Infinity);

    for (const corner of corners) {
      const worldCorner = modelMatrix.transformPoint(corner);
      worldMin.x = Math.min(worldMin.x, worldCorner.x);
      worldMin.y = Math.min(worldMin.y, worldCorner.y);
      worldMin.z = Math.min(worldMin.z, worldCorner.z);
      worldMax.x = Math.max(worldMax.x, worldCorner.x);
      worldMax.y = Math.max(worldMax.y, worldCorner.y);
      worldMax.z = Math.max(worldMax.z, worldCorner.z);
    }

    return { min: worldMin, max: worldMax };
  }

  /**
   * Get center in world space
   */
  getWorldCenter(): Vector3 {
    const bounds = this.getWorldBounds();
    return new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2
    );
  }
}

/**
 * Camera for viewing the scene
 */
export class Camera {
  public position: Vector3;
  public target: Vector3;
  public up: Vector3;
  public fov: number; // Field of view in degrees
  public near: number;
  public far: number;
  public orthographic: boolean = false;
  public orthoSize: number = 5; // Half-height of orthographic view

  constructor() {
    this.position = new Vector3(5, 5, 5);
    this.target = Vector3.zero();
    this.up = new Vector3(0, 1, 0);
    this.fov = 60;
    this.near = 0.1;
    this.far = 100;
  }

  getViewMatrix(): Matrix4 {
    return Matrix4.lookAt(this.position, this.target, this.up);
  }

  getProjectionMatrix(aspectRatio: number): Matrix4 {
    if (this.orthographic) {
      const halfHeight = this.orthoSize;
      const halfWidth = halfHeight * aspectRatio;
      return Matrix4.orthographic(
        -halfWidth,
        halfWidth,
        -halfHeight,
        halfHeight,
        this.near,
        this.far
      );
    }
    return Matrix4.perspective(
      (this.fov * Math.PI) / 180,
      aspectRatio,
      this.near,
      this.far
    );
  }

  /**
   * Orbit camera around target
   */
  orbit(deltaTheta: number, deltaPhi: number): void {
    const offset = this.position.sub(this.target);
    const radius = offset.length();

    // Current angles
    let theta = Math.atan2(offset.x, offset.z);
    let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)));

    // Apply deltas
    theta += deltaTheta;
    phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + deltaPhi));

    // Convert back to position
    this.position = new Vector3(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
  }

  /**
   * Zoom camera (move closer/farther from target)
   */
  zoom(delta: number): void {
    if (this.orthographic) {
      // In ortho mode, adjust orthoSize instead of moving camera
      this.orthoSize = Math.max(1, this.orthoSize + delta * 0.1);
      return;
    }
    const direction = this.target.sub(this.position).normalize();
    const distance = this.position.sub(this.target).length();
    const newDistance = Math.max(1, distance - delta);
    this.position = this.target.sub(direction.mul(newDistance));
  }

  /**
   * Pan camera (move target and position together)
   */
  pan(deltaX: number, deltaY: number): void {
    const forward = this.target.sub(this.position).normalize();
    const right = forward.cross(this.up).normalize();
    const up = right.cross(forward).normalize();

    const offset = right.mul(-deltaX).add(up.mul(deltaY));
    this.position = this.position.add(offset);
    this.target = this.target.add(offset);
  }

  /**
   * Set camera to a predefined viewpoint (Blender-style)
   */
  setViewpoint(
    view: "front" | "back" | "right" | "left" | "top" | "bottom" | "persp"
  ): void {
    const distance = this.position.sub(this.target).length();

    switch (view) {
      case "front": // Numpad 1: -Z looking at +Z
        this.position = new Vector3(
          this.target.x,
          this.target.y,
          this.target.z - distance
        );
        this.up = new Vector3(0, 1, 0);
        this.orthographic = true;
        break;
      case "back": // Ctrl+Numpad 1: +Z looking at -Z
        this.position = new Vector3(
          this.target.x,
          this.target.y,
          this.target.z + distance
        );
        this.up = new Vector3(0, 1, 0);
        this.orthographic = true;
        break;
      case "right": // Numpad 3: +X looking at -X
        this.position = new Vector3(
          this.target.x + distance,
          this.target.y,
          this.target.z
        );
        this.up = new Vector3(0, 1, 0);
        this.orthographic = true;
        break;
      case "left": // Ctrl+Numpad 3: -X looking at +X
        this.position = new Vector3(
          this.target.x - distance,
          this.target.y,
          this.target.z
        );
        this.up = new Vector3(0, 1, 0);
        this.orthographic = true;
        break;
      case "top": // Numpad 7: +Y looking down
        this.position = new Vector3(
          this.target.x,
          this.target.y + distance,
          this.target.z
        );
        this.up = new Vector3(0, 0, -1);
        this.orthographic = true;
        break;
      case "bottom": // Ctrl+Numpad 7: -Y looking up
        this.position = new Vector3(
          this.target.x,
          this.target.y - distance,
          this.target.z
        );
        this.up = new Vector3(0, 0, 1);
        this.orthographic = true;
        break;
      case "persp": // Numpad 0: perspective view
        this.position = new Vector3(
          this.target.x + distance * 0.577,
          this.target.y + distance * 0.577,
          this.target.z + distance * 0.577
        );
        this.up = new Vector3(0, 1, 0);
        this.orthographic = false;
        break;
    }
  }
}

/**
 * The main scene containing all objects
 */
export class Scene {
  public objects: SceneObject[] = [];
  public camera: Camera;
  public gridSize: number = 10;
  public gridDivisions: number = 10;

  constructor() {
    this.camera = new Camera();
  }

  /**
   * Add an object to the scene
   */
  addObject(obj: SceneObject): void {
    this.objects.push(obj);
  }

  /**
   * Remove an object from the scene
   */
  removeObject(obj: SceneObject): void {
    const index = this.objects.indexOf(obj);
    if (index !== -1) {
      this.objects.splice(index, 1);
    }
  }

  /**
   * Get currently selected objects
   */
  getSelectedObjects(): SceneObject[] {
    return this.objects.filter((obj) => obj.selected);
  }

  /**
   * Select an object (optionally clearing previous selection)
   */
  selectObject(obj: SceneObject | null, addToSelection: boolean = false): void {
    if (!addToSelection) {
      // Deselect all
      for (const o of this.objects) {
        o.selected = false;
      }
    }
    if (obj) {
      obj.selected = true;
    }
  }

  /**
   * Deselect all objects
   */
  deselectAll(): void {
    for (const obj of this.objects) {
      obj.selected = false;
    }
  }

  /**
   * Create grid line data for rendering (not a Mesh - grids are lines, not triangles)
   */
  createGridLines(): { vertices: Vertex[]; lineIndices: number[] } {
    const vertices: Vertex[] = [];
    const lineIndices: number[] = [];
    const halfSize = this.gridSize / 2;
    const step = this.gridSize / this.gridDivisions;

    const gridColor = new Color(80, 80, 80);
    const axisColorX = new Color(150, 50, 50); // Red for X
    const axisColorZ = new Color(50, 50, 150); // Blue for Z

    let vertexIndex = 0;

    // Create grid lines along X axis
    for (let i = 0; i <= this.gridDivisions; i++) {
      const z = -halfSize + i * step;
      const isCenter = Math.abs(z) < 0.001;
      const color = isCenter ? axisColorX : gridColor;

      vertices.push(
        new Vertex(new Vector3(-halfSize, 0, z), color, new Vector3(0, 1, 0))
      );
      vertices.push(
        new Vertex(new Vector3(halfSize, 0, z), color, new Vector3(0, 1, 0))
      );
      lineIndices.push(vertexIndex, vertexIndex + 1);
      vertexIndex += 2;
    }

    // Create grid lines along Z axis
    for (let i = 0; i <= this.gridDivisions; i++) {
      const x = -halfSize + i * step;
      const isCenter = Math.abs(x) < 0.001;
      const color = isCenter ? axisColorZ : gridColor;

      vertices.push(
        new Vertex(new Vector3(x, 0, -halfSize), color, new Vector3(0, 1, 0))
      );
      vertices.push(
        new Vertex(new Vector3(x, 0, halfSize), color, new Vector3(0, 1, 0))
      );
      lineIndices.push(vertexIndex, vertexIndex + 1);
      vertexIndex += 2;
    }

    return { vertices, lineIndices };
  }
}
