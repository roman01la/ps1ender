/**
 * Visualization System - Handles edit mode visualization data generation
 *
 * This system manages:
 * - Transform gizmo rendering data
 * - Viewport axis indicator
 * - Vertex point visualization (with depth occlusion)
 * - Edge line visualization (with depth occlusion)
 * - Face highlight visualization (with depth occlusion)
 * - Wireframe overlay
 */

import { Vector3, Matrix4, Color } from "../math";
import { Mesh, Vertex } from "../primitives";
import { Camera } from "../scene";
import { Rasterizer } from "../rasterizer";
import {
  makeEdgeKey,
  parseEdgeKey,
  getPositionKey,
  getMeshEdges as getMeshEdgesUtil,
  POSITION_EPSILON,
  Edge,
} from "../utils/geometry";

// Re-export for backward compatibility
export { makeEdgeKey, parseEdgeKey };
export type { Edge };

/**
 * Gizmo line data for rendering
 */
export interface GizmoData {
  vertices: Vertex[];
  lineIndices: number[];
}

/**
 * Vertex point data for rendering in Edit mode
 */
export interface VertexPointData {
  vertices: Vertex[];
  pointIndices: number[];
}

/**
 * Line data for edges/wireframe rendering
 */
export interface LineData {
  vertices: Vertex[];
  lineIndices: number[];
}

/**
 * Triangle data for filled face rendering
 */
export interface TriangleData {
  vertices: Vertex[];
  triangleIndices: number[];
}

/**
 * Axis constraint type
 */
export type AxisConstraint = "none" | "x" | "y" | "z";

/**
 * Selection mode type
 */
export type SelectionMode = "vertex" | "edge" | "face";

/**
 * Context for visualization with depth buffer
 */
export interface VisualizationContext {
  rasterizer?: Rasterizer;
  viewMatrix?: Matrix4;
  projectionMatrix?: Matrix4;
}

/**
 * Get all unique edges from a mesh
 * @param skipQuadDiagonals If true, excludes internal diagonal edges inside quads (Blender-like behavior)
 */
export function getMeshEdges(
  mesh: Mesh,
  skipQuadDiagonals: boolean = false
): Edge[] {
  return getMeshEdgesUtil(mesh, skipQuadDiagonals);
}

/**
 * Visualization Manager - centralizes edit mode visualization data generation
 */
export class VisualizationManager {
  // Colors
  private readonly xAxisColor = new Color(255, 80, 80); // Red
  private readonly yAxisColor = new Color(80, 255, 80); // Green
  private readonly zAxisColor = new Color(80, 80, 255); // Blue
  private readonly activeAxisColor = new Color(255, 255, 80); // Yellow
  private readonly unselectedColor = new Color(64, 64, 64); // Dark gray
  private readonly selectedVertexColor = new Color(255, 255, 255); // White
  private readonly selectedEdgeColor = new Color(255, 128, 0); // Orange
  private readonly unselectedVertexColor = new Color(255, 128, 0); // Orange
  private readonly selectedFaceFillColor = new Color(255, 128, 0); // Orange (for transparent fill)

  /**
   * Check if a point is visible using the depth buffer
   */
  private isPointVisible(
    worldPos: Vector3,
    ctx: VisualizationContext
  ): boolean {
    const { rasterizer, viewMatrix, projectionMatrix } = ctx;
    if (!rasterizer || !viewMatrix || !projectionMatrix) return true;

    const viewPos = viewMatrix.transformPoint(worldPos);
    const clipPos = projectionMatrix.transformPoint(viewPos);

    const screenX = (clipPos.x * 0.5 + 0.5) * rasterizer.renderWidth;
    const screenY = (1 - (clipPos.y * 0.5 + 0.5)) * rasterizer.renderHeight;
    const depth = Math.floor((clipPos.z * 0.5 + 0.5) * 65535);

    return rasterizer.isPointVisible(screenX, screenY, depth);
  }

