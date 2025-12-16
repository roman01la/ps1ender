/**
 * Mesh Edit System - Handles mesh editing operations (delete, extrude, etc.)
 *
 * This system manages:
 * - Delete vertices (and affected faces)
 * - Delete edges (faces containing those edges)
 * - Delete faces
 * - Extrude edges
 * - Mesh cleanup (remove unused vertices, remap indices)
 */

import { Mesh, Vertex } from "../primitives";
import { makeEdgeKey, parseEdgeKey, getPositionKey } from "../utils/geometry";

// Re-export for backward compatibility
export { makeEdgeKey, parseEdgeKey };

/**
 * Selection mode for mesh editing
 */
export type SelectionMode = "vertex" | "edge" | "face";

/**
 * Result of a mesh edit operation
 */
export interface MeshEditResult {
  success: boolean;
  deletedFaces: number;
  deletedVertices: number;
}

/**
 * Result of an edge extrusion operation
 */
export interface ExtrudeEdgeResult {
  success: boolean;
  /** New vertex indices that were created (these should be selected for transform) */
  newVertices: Set<number>;
  /** New edges that were created (connecting original to new vertices) */
  newEdges: Set<string>;
}

/**
 * Result of a vertex extrusion operation
 */
export interface ExtrudeVertexResult {
  success: boolean;
  /** New vertex indices that were created (these should be selected for transform) */
  newVertices: Set<number>;
  /** New edges that were created (connecting original to new vertices) */
  newEdges: Set<string>;
}

/**
 * Result of a face extrusion operation
 */
export interface ExtrudeFaceResult {
  success: boolean;
  /** New vertex indices that were created (these should be selected for transform) */
  newVertices: Set<number>;
  /** New face indices that were created */
  newFaces: Set<number>;
}

/**
 * Result of a join vertices operation
 */
export interface JoinVerticesResult {
  success: boolean;
  /** The edge key that was created */
  edgeKey: string;
}

/**
 * Result of a fill edges operation
 */
export interface FillEdgesResult {
  success: boolean;
  /** The face index that was created */
  faceIndex: number;
}

/**
 * Mesh Edit Manager - centralizes mesh editing operations
 */
export class MeshEditManager {
  /**
   * Delete selected vertices and all faces that reference them
   * Returns true if anything was deleted
   */
  deleteVertices(mesh: Mesh, verticesToDelete: Set<number>): MeshEditResult {
    if (verticesToDelete.size === 0) {
      return { success: false, deletedFaces: 0, deletedVertices: 0 };
    }

    // Update faceData (BMesh-style) - filter out faces using deleted vertices
    if (mesh.faceData.length > 0) {
      mesh.faceData = mesh.faceData.filter(
        (face) => !face.vertices.some((v) => verticesToDelete.has(v))
      );
    }

    // Find all faces that use any of these vertices
    const facesToDelete = new Set<number>();
    const numFaces = Math.floor(mesh.indices.length / 3);

    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      const baseIdx = faceIdx * 3;
      const i0 = mesh.indices[baseIdx];
      const i1 = mesh.indices[baseIdx + 1];
      const i2 = mesh.indices[baseIdx + 2];

      if (
        verticesToDelete.has(i0) ||
        verticesToDelete.has(i1) ||
        verticesToDelete.has(i2)
      ) {
        facesToDelete.add(faceIdx);
      }
    }

