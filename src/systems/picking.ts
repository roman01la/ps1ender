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
   * Pick an object by testing ray against mesh triangles
   * Uses AABB as early-out, then precise ray-triangle intersection
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

      // Fast early-out using AABB
      const bounds = obj.getWorldBounds();
      const aabbDist = ray.intersectAABB(bounds.min, bounds.max);

      if (aabbDist === null || aabbDist >= closestDist) {
        continue;
      }

      // Precise ray-triangle intersection
      const modelMatrix = obj.getModelMatrix();
      const mesh = obj.mesh;

      for (const tri of mesh.triangles) {
        // Transform triangle vertices to world space
        const v0 = modelMatrix.transformPoint(tri.v0.position);
        const v1 = modelMatrix.transformPoint(tri.v1.position);
        const v2 = modelMatrix.transformPoint(tri.v2.position);

        const dist = ray.intersectTriangle(v0, v1, v2);

        if (dist !== null && dist < closestDist) {
          closestDist = dist;
          closestObj = obj;
        }
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

  /**
   * Check if a face is backfacing relative to camera
   * Returns true if the face normal points away from the camera
   */
  private isFaceBackfacing(
    faceIdx: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    cameraPosition: Vector3
  ): boolean {
    const triangles = mesh.getTrianglesForFace(faceIdx);
    if (triangles.length === 0) return true;

    // Use first triangle to compute face normal
    const triIdx = triangles[0];
    const base = triIdx * 3;
    const i0 = mesh.indices[base];
    const i1 = mesh.indices[base + 1];
    const i2 = mesh.indices[base + 2];

    const p0 = modelMatrix.transformPoint(mesh.vertices[i0].position);
    const p1 = modelMatrix.transformPoint(mesh.vertices[i1].position);
    const p2 = modelMatrix.transformPoint(mesh.vertices[i2].position);

    // Compute face normal
    const edge1 = p1.sub(p0);
    const edge2 = p2.sub(p0);
    const normal = edge1.cross(edge2);

    // Compute view direction (from face center to camera)
    const faceCenter = p0
      .add(p1)
      .add(p2)
      .mul(1 / 3);
    const viewDir = cameraPosition.sub(faceCenter);

    // Face is backfacing if normal points away from camera
    return normal.dot(viewDir) < 0;
  }

  /**
   * Get face indices that share a vertex
   */
  private getFacesForVertex(vertexIdx: number, mesh: Mesh): number[] {
    const faces: number[] = [];
    for (let faceIdx = 0; faceIdx < mesh.faceData.length; faceIdx++) {
      const triangles = mesh.getTrianglesForFace(faceIdx);
      for (const triIdx of triangles) {
        const base = triIdx * 3;
        if (
          mesh.indices[base] === vertexIdx ||
          mesh.indices[base + 1] === vertexIdx ||
          mesh.indices[base + 2] === vertexIdx
        ) {
          faces.push(faceIdx);
          break;
        }
      }
    }
    return faces;
  }

  /**
   * Get face indices that share an edge
   */
  private getFacesForEdge(v0: number, v1: number, mesh: Mesh): number[] {
    const faces: number[] = [];
    for (let faceIdx = 0; faceIdx < mesh.faceData.length; faceIdx++) {
      const triangles = mesh.getTrianglesForFace(faceIdx);
      for (const triIdx of triangles) {
        const base = triIdx * 3;
        const ti0 = mesh.indices[base];
        const ti1 = mesh.indices[base + 1];
        const ti2 = mesh.indices[base + 2];
        const triVerts = [ti0, ti1, ti2];

        // Check if edge is part of this triangle
        if (triVerts.includes(v0) && triVerts.includes(v1)) {
          faces.push(faceIdx);
          break;
        }
      }
    }
    return faces;
  }

  /**
   * Box select vertices - returns all vertex indices within the screen-space box
   * Excludes backfacing vertices (vertices where all adjacent faces are backfacing)
   */
  boxSelectVertices(
    boxMinX: number,
    boxMinY: number,
    boxMaxX: number,
    boxMaxY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): number[] {
    const result: number[] = [];
    const cameraPosition = ctx.camera.position;

    for (let i = 0; i < mesh.vertices.length; i++) {
      const localPos = mesh.vertices[i].position;
      const worldPos = modelMatrix.transformPoint(localPos);
      const screen = this.projectToScreen(worldPos, ctx);

      if (!screen) continue;

      // Check if vertex is within box
      if (
        screen.x >= boxMinX &&
        screen.x <= boxMaxX &&
        screen.y >= boxMinY &&
        screen.y <= boxMaxY
      ) {
        // Check backfacing - vertex is backfacing if ALL adjacent faces are backfacing
        const adjacentFaces = this.getFacesForVertex(i, mesh);
        if (adjacentFaces.length > 0) {
          const allBackfacing = adjacentFaces.every((faceIdx) =>
            this.isFaceBackfacing(faceIdx, mesh, modelMatrix, cameraPosition)
          );
          if (allBackfacing) continue;
        }
        result.push(i);
      }
    }

    return result;
  }

  /**
   * Box select edges - returns all edge keys for edges within the screen-space box
   * An edge is selected if BOTH of its vertices are within the box
   * Excludes backfacing edges (edges where all adjacent faces are backfacing)
   */
  boxSelectEdges(
    boxMinX: number,
    boxMinY: number,
    boxMaxX: number,
    boxMaxY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): string[] {
    const result: string[] = [];
    const cameraPosition = ctx.camera.position;

    // Get all edges
    const edges = getMeshEdges(mesh, true); // Skip quad diagonals

    for (const edge of edges) {
      const pos0 = mesh.vertices[edge.v0].position;
      const pos1 = mesh.vertices[edge.v1].position;

      const world0 = modelMatrix.transformPoint(pos0);
      const world1 = modelMatrix.transformPoint(pos1);

      const screen0 = this.projectToScreen(world0, ctx);
      const screen1 = this.projectToScreen(world1, ctx);

      if (!screen0 || !screen1) continue;

      // Check if both vertices are within box
      const v0InBox =
        screen0.x >= boxMinX &&
        screen0.x <= boxMaxX &&
        screen0.y >= boxMinY &&
        screen0.y <= boxMaxY;
      const v1InBox =
        screen1.x >= boxMinX &&
        screen1.x <= boxMaxX &&
        screen1.y >= boxMinY &&
        screen1.y <= boxMaxY;

      if (v0InBox && v1InBox) {
        // Check backfacing - edge is backfacing if ALL adjacent faces are backfacing
        const adjacentFaces = this.getFacesForEdge(edge.v0, edge.v1, mesh);
        if (adjacentFaces.length > 0) {
          const allBackfacing = adjacentFaces.every((faceIdx) =>
            this.isFaceBackfacing(faceIdx, mesh, modelMatrix, cameraPosition)
          );
          if (allBackfacing) continue;
        }
        result.push(makeEdgeKey(edge.v0, edge.v1));
      }
    }

    return result;
  }

  /**
   * Box select faces - returns all face indices for faces within the screen-space box
   * A face is selected if ALL of its vertices are within the box
   * Excludes backfacing faces
   */
  boxSelectFaces(
    boxMinX: number,
    boxMinY: number,
    boxMaxX: number,
    boxMaxY: number,
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: PickContext
  ): number[] {
    const result: number[] = [];
    const cameraPosition = ctx.camera.position;

    // Use logical faces (handles quads properly)
    for (let faceIdx = 0; faceIdx < mesh.faceData.length; faceIdx++) {
      // Skip backfacing faces
      if (this.isFaceBackfacing(faceIdx, mesh, modelMatrix, cameraPosition)) {
        continue;
      }

      const triangles = mesh.getTrianglesForFace(faceIdx);
      if (triangles.length === 0) continue;

      // Collect all unique vertices in this logical face
      const vertexSet = new Set<number>();
      for (const triIdx of triangles) {
        const base = triIdx * 3;
        vertexSet.add(mesh.indices[base]);
        vertexSet.add(mesh.indices[base + 1]);
        vertexSet.add(mesh.indices[base + 2]);
      }

      // Check if all vertices are within box
      let allInBox = true;
      for (const vIdx of vertexSet) {
        const localPos = mesh.vertices[vIdx].position;
        const worldPos = modelMatrix.transformPoint(localPos);
        const screen = this.projectToScreen(worldPos, ctx);

        if (!screen) {
          allInBox = false;
          break;
        }

        if (
          screen.x < boxMinX ||
          screen.x > boxMaxX ||
          screen.y < boxMinY ||
          screen.y > boxMaxY
        ) {
          allInBox = false;
          break;
        }
      }

      if (allInBox) {
        result.push(faceIdx);
      }
    }

    return result;
  }
}