  /**
   * Create gizmo line data for transform visualization
   */
  createGizmoData(
    center: Vector3,
    size: number,
    axisConstraint: AxisConstraint
  ): GizmoData {
    const vertices: Vertex[] = [];
    const lineIndices: number[] = [];

    // Highlight active axis
    const activeX =
      axisConstraint === "x" ? this.activeAxisColor : this.xAxisColor;
    const activeY =
      axisConstraint === "y" ? this.activeAxisColor : this.yAxisColor;
    const activeZ =
      axisConstraint === "z" ? this.activeAxisColor : this.zAxisColor;

    // X axis
    vertices.push(new Vertex(center.clone(), activeX, Vector3.zero()));
    vertices.push(
      new Vertex(center.add(new Vector3(size, 0, 0)), activeX, Vector3.zero())
    );
    lineIndices.push(0, 1);

    // Y axis
    vertices.push(new Vertex(center.clone(), activeY, Vector3.zero()));
    vertices.push(
      new Vertex(center.add(new Vector3(0, size, 0)), activeY, Vector3.zero())
    );
    lineIndices.push(2, 3);

    // Z axis
    vertices.push(new Vertex(center.clone(), activeZ, Vector3.zero()));
    vertices.push(
      new Vertex(center.add(new Vector3(0, 0, size)), activeZ, Vector3.zero())
    );
    lineIndices.push(4, 5);

    return { vertices, lineIndices };
  }

  /**
   * Create axis indicator for viewport corner (RGB = XYZ)
   */
  createAxisIndicator(
    screenX: number,
    screenY: number,
    size: number,
    camera: Camera
  ): GizmoData {
    const vertices: Vertex[] = [];
    const lineIndices: number[] = [];

    // Use the camera's orientation
    const forward = camera.target.sub(camera.position).normalize();
    const right = forward.cross(new Vector3(0, 1, 0)).normalize();
    const up = right.cross(forward).normalize();

    // Transform world axes to view space for the indicator
    const origin = new Vector3(screenX, screenY, 0);

    // Screen-space directions based on view
    const xDir = new Vector3(right.x, -right.y, 0).normalize().mul(size);
    const yDir = new Vector3(up.x, -up.y, 0).normalize().mul(size);
    const zDir = new Vector3(-forward.x, forward.y, 0).normalize().mul(size);

    // X axis (red)
    vertices.push(new Vertex(origin.clone(), this.xAxisColor, Vector3.zero()));
    vertices.push(
      new Vertex(origin.add(xDir), this.xAxisColor, Vector3.zero())
    );
    lineIndices.push(0, 1);

    // Y axis (green)
    vertices.push(new Vertex(origin.clone(), this.yAxisColor, Vector3.zero()));
    vertices.push(
      new Vertex(origin.add(yDir), this.yAxisColor, Vector3.zero())
    );
    lineIndices.push(2, 3);

    // Z axis (blue)
    vertices.push(new Vertex(origin.clone(), this.zAxisColor, Vector3.zero()));
    vertices.push(
      new Vertex(origin.add(zDir), this.zAxisColor, Vector3.zero())
    );
    lineIndices.push(4, 5);

    return { vertices, lineIndices };
  }

  /**
   * Create vertex point data for rendering in Edit mode
   * Uses depth-based occlusion - vertices behind other geometry are hidden
   */
  createVertexPointData(
    mesh: Mesh,
    modelMatrix: Matrix4,
    selectedVertices: ReadonlySet<number>,
    ctx: VisualizationContext
  ): VertexPointData {
    const vertices: Vertex[] = [];
    const pointIndices: number[] = [];

    // First pass: add unselected vertices
    for (let i = 0; i < mesh.vertices.length; i++) {
      if (selectedVertices.has(i)) continue; // Skip selected, add them later

      const localPos = mesh.vertices[i].position;
      const worldPos = modelMatrix.transformPoint(localPos);

      // Check visibility using depth buffer
      if (!this.isPointVisible(worldPos, ctx)) continue;

      const newIndex = vertices.length;
      vertices.push(
        new Vertex(worldPos, this.unselectedVertexColor, Vector3.zero())
      );
      pointIndices.push(newIndex);
    }

    // Second pass: add selected vertices (rendered on top)
    for (let i = 0; i < mesh.vertices.length; i++) {
      if (!selectedVertices.has(i)) continue; // Only selected

      const localPos = mesh.vertices[i].position;
      const worldPos = modelMatrix.transformPoint(localPos);

      // Check visibility using depth buffer
      if (!this.isPointVisible(worldPos, ctx)) continue;

      const newIndex = vertices.length;
      vertices.push(
        new Vertex(worldPos, this.selectedVertexColor, Vector3.zero())
      );
      pointIndices.push(newIndex);
    }

    return { vertices, pointIndices };
  }