    // Build new indices array without deleted faces
    const newIndices: number[] = [];
    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      if (!facesToDelete.has(faceIdx)) {
        const baseIdx = faceIdx * 3;
        newIndices.push(mesh.indices[baseIdx]);
        newIndices.push(mesh.indices[baseIdx + 1]);
        newIndices.push(mesh.indices[baseIdx + 2]);
      }
    }

    // Find which vertices are still used
    const usedVertices = new Set<number>(newIndices);

    // Build mapping from old vertex index to new index
    const vertexMapping = new Map<number, number>();
    const newVertices: Vertex[] = [];

    for (let i = 0; i < mesh.vertices.length; i++) {
      if (usedVertices.has(i)) {
        vertexMapping.set(i, newVertices.length);
        newVertices.push(mesh.vertices[i]);
      }
    }

    // Remap indices
    const remappedIndices = newIndices.map((idx) => vertexMapping.get(idx)!);

    // Remap faceData vertex indices (BMesh-style)
    for (const face of mesh.faceData) {
      face.vertices = face.vertices.map((v) => vertexMapping.get(v)!);
    }

    const deletedVertices = mesh.vertices.length - newVertices.length;

    // Update mesh
    mesh.vertices = newVertices;
    mesh.indices = remappedIndices;

    return {
      success: true,
      deletedFaces: facesToDelete.size,
      deletedVertices,
    };
  }

  /**
   * Delete faces that contain any of the selected edges
   * Returns true if anything was deleted
   */
  deleteEdges(mesh: Mesh, selectedEdges: Set<string>): MeshEditResult {
    if (selectedEdges.size === 0) {
      return { success: false, deletedFaces: 0, deletedVertices: 0 };
    }

    // Get all vertex pairs from selected edges
    const edgeVertexPairs: Array<[number, number]> = [];
    for (const edgeKey of selectedEdges) {
      edgeVertexPairs.push(parseEdgeKey(edgeKey));
    }

    // Update faceData (BMesh-style) - filter out faces containing selected edges
    if (mesh.faceData.length > 0) {
      mesh.faceData = mesh.faceData.filter((face) => {
        const verts = face.vertices;
        for (const [v0, v1] of edgeVertexPairs) {
          // Check if both vertices of the edge are in this face and adjacent
          const idx0 = verts.indexOf(v0);
          const idx1 = verts.indexOf(v1);
          if (idx0 !== -1 && idx1 !== -1) {
            // Check if they're adjacent in the face
            const diff = Math.abs(idx0 - idx1);
            if (diff === 1 || diff === verts.length - 1) {
              return false; // Face contains this edge, delete it
            }
          }
        }
        return true;
      });
    }

    // Find all faces that use any of these edges
    const facesToDelete = new Set<number>();
    const numFaces = Math.floor(mesh.indices.length / 3);

    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      const baseIdx = faceIdx * 3;
      const faceVerts = [
        mesh.indices[baseIdx],
        mesh.indices[baseIdx + 1],
        mesh.indices[baseIdx + 2],
      ];

      // Check if any selected edge is part of this face
      for (const [v0, v1] of edgeVertexPairs) {
        const hasV0 = faceVerts.includes(v0);
        const hasV1 = faceVerts.includes(v1);
        if (hasV0 && hasV1) {
          facesToDelete.add(faceIdx);
          break;
        }
      }
    }

    if (facesToDelete.size === 0) {
      return { success: false, deletedFaces: 0, deletedVertices: 0 };
    }

    // Build new indices array without deleted faces
    const newIndices: number[] = [];
    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      if (!facesToDelete.has(faceIdx)) {
        const baseIdx = faceIdx * 3;
        newIndices.push(mesh.indices[baseIdx]);
        newIndices.push(mesh.indices[baseIdx + 1]);
        newIndices.push(mesh.indices[baseIdx + 2]);
      }
    }

    // Find which vertices are still used
    const usedVertices = new Set<number>(newIndices);

    // Build mapping from old vertex index to new index
    const vertexMapping = new Map<number, number>();
    const newVertices: Vertex[] = [];

    for (let i = 0; i < mesh.vertices.length; i++) {
      if (usedVertices.has(i)) {
        vertexMapping.set(i, newVertices.length);
        newVertices.push(mesh.vertices[i]);
      }
    }

    // Remap indices
    const remappedIndices = newIndices.map((idx) => vertexMapping.get(idx)!);

    // Remap faceData vertex indices (BMesh-style)
    for (const face of mesh.faceData) {
      face.vertices = face.vertices.map((v) => vertexMapping.get(v)!);
    }

    const deletedVertices = mesh.vertices.length - newVertices.length;

    // Update mesh
    mesh.vertices = newVertices;
    mesh.indices = remappedIndices;

    return {
      success: true,
      deletedFaces: facesToDelete.size,
      deletedVertices,
    };
  }

  /**
   * Delete selected faces (logical faces - quads or triangles)
   * Converts logical face indices to triangle indices before deleting
   * Also removes from faceData (BMesh-style storage)
   * Returns true if anything was deleted
   */
  deleteFaces(mesh: Mesh, facesToDelete: Set<number>): MeshEditResult {
    if (facesToDelete.size === 0) {
      return { success: false, deletedFaces: 0, deletedVertices: 0 };
    }

    // Convert logical face indices to triangle indices (before faceData is modified)
    const trianglesToDelete = new Set<number>();
    for (const faceIdx of facesToDelete) {
      for (const triIdx of mesh.getTrianglesForFace(faceIdx)) {
        trianglesToDelete.add(triIdx);
      }
    }

    // Update faceData (BMesh-style) - filter out deleted faces
    if (mesh.faceData.length > 0) {
      mesh.faceData = mesh.faceData.filter((_, idx) => !facesToDelete.has(idx));
    }

    const numTriangles = Math.floor(mesh.indices.length / 3);

    // Build new indices array without deleted triangles
    const newIndices: number[] = [];
    for (let triIdx = 0; triIdx < numTriangles; triIdx++) {
      if (!trianglesToDelete.has(triIdx)) {
        const baseIdx = triIdx * 3;
        newIndices.push(mesh.indices[baseIdx]);
        newIndices.push(mesh.indices[baseIdx + 1]);
        newIndices.push(mesh.indices[baseIdx + 2]);
      }
    }

    // Find which vertices are still used
    const usedVertices = new Set<number>(newIndices);

    // Build mapping from old vertex index to new index
    const vertexMapping = new Map<number, number>();
    const newVertices: Vertex[] = [];

    for (let i = 0; i < mesh.vertices.length; i++) {
      if (usedVertices.has(i)) {
        vertexMapping.set(i, newVertices.length);
        newVertices.push(mesh.vertices[i]);
      }
    }

    // Remap indices
    const remappedIndices = newIndices.map((idx) => vertexMapping.get(idx)!);

    // Remap faceData vertex indices (BMesh-style)
    for (const face of mesh.faceData) {
      face.vertices = face.vertices.map((v) => vertexMapping.get(v)!);
    }

    const deletedVertices = mesh.vertices.length - newVertices.length;

    // Update mesh
    mesh.vertices = newVertices;
    mesh.indices = remappedIndices;

    return {
      success: true,
      deletedFaces: facesToDelete.size,
      deletedVertices,
    };
  }

  /**
   * Clean up mesh by removing unused vertices
   * This is useful after other operations that may leave orphaned vertices
   */
  removeUnusedVertices(mesh: Mesh): number {
    // Find which vertices are used
    const usedVertices = new Set<number>(mesh.indices);

    if (usedVertices.size === mesh.vertices.length) {
      return 0; // All vertices are used
    }

    // Build mapping from old vertex index to new index
    const vertexMapping = new Map<number, number>();
    const newVertices: Vertex[] = [];

    for (let i = 0; i < mesh.vertices.length; i++) {
      if (usedVertices.has(i)) {
        vertexMapping.set(i, newVertices.length);
        newVertices.push(mesh.vertices[i]);
      }
    }

    // Remap indices
    mesh.indices = mesh.indices.map((idx) => vertexMapping.get(idx)!);

    // Remap faceData vertex indices (BMesh-style)
    for (const face of mesh.faceData) {
      face.vertices = face.vertices.map((v) => vertexMapping.get(v)!);
    }

    const removedCount = mesh.vertices.length - newVertices.length;
    mesh.vertices = newVertices;

    return removedCount;
  }

  /**
   * Extrude selected vertices - creates new vertices connected by edges
   *
   * Algorithm:
   * 1. Duplicate each selected vertex (initially at same position)
   * 2. Create degenerate triangles to represent edges connecting original to new vertices
   * 3. Return the new vertices so they can be selected for transform
   *
   * Note: This creates "loose" edges (not part of faces) similar to Blender's vertex extrude
   */
  extrudeVertices(
    mesh: Mesh,
    selectedVertices: Set<number>
  ): ExtrudeVertexResult {
    if (selectedVertices.size === 0) {
      return { success: false, newVertices: new Set(), newEdges: new Set() };
    }

    // Map from original vertex index to new duplicated vertex index
    const vertexMapping = new Map<number, number>();
    const newVertexIndices = new Set<number>();
    const newEdges = new Set<string>();

    // Duplicate vertices
    for (const vIdx of selectedVertices) {
      const originalVertex = mesh.vertices[vIdx];
      const newVertex = new Vertex(
        originalVertex.position.clone(),
        originalVertex.color.clone(),
        originalVertex.normal.clone(),
        originalVertex.u,
        originalVertex.v
      );
      const newIdx = mesh.vertices.length;
      mesh.vertices.push(newVertex);
      vertexMapping.set(vIdx, newIdx);
      newVertexIndices.add(newIdx);
    }

    // Create degenerate triangles for each edge (original vertex to new vertex)
    // This creates visible edges without actual faces
    for (const [origIdx, newIdx] of vertexMapping) {
      // Degenerate triangle: [orig, new, orig] creates an edge from orig to new
      mesh.indices.push(origIdx, newIdx, origIdx);

      // Track the new edge
      newEdges.add(makeEdgeKey(origIdx, newIdx));
    }

    // Rebuild mesh triangles and faces
    mesh.rebuildMesh();

    return {
      success: true,
      newVertices: newVertexIndices,
      newEdges,
    };
  }

  /**
   * Join two vertices with an edge
   *
   * Creates a degenerate triangle to represent an edge between the two vertices.
   * Only works with exactly 2 selected vertices.
   */
  joinVertices(mesh: Mesh, selectedVertices: Set<number>): JoinVerticesResult {
    if (selectedVertices.size !== 2) {
      return { success: false, edgeKey: "" };
    }

    const vertices = Array.from(selectedVertices);
    const v0 = vertices[0];
    const v1 = vertices[1];

    // Check if edge already exists
    const edgeKey = makeEdgeKey(v0, v1);
    const numTris = Math.floor(mesh.indices.length / 3);

    for (let i = 0; i < numTris; i++) {
      const base = i * 3;
      const i0 = mesh.indices[base];
      const i1 = mesh.indices[base + 1];
      const i2 = mesh.indices[base + 2];

      // Check all edges of this triangle
      const edges = [
        makeEdgeKey(i0, i1),
        makeEdgeKey(i1, i2),
        makeEdgeKey(i2, i0),
      ];

      if (edges.includes(edgeKey)) {
        // Edge already exists
        return { success: false, edgeKey: "" };
      }
    }

    // Create degenerate triangle to represent the edge
    mesh.indices.push(v0, v1, v0);

    // Rebuild mesh
    mesh.rebuildMesh();

    return {
      success: true,
      edgeKey,
    };
  }

  /**
   * Fill selected edges to create a face
   *
   * Supports:
   * - 2 edges sharing a vertex (creates a triangle)
   * - 2 edges forming opposite sides of a quad (creates a quad if 4 unique vertices)
   * - 3+ edges forming a closed loop (creates a polygon fan)
   */
  fillEdges(mesh: Mesh, selectedEdges: Set<string>): FillEdgesResult {
    if (selectedEdges.size < 2) {
      return { success: false, faceIndex: -1 };
    }

    // Collect all vertices and build adjacency
    const allVertices = new Set<number>();
    const edgeList: Array<[number, number]> = [];
    const vertexToEdges = new Map<number, Array<[number, number]>>();

    for (const edgeKey of selectedEdges) {
      const [v0, v1] = parseEdgeKey(edgeKey);
      allVertices.add(v0);
      allVertices.add(v1);
      edgeList.push([v0, v1]);

      if (!vertexToEdges.has(v0)) vertexToEdges.set(v0, []);
      if (!vertexToEdges.has(v1)) vertexToEdges.set(v1, []);
      vertexToEdges.get(v0)!.push([v0, v1]);
      vertexToEdges.get(v1)!.push([v0, v1]);
    }

    const numVertices = allVertices.size;
    const numEdges = edgeList.length;

    // Special case: 2 edges with 4 unique vertices (quad from opposite edges)
    if (numEdges === 2 && numVertices === 4) {
      const [e1, e2] = edgeList;
      // Create quad: e1[0], e1[1], e2[1], e2[0] or similar ordering
      // Need to find correct winding
      const orderedQuad = this.orderQuadVertices(mesh, e1, e2);
      if (orderedQuad) {
        return this.createFaceFromVertices(mesh, orderedQuad);
      }
    }

    // Special case: 2 edges sharing one vertex (3 vertices)
    // This should create a quad, not a triangle - find the 4th vertex
    if (numEdges === 2 && numVertices === 3) {
      const [e1, e2] = edgeList;
      // Find the shared vertex and the two unshared vertices
      const sharedVertex = this.findSharedVertex(e1, e2);
      if (sharedVertex !== null) {
        const unshared1 = e1[0] === sharedVertex ? e1[1] : e1[0];
        const unshared2 = e2[0] === sharedVertex ? e2[1] : e2[0];
        // Create quad from the 4 vertices: unshared1, shared, unshared2, and find 4th
        // Actually for 2 edges sharing a vertex, we create a triangle
        // But if the user wants a quad, they need to select proper opposite edges
        const vertices = [unshared1, sharedVertex, unshared2];
        return this.createFaceFromVertices(mesh, vertices);
      }
    }

    // Try to find a closed loop or valid polygon
    const orderedVertices = this.findOrderedLoop(
      edgeList,
      vertexToEdges,
      allVertices
    );

    if (orderedVertices.length >= 3) {
      // Create face from ordered vertices
      return this.createFaceFromVertices(mesh, orderedVertices);
    }

    return { success: false, faceIndex: -1 };
  }

  /**
   * Find shared vertex between two edges
   */
  private findSharedVertex(
    e1: [number, number],
    e2: [number, number]
  ): number | null {
    if (e1[0] === e2[0] || e1[0] === e2[1]) return e1[0];
    if (e1[1] === e2[0] || e1[1] === e2[1]) return e1[1];
    return null;
  }

  /**
   * Find an ordered loop of vertices from edges
   */
  private findOrderedLoop(
    edgeList: Array<[number, number]>,
    vertexToEdges: Map<number, Array<[number, number]>>,
    allVertices: Set<number>
  ): number[] {
    if (edgeList.length < 2) return [];

    // Start from first edge
    const visited = new Set<string>();
    const result: number[] = [];

    let currentVertex = edgeList[0][0];
    result.push(currentVertex);

    while (result.length <= allVertices.size) {
      const edges = vertexToEdges.get(currentVertex) || [];
      let foundNext = false;

      for (const [v0, v1] of edges) {
        const edgeKey = makeEdgeKey(v0, v1);
        if (visited.has(edgeKey)) continue;

        visited.add(edgeKey);
        const nextVertex = v0 === currentVertex ? v1 : v0;

        // Check if we've completed the loop
        if (nextVertex === result[0] && result.length >= 3) {
          return result; // Closed loop found
        }

        if (!result.includes(nextVertex)) {
          result.push(nextVertex);
          currentVertex = nextVertex;
          foundNext = true;
          break;
        }
      }

      if (!foundNext) break;
    }

    // Check if we have all vertices and can form a valid polygon
    if (result.length === allVertices.size && result.length >= 3) {
      // Check if there's an edge connecting last to first (closed loop)
      const lastEdgeKey = makeEdgeKey(result[result.length - 1], result[0]);
      for (const [v0, v1] of edgeList) {
        if (makeEdgeKey(v0, v1) === lastEdgeKey) {
          return result; // Valid closed loop
        }
      }
    }

    return [];
  }

  /**
   * Order 4 vertices from 2 opposite edges into a proper quad winding
   * The quad should have the two selected edges as opposite sides, not adjacent
   */
  private orderQuadVertices(
    mesh: Mesh,
    e1: [number, number],
    e2: [number, number]
  ): number[] | null {
    // For a proper quad where e1 and e2 are OPPOSITE edges:
    // The quad order should be: e1[0], e1[1], e2[?], e2[?]
    // This ensures e1 = side A-B, e2 = side C-D (opposite sides)
    // The diagonal will be B-C (connecting e1[1] to e2[first])
    //
    // We need to determine the order of e2 vertices by finding which
    // e2 vertex is closer to e1[1] (they should connect via a new edge)
    const p1b = mesh.vertices[e1[1]].position;
    const p2a = mesh.vertices[e2[0]].position;
    const p2b = mesh.vertices[e2[1]].position;

    const dist1b2a = p1b.sub(p2a).length();
    const dist1b2b = p1b.sub(p2b).length();

    if (dist1b2a <= dist1b2b) {
      // e1[1] is closer to e2[0], so order e2 as [e2[0], e2[1]]
      // Quad: e1[0], e1[1], e2[0], e2[1]
      // Triangles: [e1[0], e1[1], e2[0]] and [e1[0], e2[0], e2[1]]
      // Diagonal: e1[0]-e2[0]
      return [e1[0], e1[1], e2[0], e2[1]];
    } else {
      // e1[1] is closer to e2[1], so order e2 as [e2[1], e2[0]]
      // Quad: e1[0], e1[1], e2[1], e2[0]
      // Triangles: [e1[0], e1[1], e2[1]] and [e1[0], e2[1], e2[0]]
      // Diagonal: e1[0]-e2[1]
      return [e1[0], e1[1], e2[1], e2[0]];
    }
  }

  /**
   * Create a face from ordered vertices
   * Now also updates faceData for BMesh-style face storage
   * Checks adjacent faces to ensure consistent winding
   */
  private createFaceFromVertices(
    mesh: Mesh,
    vertices: number[]
  ): FillEdgesResult {
    if (vertices.length < 3) {
      return { success: false, faceIndex: -1 };
    }

    // Check winding against adjacent faces
    const correctedVertices = this.ensureConsistentWinding(mesh, vertices);

    const faceIndex = mesh.faceData.length;

    // Add to faceData array (BMesh-style)
    mesh.faceData.push({ vertices: [...correctedVertices] });

    // Rebuild mesh from faceData (generates indices and legacy faces)
    mesh.rebuildFromFaces();

    return {
      success: true,
      faceIndex,
    };
  }

  /**
   * Ensure the new face has consistent winding with adjacent faces
   * If a shared edge goes the same direction in both faces, flip the new face
   * Uses position comparison to handle duplicate vertices at same location
   */
  private ensureConsistentWinding(mesh: Mesh, vertices: number[]): number[] {
    // Build edges of the new face with position keys
    const newFaceEdges: Array<{
      p0: string;
      p1: string;
      v0: number;
      v1: number;
    }> = [];
    for (let i = 0; i < vertices.length; i++) {
      const v0 = vertices[i];
      const v1 = vertices[(i + 1) % vertices.length];
      const p0 = getPositionKey(mesh.vertices[v0].position);
      const p1 = getPositionKey(mesh.vertices[v1].position);
      newFaceEdges.push({ p0, p1, v0, v1 });
    }

    // Check each existing face for shared edges
    for (const face of mesh.faceData) {
      const faceVerts = face.vertices;
      if (faceVerts.length < 3) continue;

      // Build edges of existing face with position keys
      for (let i = 0; i < faceVerts.length; i++) {
        const ev0 = faceVerts[i];
        const ev1 = faceVerts[(i + 1) % faceVerts.length];
        const ep0 = getPositionKey(mesh.vertices[ev0].position);
        const ep1 = getPositionKey(mesh.vertices[ev1].position);

        // Check if this edge matches any edge in the new face (by position)
        for (const newEdge of newFaceEdges) {
          // If edges have same positions but SAME direction, winding is inconsistent
          if (ep0 === newEdge.p0 && ep1 === newEdge.p1) {
            // Same direction = inconsistent, need to reverse new face
            return vertices.slice().reverse();
          }
          // If edges have same positions but OPPOSITE direction, winding is consistent
          if (ep0 === newEdge.p1 && ep1 === newEdge.p0) {
            // Opposite direction = consistent, keep as is
            return vertices;
          }
        }
      }
    }

    // No shared edges found, keep original winding
    return vertices;
  }

  /**
   * Extrude selected edges - creates new vertices and quad faces connecting them
   *
   * Algorithm:
   * 1. Collect all unique vertices from selected edges
   * 2. Duplicate these vertices (initially at same position)
   * 3. For each selected edge, create a quad face connecting original edge to new edge
   * 4. Determine face winding by checking adjacent faces for proper normal direction
   * 5. Return the new vertices so they can be selected for transform
   */
  extrudeEdges(mesh: Mesh, selectedEdges: Set<string>): ExtrudeEdgeResult {
    if (selectedEdges.size === 0) {
      return { success: false, newVertices: new Set(), newEdges: new Set() };
    }

    // Collect unique vertices from selected edges
    const edgeVertices = new Set<number>();
    const edgeList: Array<[number, number]> = [];

    for (const edgeKey of selectedEdges) {
      const [v0, v1] = parseEdgeKey(edgeKey);
      edgeVertices.add(v0);
      edgeVertices.add(v1);
      edgeList.push([v0, v1]);
    }

    // Build edge to face mapping to determine winding order
    const edgeToFaces = this.buildEdgeToFaceMap(mesh);

    // Map from original vertex index to new duplicated vertex index
    const vertexMapping = new Map<number, number>();
    const newVertexIndices = new Set<number>();

    // Duplicate vertices
    for (const vIdx of edgeVertices) {
      const originalVertex = mesh.vertices[vIdx];
      const newVertex = new Vertex(
        originalVertex.position.clone(),
        originalVertex.color.clone(),
        originalVertex.normal.clone(),
        originalVertex.u,
        originalVertex.v
      );
      const newIdx = mesh.vertices.length;
      mesh.vertices.push(newVertex);
      vertexMapping.set(vIdx, newIdx);
      newVertexIndices.add(newIdx);
    }

    // Create quad faces for each edge
    const newEdges = new Set<string>();

    for (const [v0, v1] of edgeList) {
      const newV0 = vertexMapping.get(v0)!;
      const newV1 = vertexMapping.get(v1)!;

      // Determine winding order based on adjacent face
      const edgeKey = makeEdgeKey(v0, v1);
      const adjacentFaces = edgeToFaces.get(edgeKey) || [];

      // Default winding - create quad: v0, v1, newV1, newV0
      // Two triangles: (v0, v1, newV1) and (v0, newV1, newV0)
      let windingReversed = false;

      if (adjacentFaces.length > 0) {
        // Check the winding of the adjacent face to determine correct normal direction
        const faceIdx = adjacentFaces[0];
        windingReversed = this.shouldReverseWinding(mesh, faceIdx, v0, v1);
      }

      if (windingReversed) {
        // Quad: v1, v0, newV0, newV1
        mesh.faceData.push({ vertices: [v1, v0, newV0, newV1] });
      } else {
        // Quad: v0, v1, newV1, newV0
        mesh.faceData.push({ vertices: [v0, v1, newV1, newV0] });
      }

      // Track new edges (connecting original to new vertices)
      newEdges.add(makeEdgeKey(v0, newV0));
      newEdges.add(makeEdgeKey(v1, newV1));
      newEdges.add(makeEdgeKey(newV0, newV1));
    }

    // Rebuild mesh from faceData (preserves quad information)
    mesh.rebuildFromFaces();

    return {
      success: true,
      newVertices: newVertexIndices,
      newEdges,
    };
  }

  /**
   * Build a map from edge keys to face indices that contain that edge
   */
  private buildEdgeToFaceMap(mesh: Mesh): Map<string, number[]> {
    const edgeToFaces = new Map<string, number[]>();
    const numFaces = Math.floor(mesh.indices.length / 3);

    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      const baseIdx = faceIdx * 3;
      const i0 = mesh.indices[baseIdx];
      const i1 = mesh.indices[baseIdx + 1];
      const i2 = mesh.indices[baseIdx + 2];

      // Add all three edges of this face
      const edges = [
        makeEdgeKey(i0, i1),
        makeEdgeKey(i1, i2),
        makeEdgeKey(i2, i0),
      ];

      for (const edgeKey of edges) {
        if (!edgeToFaces.has(edgeKey)) {
          edgeToFaces.set(edgeKey, []);
        }
        edgeToFaces.get(edgeKey)!.push(faceIdx);
      }
    }

    return edgeToFaces;
  }

  /**
   * Determine if the winding should be reversed for the extruded quad
   * based on the adjacent face's vertex order
   *
   * If the edge vertices appear in order (v0 then v1) in the adjacent face,
   * we need to reverse winding so the extruded face points outward
   */
  private shouldReverseWinding(
    mesh: Mesh,
    faceIdx: number,
    edgeV0: number,
    edgeV1: number
  ): boolean {
    const baseIdx = faceIdx * 3;
    const i0 = mesh.indices[baseIdx];
    const i1 = mesh.indices[baseIdx + 1];
    const i2 = mesh.indices[baseIdx + 2];

    // Check if this is a degenerate triangle (used for edge-only meshes like circles)
    // Degenerate triangles have the pattern [a, b, a] where a repeats
    if (i0 === i2 && i0 !== i1) {
      // For degenerate triangle [a, b, a], the edge goes from a to b
      // If our edge v0→v1 matches a→b, use default winding
      // If our edge v0→v1 is reversed (b→a or equivalently edgeV0=b, edgeV1=a), reverse winding
      const degenerateEdgeStart = i0;
      const degenerateEdgeEnd = i1;

      // If edgeV0 matches the start of the degenerate edge, use default winding
      // If edgeV0 matches the end (meaning the edge is reversed), reverse winding
      if (edgeV0 === degenerateEdgeEnd && edgeV1 === degenerateEdgeStart) {
        return true; // Edge is reversed relative to degenerate triangle
      }
      return false;
    }

    // For other degenerate patterns, use default
    if (i0 === i1 || i1 === i2) {
      return false;
    }

    const faceVerts = [i0, i1, i2];

    // Find the position of v0 and v1 in the face
    const pos0 = faceVerts.indexOf(edgeV0);
    const pos1 = faceVerts.indexOf(edgeV1);

    if (pos0 === -1 || pos1 === -1) {
      return false; // Edge not in this face (shouldn't happen)
    }

    // Check if v0 -> v1 follows the face winding (clockwise order in the face)
    // If v1 is the next vertex after v0 in the face, the edge goes WITH the winding
    // In that case, we need to reverse the extruded quad winding
    const nextPos = (pos0 + 1) % 3;
    return faceVerts[nextPos] === edgeV1;
  }

  /**
   * Extrude selected faces - duplicates face vertices and creates connecting side faces
   *
   * Algorithm:
   * 1. For each selected face, collect its unique vertices
   * 2. Duplicate these vertices (initially at same position)
   * 3. Create quad side faces connecting original edges to new edges
   * 4. Create new top face from duplicated vertices
   * 5. Return the new vertices so they can be selected for transform
   */
  extrudeFaces(mesh: Mesh, selectedFaces: Set<number>): ExtrudeFaceResult {
    if (selectedFaces.size === 0) {
      return { success: false, newVertices: new Set(), newFaces: new Set() };
    }

    // Map from original vertex index to new duplicated vertex index
    const vertexMapping = new Map<number, number>();
    const newVertexIndices = new Set<number>();
    const newFaceIndices = new Set<number>();

    // Process each selected face
    for (const faceIdx of selectedFaces) {
      if (faceIdx >= mesh.faceData.length) continue;

      const face = mesh.faceData[faceIdx];
      const faceVerts = face.vertices;
      if (faceVerts.length < 3) continue;

      // Collect vertices for this face that haven't been duplicated yet
      const localMapping = new Map<number, number>();

      for (const vIdx of faceVerts) {
        if (!vertexMapping.has(vIdx)) {
          const originalVertex = mesh.vertices[vIdx];
          const newVertex = new Vertex(
            originalVertex.position.clone(),
            originalVertex.color.clone(),
            originalVertex.normal.clone(),
            originalVertex.u,
            originalVertex.v
          );
          const newIdx = mesh.vertices.length;
          mesh.vertices.push(newVertex);
          vertexMapping.set(vIdx, newIdx);
          newVertexIndices.add(newIdx);
        }
        localMapping.set(vIdx, vertexMapping.get(vIdx)!);
      }

      // Create side quads for each edge of the face
      // Edge goes from v0 to v1 in the face winding order
      // Side quad connects: v0, v1, newV1, newV0 (reversed to point outward)
      for (let i = 0; i < faceVerts.length; i++) {
        const v0 = faceVerts[i];
        const v1 = faceVerts[(i + 1) % faceVerts.length];
        const newV0 = localMapping.get(v0)!;
        const newV1 = localMapping.get(v1)!;

        // Side face winding: v1, v0, newV0, newV1 (reversed from face winding for outward normal)
        mesh.faceData.push({ vertices: [v1, v0, newV0, newV1] });
        newFaceIndices.add(mesh.faceData.length - 1);
      }

      // Create the new top face from duplicated vertices (same winding as original)
      const newTopVerts = faceVerts.map((v) => localMapping.get(v)!);
      mesh.faceData.push({ vertices: newTopVerts });
      newFaceIndices.add(mesh.faceData.length - 1);
    }

    // Remove the original selected faces (they're now inside the extrusion)
    // We need to remove them in reverse order to avoid index shifting issues
    const sortedFaces = Array.from(selectedFaces).sort((a, b) => b - a);
    for (const faceIdx of sortedFaces) {
      mesh.faceData.splice(faceIdx, 1);
      // Adjust newFaceIndices since we removed a face
      const adjustedIndices = new Set<number>();
      for (const idx of newFaceIndices) {
        if (idx > faceIdx) {
          adjustedIndices.add(idx - 1);
        } else {
          adjustedIndices.add(idx);
        }
      }
      newFaceIndices.clear();
      for (const idx of adjustedIndices) {
        newFaceIndices.add(idx);
      }
    }

    // Rebuild mesh from faceData
    mesh.rebuildFromFaces();

    return {
      success: true,
      newVertices: newVertexIndices,
      newFaces: newFaceIndices,
    };
  }
}
