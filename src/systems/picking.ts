/**
 * Picking System - Handles ray casting and element picking
 *
 * This system manages:
 * - Screen to ray conversion
 * - Object picking (AABB intersection)
 * - Vertex picking (screen distance)
 * - Edge picking (point to segment distance)
 * - Face picking (triangle hit test)
 * - 3D to screen projection
 */

import { Vector3, Matrix4, Ray } from "../math";
import { Mesh } from "../primitives";
import { SceneObject, Camera } from "../scene";
import {
  makeEdgeKey,
  parseEdgeKey,
  getMeshEdges as getMeshEdgesUtil,
} from "../utils/geometry";

// Re-export for backward compatibility
export { makeEdgeKey, parseEdgeKey };

/**
 * Result of projecting a 3D point to screen
 */
export interface ScreenPoint {
  x: number;
  y: number;
  z: number; // Clip space Z for depth testing
}

/**
 * Edge representation for picking
 */
export interface PickEdge {
  v0: number;
  v1: number;
}

/**
 * Picking context with camera and canvas info
 */
export interface PickContext {
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Get all unique edges from a mesh
 * @param skipQuadDiagonals If true, excludes internal diagonal edges inside quads
 */
export function getMeshEdges(
  mesh: Mesh,
  skipQuadDiagonals: boolean = false
): PickEdge[] {
  return getMeshEdgesUtil(mesh, skipQuadDiagonals);
}

/**
 * Picking Manager - centralizes all picking/raycasting operations
 */
export class PickingManager {
  // Pick radius in pixels - max distance for selection when clicking in empty space
  public vertexPickRadius: number = 25;
  public edgePickRadius: number = 30;

  /**
   * Create a ray from screen coordinates
   */
  screenToRay(screenX: number, screenY: number, ctx: PickContext): Ray {
    const { camera, canvasWidth, canvasHeight } = ctx;

    // Convert screen coords to NDC (-1 to 1)
    const ndcX = (screenX / canvasWidth) * 2 - 1;
    const ndcY = 1 - (screenY / canvasHeight) * 2; // Flip Y

    // Get inverse view-projection matrix
    const aspectRatio = canvasWidth / canvasHeight;
    const viewMatrix = camera.getViewMatrix();
    const projMatrix = camera.getProjectionMatrix(aspectRatio);
    const vpMatrix = projMatrix.multiply(viewMatrix);
    const invVP = vpMatrix.invert();

    if (!invVP) {
      // Fallback if matrix is singular
      return new Ray(camera.position, camera.target.sub(camera.position));
    }

    // Unproject near and far points
    const nearPoint = invVP.transformPoint(new Vector3(ndcX, ndcY, -1));
    const farPoint = invVP.transformPoint(new Vector3(ndcX, ndcY, 1));

    const direction = farPoint.sub(nearPoint).normalize();
    return new Ray(nearPoint, direction);
  }

  /**
   * Project a 3D point to screen coordinates
   */
  projectToScreen(point: Vector3, ctx: PickContext): ScreenPoint | null {
    const { camera, canvasWidth, canvasHeight } = ctx;
    const aspectRatio = canvasWidth / canvasHeight;
    const viewMatrix = camera.getViewMatrix();
    const projMatrix = camera.getProjectionMatrix(aspectRatio);
    const vpMatrix = projMatrix.multiply(viewMatrix);

    const clip = vpMatrix.transformPoint(point);

    // Check if behind camera
    if (clip.z < -1 || clip.z > 1) return null;

    const screenX = ((clip.x + 1) / 2) * canvasWidth;
    const screenY = ((1 - clip.y) / 2) * canvasHeight;

    return { x: screenX, y: screenY, z: clip.z };
  }