  /**
   * Create wireframe data for vertex edit mode (shows edges with depth-based occlusion)
   * Skips internal quad diagonals for Blender-like display
   */
  createVertexWireframeData(
    mesh: Mesh,
    modelMatrix: Matrix4,
    ctx: VisualizationContext
  ): LineData {
    const vertices: Vertex[] = [];
    const lineIndices: number[] = [];

    // Get all edges, skipping quad diagonals
    const edges = getMeshEdges(mesh, true);

    for (const edge of edges) {
      const p0 = modelMatrix.transformPoint(mesh.vertices[edge.v0].position);
      const p1 = modelMatrix.transformPoint(mesh.vertices[edge.v1].position);

      // Check if both vertices are visible
      if (!this.isPointVisible(p0, ctx) || !this.isPointVisible(p1, ctx))
        continue;

      const idx = vertices.length;
      vertices.push(new Vertex(p0, this.unselectedColor, Vector3.zero()));
      vertices.push(new Vertex(p1, this.unselectedColor, Vector3.zero()));
      lineIndices.push(idx, idx + 1);
    }

    return { vertices, lineIndices };
  }

  /**
   * Create edge line data for rendering in Edit mode (edge selection mode)
   * Uses depth-based occlusion - edges behind other geometry are hidden
   * Skips internal quad diagonals for Blender-like display
   */
  createEdgeLineData(
    mesh: Mesh,
    modelMatrix: Matrix4,
    selectedEdges: ReadonlySet<string>,
    ctx: VisualizationContext
  ): LineData {
    const vertices: Vertex[] = [];
    const lineIndices: number[] = [];

    // Get all edges, skipping quad diagonals
    const edges = getMeshEdges(mesh, true);

    // First pass: unselected edges
    for (const edge of edges) {
      const edgeKey = makeEdgeKey(edge.v0, edge.v1);
      if (selectedEdges.has(edgeKey)) continue;

      const p0 = modelMatrix.transformPoint(mesh.vertices[edge.v0].position);
      const p1 = modelMatrix.transformPoint(mesh.vertices[edge.v1].position);

      // Depth-based occlusion: both vertices must be visible
      if (!this.isPointVisible(p0, ctx) || !this.isPointVisible(p1, ctx))
        continue;

      const idx = vertices.length;
      vertices.push(new Vertex(p0, this.unselectedColor, Vector3.zero()));
      vertices.push(new Vertex(p1, this.unselectedColor, Vector3.zero()));
      lineIndices.push(idx, idx + 1);
    }

    // Second pass: selected edges (rendered on top)
    for (const edgeKey of selectedEdges) {
      const [v0, v1] = parseEdgeKey(edgeKey);

      const p0 = modelMatrix.transformPoint(mesh.vertices[v0].position);
      const p1 = modelMatrix.transformPoint(mesh.vertices[v1].position);

      // Depth-based occlusion: both vertices must be visible
      if (!this.isPointVisible(p0, ctx) || !this.isPointVisible(p1, ctx))
        continue;

      const idx = vertices.length;
      vertices.push(new Vertex(p0, this.selectedEdgeColor, Vector3.zero()));
      vertices.push(new Vertex(p1, this.selectedEdgeColor, Vector3.zero()));
      lineIndices.push(idx, idx + 1);
    }

    return { vertices, lineIndices };
  }

  /**
   * Create face highlight data for rendering in Edit mode (face selection mode)
   * Returns line data for face outlines with depth-based occlusion
   * Works with logical faces (quads/tris) instead of individual triangles
   */
  createFaceHighlightData(
    mesh: Mesh,
    modelMatrix: Matrix4,
    selectedFaces: ReadonlySet<number>,
    ctx: VisualizationContext
  ): LineData {
    const vertices: Vertex[] = [];
    const lineIndices: number[] = [];

    // Helper to add triangle outline
    const addTriangleOutline = (triIdx: number, color: Color) => {
      const baseIdx = triIdx * 3;
      if (baseIdx + 2 >= mesh.indices.length) return false;

      const i0 = mesh.indices[baseIdx];
      const i1 = mesh.indices[baseIdx + 1];
      const i2 = mesh.indices[baseIdx + 2];

      const p0 = modelMatrix.transformPoint(mesh.vertices[i0].position);
      const p1 = modelMatrix.transformPoint(mesh.vertices[i1].position);
      const p2 = modelMatrix.transformPoint(mesh.vertices[i2].position);

      // Check face centroid visibility for occlusion
      const centroid = new Vector3(
        (p0.x + p1.x + p2.x) / 3,
        (p0.y + p1.y + p2.y) / 3,
        (p0.z + p1.z + p2.z) / 3
      );
      if (!this.isPointVisible(centroid, ctx)) return false;

      const idx = vertices.length;
      vertices.push(new Vertex(p0, color, Vector3.zero()));
      vertices.push(new Vertex(p1, color, Vector3.zero()));
      vertices.push(new Vertex(p2, color, Vector3.zero()));
      // Triangle edges
      lineIndices.push(idx, idx + 1, idx + 1, idx + 2, idx + 2, idx);
      return true;
    };

    // Helper to add quad outline (outer edges only, no diagonal)
    // Uses position-based matching to handle meshes with duplicate vertices
    const addQuadOutline = (triIdx1: number, triIdx2: number, color: Color) => {
      // Get vertices from both triangles
      const base1 = triIdx1 * 3;
      const base2 = triIdx2 * 3;
      if (base1 + 2 >= mesh.indices.length || base2 + 2 >= mesh.indices.length)
        return false;

      const epsilon = 0.0001;
      const getPosKey = (pos: Vector3): string =>
        `${Math.round(pos.x / epsilon)},${Math.round(
          pos.y / epsilon
        )},${Math.round(pos.z / epsilon)}`;

      // Get positions for all 6 vertices (3 per triangle)
      const verts1 = [
        {
          idx: mesh.indices[base1],
          pos: mesh.vertices[mesh.indices[base1]].position,
        },
        {
          idx: mesh.indices[base1 + 1],
          pos: mesh.vertices[mesh.indices[base1 + 1]].position,
        },
        {
          idx: mesh.indices[base1 + 2],
          pos: mesh.vertices[mesh.indices[base1 + 2]].position,
        },
      ];
      const verts2 = [
        {
          idx: mesh.indices[base2],
          pos: mesh.vertices[mesh.indices[base2]].position,
        },
        {
          idx: mesh.indices[base2 + 1],
          pos: mesh.vertices[mesh.indices[base2 + 1]].position,
        },
        {
          idx: mesh.indices[base2 + 2],
          pos: mesh.vertices[mesh.indices[base2 + 2]].position,
        },
      ];

      const posKeys1 = verts1.map((v) => getPosKey(v.pos));
      const posKeys2 = verts2.map((v) => getPosKey(v.pos));

      // Find shared positions (the diagonal edge) and unique positions (the 4 corners)
      const sharedPositions: Vector3[] = [];
      const uniquePos1: Vector3[] = [];
      const uniquePos2: Vector3[] = [];

      for (let i = 0; i < 3; i++) {
        if (posKeys2.includes(posKeys1[i])) {
          sharedPositions.push(verts1[i].pos);
        } else {
          uniquePos1.push(verts1[i].pos);
        }
      }
      for (let i = 0; i < 3; i++) {
        if (!posKeys1.includes(posKeys2[i])) {
          uniquePos2.push(verts2[i].pos);
        }
      }

      if (
        sharedPositions.length !== 2 ||
        uniquePos1.length !== 1 ||
        uniquePos2.length !== 1
      ) {
        // Not a proper quad, fall back to drawing both triangles
        addTriangleOutline(triIdx1, color);
        addTriangleOutline(triIdx2, color);
        return true;
      }

      // Build quad corners: unique1, shared[0], unique2, shared[1]
      const quadCorners = [
        uniquePos1[0],
        sharedPositions[0],
        uniquePos2[0],
        sharedPositions[1],
      ];
      const positions = quadCorners.map((p) => modelMatrix.transformPoint(p));

      // Check centroid visibility
      const centroid = new Vector3(
        (positions[0].x + positions[1].x + positions[2].x + positions[3].x) / 4,
        (positions[0].y + positions[1].y + positions[2].y + positions[3].y) / 4,
        (positions[0].z + positions[1].z + positions[2].z + positions[3].z) / 4
      );
      if (!this.isPointVisible(centroid, ctx)) return false;

      const idx = vertices.length;
      vertices.push(new Vertex(positions[0], color, Vector3.zero()));
      vertices.push(new Vertex(positions[1], color, Vector3.zero()));
      vertices.push(new Vertex(positions[2], color, Vector3.zero()));
      vertices.push(new Vertex(positions[3], color, Vector3.zero()));

      // Quad outline (4 edges)
      lineIndices.push(
        idx,
        idx + 1,
        idx + 1,
        idx + 2,
        idx + 2,
        idx + 3,
        idx + 3,
        idx
      );
      return true;
    };

    // First pass: unselected logical faces
    for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
      if (selectedFaces.has(faceIdx)) continue;

      const face = mesh.faces[faceIdx];
      if (face.isQuad && face.triangles.length === 2) {
        addQuadOutline(
          face.triangles[0],
          face.triangles[1],
          this.unselectedColor
        );
      } else {
        for (const triIdx of face.triangles) {
          addTriangleOutline(triIdx, this.unselectedColor);
        }
      }
    }