  /**
   * Pick an object by testing ray against AABBs
   */
  pickObject(
    screenX: number,
    screenY: number,
    objects: SceneObject[],
    ctx: PickContext
  ): SceneObject | null {
    const ray = this.screenToRay(screenX, screenY, ctx);

    let closestObj: SceneObject | null = null;
    let closestDist = Infinity;

    for (const obj of objects) {
      if (!obj.visible) continue;

      const bounds = obj.getWorldBounds();
      const dist = ray.intersectAABB(bounds.min, bounds.max);

      if (dist !== null && dist < closestDist) {
        closestDist = dist;
        closestObj = obj;
      }
    }

    return closestObj;
  }

  /**
   * Pick a vertex by finding closest to screen position
   * Returns the vertex index and distance, or null if none within radius
   */
  pickVertexWithDistance(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): { index: number; distance: number } | null {
    let closestIdx: number | null = null;
    let closestDist = this.vertexPickRadius;

    for (let i = 0; i < mesh.vertices.length; i++) {
      const localPos = mesh.vertices[i].position;
      const worldPos = modelMatrix.transformPoint(localPos);
      const screen = this.projectToScreen(worldPos, ctx);

      if (!screen) continue;

      const dist = Math.sqrt(
        (screen.x - screenX) ** 2 + (screen.y - screenY) ** 2
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    return closestIdx !== null
      ? { index: closestIdx, distance: closestDist }
      : null;
  }

  /**
   * Pick a vertex by finding closest to screen position
   */
  pickVertex(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): number | null {
    const result = this.pickVertexWithDistance(
      screenX,
      screenY,
      mesh,
      modelMatrix,
      ctx
    );
    return result ? result.index : null;
  }

  /**
   * Pick an edge by finding closest to screen position
   * Returns the edge key and distance, or null if none within radius
   * Excludes quad diagonal edges (internal edges that shouldn't be selectable)
   */
  pickEdgeWithDistance(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): { edgeKey: string; distance: number } | null {
    // Skip quad diagonals - they shouldn't be pickable
    const edges = getMeshEdges(mesh, true);

    let closestEdge: string | null = null;
    let closestDist = this.edgePickRadius;

    for (const edge of edges) {
      const v0 = mesh.vertices[edge.v0];
      const v1 = mesh.vertices[edge.v1];

      // Transform to world space
      const worldPos0 = modelMatrix.transformPoint(v0.position);
      const worldPos1 = modelMatrix.transformPoint(v1.position);

      // Project to screen
      const screen0 = this.projectToScreen(worldPos0, ctx);
      const screen1 = this.projectToScreen(worldPos1, ctx);

      if (!screen0 || !screen1) continue;
      if (screen0.z < -1 || screen0.z > 1 || screen1.z < -1 || screen1.z > 1)
        continue;

      // Calculate distance from point to line segment
      const dist = this.pointToSegmentDistance(
        screenX,
        screenY,
        screen0.x,
        screen0.y,
        screen1.x,
        screen1.y
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestEdge = makeEdgeKey(edge.v0, edge.v1);
      }
    }

    return closestEdge !== null
      ? { edgeKey: closestEdge, distance: closestDist }
      : null;
  }

  /**
   * Pick an edge by finding closest to screen position
   */
  pickEdge(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): string | null {
    const result = this.pickEdgeWithDistance(
      screenX,
      screenY,
      mesh,
      modelMatrix,
      ctx
    );
    return result ? result.edgeKey : null;
  }

  /**
   * Pick a face by testing point inside triangles
   * Returns logical face index and depth, or null if no face hit
   */
  pickFaceWithDepth(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): { faceIndex: number; depth: number } | null {
    let closestTriangle: number | null = null;
    let closestZ = Infinity;

    for (let i = 0; i < mesh.triangles.length; i++) {
      const tri = mesh.triangles[i];

      // Transform vertices to world space
      const worldPos0 = modelMatrix.transformPoint(tri.v0.position);
      const worldPos1 = modelMatrix.transformPoint(tri.v1.position);
      const worldPos2 = modelMatrix.transformPoint(tri.v2.position);

      // Project to screen
      const screen0 = this.projectToScreen(worldPos0, ctx);
      const screen1 = this.projectToScreen(worldPos1, ctx);
      const screen2 = this.projectToScreen(worldPos2, ctx);

      if (!screen0 || !screen1 || !screen2) continue;

      // Check if point is inside triangle using barycentric coordinates
      if (
        this.pointInTriangle(
          screenX,
          screenY,
          screen0.x,
          screen0.y,
          screen1.x,
          screen1.y,
          screen2.x,
          screen2.y
        )
      ) {
        // Calculate average depth
        const avgZ = (screen0.z + screen1.z + screen2.z) / 3;
        if (avgZ < closestZ) {
          closestZ = avgZ;
          closestTriangle = i;
        }
      }
    }

    // Convert triangle index to logical face index
    if (closestTriangle !== null) {
      return {
        faceIndex: mesh.getFaceForTriangle(closestTriangle),
        depth: closestZ,
      };
    }

    return null;
  }

  /**
   * Pick a face by testing point inside triangles
   * Returns logical face index (quad or triangle), not raw triangle index
   */
  pickFace(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): number | null {
    const result = this.pickFaceWithDepth(
      screenX,
      screenY,
      mesh,
      modelMatrix,
      ctx
    );
    return result ? result.faceIndex : null;
  }

  /**
   * Find all vertices at the same position as the given vertex (co-located vertices)
   * This handles meshes where vertices are duplicated per-face for normals/UVs
   */
  getColocatedVertices(mesh: Mesh, vertexIdx: number): number[] {
    const targetPos = mesh.vertices[vertexIdx].position;
    const epsilon = 0.0001; // Tolerance for position comparison

    const colocated: number[] = [];
    for (let i = 0; i < mesh.vertices.length; i++) {
      const pos = mesh.vertices[i].position;
      const dx = Math.abs(pos.x - targetPos.x);
      const dy = Math.abs(pos.y - targetPos.y);
      const dz = Math.abs(pos.z - targetPos.z);

      if (dx < epsilon && dy < epsilon && dz < epsilon) {
        colocated.push(i);
      }
    }

    return colocated;
  }

  /**
   * Calculate distance from a point to a line segment (2D)
   */
  private pointToSegmentDistance(
    px: number,
    py: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): number {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      // Segment is a point
      return Math.sqrt((px - x0) ** 2 + (py - y0) ** 2);
    }

    // Project point onto line, clamping to segment
    let t = ((px - x0) * dx + (py - y0) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = x0 + t * dx;
    const projY = y0 + t * dy;

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  /**
   * Check if a point is inside a triangle (2D)
   * Uses barycentric coordinates
   */
  private pointInTriangle(
    px: number,
    py: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): boolean {
    const dX = px - x2;
    const dY = py - y2;
    const dX21 = x2 - x1;
    const dY12 = y1 - y2;
    const D = dY12 * (x0 - x2) + dX21 * (y0 - y2);
    const s = dY12 * dX + dX21 * dY;
    const t = (y2 - y0) * dX + (x0 - x2) * dY;

    if (D < 0) {
      return s <= 0 && t <= 0 && s + t >= D;
    }
    return s >= 0 && t >= 0 && s + t <= D;
  }

  /**
   * Smart picking for vertex mode - Blender-like behavior:
   * When clicking on a face, select the closest vertex to the click point
   * that is on the front side (not behind the clicked face).
   * When clicking in empty space, only select if within pick radius.
   */
  pickVertexSmart(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): number | null {
    // Check if we clicked on a face (with depth info)
    const faceResult = this.pickFaceWithDepth(
      screenX,
      screenY,
      mesh,
      modelMatrix,
      ctx
    );

    if (faceResult !== null) {
      // Clicked on a face - find closest vertex that's in front of or at the face depth
      // Add small tolerance to include vertices on the face itself
      const depthTolerance = 0.01;
      const maxDepth = faceResult.depth + depthTolerance;

      const vertexResult = this.pickVertexWithDepthFilter(
        screenX,
        screenY,
        mesh,
        modelMatrix,
        ctx,
        maxDepth
      );
      return vertexResult ? vertexResult.index : null;
    } else {
      // Clicked in empty space - only select if within pick radius
      const vertexResult = this.pickVertexWithDistanceUnlimited(
        screenX,
        screenY,
        mesh,
        modelMatrix,
        ctx
      );
      if (vertexResult && vertexResult.distance <= this.vertexPickRadius) {
        return vertexResult.index;
      }
      return null;
    }
  }

  /**
   * Smart picking for edge mode - Blender-like behavior:
   * When clicking on a face, select the closest edge to the click point
   * that is on the front side (not behind the clicked face).
   * When clicking in empty space, only select if within pick radius.
   */
  pickEdgeSmart(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): string | null {
    // Check if we clicked on a face (with depth info)
    const faceResult = this.pickFaceWithDepth(
      screenX,
      screenY,
      mesh,
      modelMatrix,
      ctx
    );

    if (faceResult !== null) {
      // Clicked on a face - find closest edge that's in front of or at the face depth
      // Add small tolerance to include edges on the face itself
      const depthTolerance = 0.01;
      const maxDepth = faceResult.depth + depthTolerance;

      const edgeResult = this.pickEdgeWithDepthFilter(
        screenX,
        screenY,
        mesh,
        modelMatrix,
        ctx,
        maxDepth
      );
      return edgeResult ? edgeResult.edgeKey : null;
    } else {
      // Clicked in empty space - only select if within pick radius
      const edgeResult = this.pickEdgeWithDistanceUnlimited(
        screenX,
        screenY,
        mesh,
        modelMatrix,
        ctx
      );
      if (edgeResult && edgeResult.distance <= this.edgePickRadius) {
        return edgeResult.edgeKey;
      }
      return null;
    }
  }

  /**
   * Pick vertex with depth filter - only considers vertices in front of maxDepth
   */
  private pickVertexWithDepthFilter(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext,
    maxDepth: number
  ): { index: number; distance: number } | null {
    let closestIdx: number | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < mesh.vertices.length; i++) {
      const localPos = mesh.vertices[i].position;
      const worldPos = modelMatrix.transformPoint(localPos);
      const screen = this.projectToScreen(worldPos, ctx);

      if (!screen) continue;

      // Skip vertices behind the clicked face
      if (screen.z > maxDepth) continue;

      const dist = Math.sqrt(
        (screen.x - screenX) ** 2 + (screen.y - screenY) ** 2
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    return closestIdx !== null
      ? { index: closestIdx, distance: closestDist }
      : null;
  }

  /**
   * Pick edge with depth filter - only considers edges in front of maxDepth
   * (excludes quad diagonals)
   */
  private pickEdgeWithDepthFilter(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext,
    maxDepth: number
  ): { edgeKey: string; distance: number } | null {
    // Skip quad diagonals - they shouldn't be pickable
    const edges = getMeshEdges(mesh, true);

    let closestEdge: string | null = null;
    let closestDist = Infinity;

    for (const edge of edges) {
      const v0 = mesh.vertices[edge.v0];
      const v1 = mesh.vertices[edge.v1];

      // Transform to world space
      const worldPos0 = modelMatrix.transformPoint(v0.position);
      const worldPos1 = modelMatrix.transformPoint(v1.position);

      // Project to screen
      const screen0 = this.projectToScreen(worldPos0, ctx);
      const screen1 = this.projectToScreen(worldPos1, ctx);

      if (!screen0 || !screen1) continue;
      if (screen0.z < -1 || screen0.z > 1 || screen1.z < -1 || screen1.z > 1)
        continue;

      // Skip edges where both vertices are behind the clicked face
      // (allow edges where at least one vertex is in front)
      if (screen0.z > maxDepth && screen1.z > maxDepth) continue;

      // Calculate distance from point to line segment
      const dist = this.pointToSegmentDistance(
        screenX,
        screenY,
        screen0.x,
        screen0.y,
        screen1.x,
        screen1.y
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestEdge = makeEdgeKey(edge.v0, edge.v1);
      }
    }

    return closestEdge !== null
      ? { edgeKey: closestEdge, distance: closestDist }
      : null;
  }

  /**
   * Pick vertex with distance, no max radius limit
   */
  private pickVertexWithDistanceUnlimited(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): { index: number; distance: number } | null {
    let closestIdx: number | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < mesh.vertices.length; i++) {
      const localPos = mesh.vertices[i].position;
      const worldPos = modelMatrix.transformPoint(localPos);
      const screen = this.projectToScreen(worldPos, ctx);

      if (!screen) continue;

      const dist = Math.sqrt(
        (screen.x - screenX) ** 2 + (screen.y - screenY) ** 2
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    return closestIdx !== null
      ? { index: closestIdx, distance: closestDist }
      : null;
  }

  /**
   * Pick edge with distance, no max radius limit (excludes quad diagonals)
   */
  private pickEdgeWithDistanceUnlimited(
    screenX: number,
    screenY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): { edgeKey: string; distance: number } | null {
    // Skip quad diagonals - they shouldn't be pickable
    const edges = getMeshEdges(mesh, true);

    let closestEdge: string | null = null;
    let closestDist = Infinity;

    for (const edge of edges) {
      const v0 = mesh.vertices[edge.v0];
      const v1 = mesh.vertices[edge.v1];

      // Transform to world space
      const worldPos0 = modelMatrix.transformPoint(v0.position);
      const worldPos1 = modelMatrix.transformPoint(v1.position);

      // Project to screen
      const screen0 = this.projectToScreen(worldPos0, ctx);
      const screen1 = this.projectToScreen(worldPos1, ctx);

      if (!screen0 || !screen1) continue;
      if (screen0.z < -1 || screen0.z > 1 || screen1.z < -1 || screen1.z > 1)
        continue;

      // Calculate distance from point to line segment
      const dist = this.pointToSegmentDistance(
        screenX,
        screenY,
        screen0.x,
        screen0.y,
        screen1.x,
        screen1.y
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestEdge = makeEdgeKey(edge.v0, edge.v1);
      }
    }

    return closestEdge !== null
      ? { edgeKey: closestEdge, distance: closestDist }
      : null;
  }

  /**
   * Box select objects - returns all objects whose screen-space bounds intersect the box
   */
  boxSelectObjects(
    boxMinX: number,
    boxMinY: number,
    boxMaxX: number,
    boxMaxY: number,
    objects: SceneObject[],
    ctx: PickContext
  ): SceneObject[] {
    const result: SceneObject[] = [];

    for (const obj of objects) {
      if (!obj.visible) continue;

      // Get world bounds corners
      const bounds = obj.getWorldBounds();
      const corners = [
        new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
        new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
        new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
        new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
        new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
        new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
        new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
        new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      ];

      // Project all corners to screen and find 2D bounding box
      let screenMinX = Infinity;
      let screenMinY = Infinity;
      let screenMaxX = -Infinity;
      let screenMaxY = -Infinity;
      let hasVisibleCorner = false;

      for (const corner of corners) {
        const screen = this.projectToScreen(corner, ctx);
        if (screen) {
          hasVisibleCorner = true;
          screenMinX = Math.min(screenMinX, screen.x);
          screenMinY = Math.min(screenMinY, screen.y);
          screenMaxX = Math.max(screenMaxX, screen.x);
          screenMaxY = Math.max(screenMaxY, screen.y);
        }
      }

      if (!hasVisibleCorner) continue;

      // Check if the object's screen-space box intersects the selection box
      const intersects =
        screenMinX <= boxMaxX &&
        screenMaxX >= boxMinX &&
        screenMinY <= boxMaxY &&
        screenMaxY >= boxMinY;

      if (intersects) {
        result.push(obj);
      }
    }

    return result;
  }
}