    // Second pass: selected logical faces (rendered on top)
    for (const faceIdx of selectedFaces) {
      if (faceIdx >= mesh.faces.length) continue;

      const face = mesh.faces[faceIdx];
      if (face.isQuad && face.triangles.length === 2) {
        addQuadOutline(
          face.triangles[0],
          face.triangles[1],
          this.selectedEdgeColor
        );
      } else {
        for (const triIdx of face.triangles) {
          addTriangleOutline(triIdx, this.selectedEdgeColor);
        }
      }
    }

    return { vertices, lineIndices };
  }

  /**
   * Create filled triangle data for selected faces (transparent highlight)
   * Returns triangle vertices for rendering with alpha blending
   */
  createSelectedFaceFillData(
    mesh: Mesh,
    modelMatrix: Matrix4,
    selectedFaces: ReadonlySet<number>,
    ctx: VisualizationContext
  ): TriangleData | null {
    if (selectedFaces.size === 0) return null;

    const vertices: Vertex[] = [];
    const triangleIndices: number[] = [];

    // Helper to add a triangle fill
    const addTriangleFill = (triIdx: number) => {
      const baseIdx = triIdx * 3;
      if (baseIdx + 2 >= mesh.indices.length) return;

      const i0 = mesh.indices[baseIdx];
      const i1 = mesh.indices[baseIdx + 1];
      const i2 = mesh.indices[baseIdx + 2];

      const p0 = modelMatrix.transformPoint(mesh.vertices[i0].position);
      const p1 = modelMatrix.transformPoint(mesh.vertices[i1].position);
      const p2 = modelMatrix.transformPoint(mesh.vertices[i2].position);

      // Check face centroid visibility for occlusion
      const centroid = new Vector3(
        (p0.x + p1.x + p2.x) / 3,
        (p0.y + p1.y + p2.y) / 3,
        (p0.z + p1.z + p2.z) / 3
      );
      if (!this.isPointVisible(centroid, ctx)) return;

      const idx = vertices.length;
      vertices.push(new Vertex(p0, this.selectedFaceFillColor, Vector3.zero()));
      vertices.push(new Vertex(p1, this.selectedFaceFillColor, Vector3.zero()));
      vertices.push(new Vertex(p2, this.selectedFaceFillColor, Vector3.zero()));
      triangleIndices.push(idx, idx + 1, idx + 2);
    };

    // Add triangles for all selected faces
    for (const faceIdx of selectedFaces) {
      if (faceIdx >= mesh.faces.length) continue;

      const face = mesh.faces[faceIdx];
      for (const triIdx of face.triangles) {
        addTriangleFill(triIdx);
      }
    }

    if (vertices.length === 0) return null;

    return { vertices, triangleIndices };
  }
}
