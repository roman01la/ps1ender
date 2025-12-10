/**
 * Selection System - Manages mesh element selection in edit mode
 *
 * This system manages:
 * - Selection mode (vertex/edge/face)
 * - Selection sets (vertices, edges, faces)
 * - Selection operations (selectAll, selectLinked, clearSelection)
 * - Edge key utilities
 * - Co-located vertex handling for transforms
 */

import { Mesh } from "../primitives";
import {
  makeEdgeKey as makeEdgeKeyUtil,
  parseEdgeKey as parseEdgeKeyUtil,
  getPositionKey,
  getMeshEdges as getMeshEdgesUtil,
  POSITION_EPSILON,
  Edge,
} from "../utils/geometry";

// Re-export Edge type for backward compatibility
export type { Edge };

/**
 * Selection mode for edit mode
 */
export type SelectionMode = "vertex" | "edge" | "face";

/**
 * Selection state snapshot for serialization
 */
export interface SelectionState {
  mode: SelectionMode;
  vertices: number[];
  edges: string[];
  faces: number[];
}

/**
 * Callback when selection changes
 */
export type SelectionChangeCallback = () => void;

/**
 * Selection Manager - centralizes all selection handling
 */
export class SelectionManager {
  // Selection mode
  private _mode: SelectionMode = "vertex";

  // Selection sets
  private _selectedVertices: Set<number> = new Set();
  private _selectedEdges: Set<string> = new Set(); // "v0-v1" format (sorted)
  private _selectedFaces: Set<number> = new Set(); // triangle indices

  // Change callback
  private onChangeCallback: SelectionChangeCallback | null = null;

  /**
   * Get current selection mode
   */
  get mode(): SelectionMode {
    return this._mode;
  }

  /**
   * Get selected vertices (read-only)
   */
  get selectedVertices(): ReadonlySet<number> {
    return this._selectedVertices;
  }

  /**
   * Get selected edges (read-only)
   */
  get selectedEdges(): ReadonlySet<string> {
    return this._selectedEdges;
  }

  /**
   * Get selected faces (read-only)
   */
  get selectedFaces(): ReadonlySet<number> {
    return this._selectedFaces;
  }

  /**
   * Set change callback
   */
  setOnChange(callback: SelectionChangeCallback | null): void {
    this.onChangeCallback = callback;
  }

  /**
   * Notify of change
   */
  private notifyChange(): void {
    this.onChangeCallback?.();
  }

  // ==================== Edge Key Utilities ====================

  /**
   * Create a canonical edge key (sorted vertex indices)
   */
  makeEdgeKey(v0: number, v1: number): string {
    return makeEdgeKeyUtil(v0, v1);
  }

  /**
   * Parse an edge key back to vertex indices
   */
  parseEdgeKey(key: string): [number, number] {
    return parseEdgeKeyUtil(key);
  }

  /**
   * Get all unique edges from a mesh
   */
  getMeshEdges(mesh: Mesh): Edge[] {
    return getMeshEdgesUtil(mesh, false);
  }

  // ==================== Selection Mode ====================

  /**
   * Set selection mode (vertex/edge/face)
   * Converts selection to the new mode (Blender behavior):
   * - Lower-level: select all elements of new type from current selection
   * - Higher-level: select elements whose vertices are all selected
   */
  setMode(mode: SelectionMode, mesh?: Mesh): void {
    if (this._mode === mode) return;

    const oldMode = this._mode;
    this._mode = mode;

    // Convert selection when changing modes
    if (mesh) {
      // Lower-level conversions (expand selection)
      if (oldMode === "face" && mode === "edge") {
        this.convertFacesToEdges(mesh);
      } else if (oldMode === "face" && mode === "vertex") {
        this.convertFacesToVertices(mesh);
      } else if (oldMode === "edge" && mode === "vertex") {
        this.convertEdgesToVertices(mesh);
      }
      // Higher-level conversions (contract selection)
      else if (oldMode === "vertex" && mode === "edge") {
        this.convertVerticesToEdges(mesh);
      } else if (oldMode === "vertex" && mode === "face") {
        this.convertVerticesToFaces(mesh);
      } else if (oldMode === "edge" && mode === "face") {
        this.convertEdgesToFaces(mesh);
      } else {
        this.clearAll();
      }
    } else {
      // No mesh provided - clear selection
      this.clearAll();
    }
  }

  /**
   * Convert face selection to edge selection
   */
  private convertFacesToEdges(mesh: Mesh): void {
    if (this._selectedFaces.size === 0) return;

    const newEdges = new Set<string>();

    for (const faceIdx of this._selectedFaces) {
      if (faceIdx >= mesh.faces.length) continue;

      const face = mesh.faces[faceIdx];
      for (const triIdx of face.triangles) {
        const base = triIdx * 3;
        if (base + 2 >= mesh.indices.length) continue;

        const i0 = mesh.indices[base];
        const i1 = mesh.indices[base + 1];
        const i2 = mesh.indices[base + 2];

        // Add all three edges of each triangle
        newEdges.add(this.makeEdgeKey(i0, i1));
        newEdges.add(this.makeEdgeKey(i1, i2));
        newEdges.add(this.makeEdgeKey(i2, i0));
      }
    }

    // For quads, remove the internal diagonal edge
    // We need to identify which edges are internal diagonals
    const diagonalEdges = mesh.getQuadDiagonalEdges();
    if (diagonalEdges.size > 0) {
      // Filter out diagonal edges
      for (const edgeKey of newEdges) {
        const [v0, v1] = this.parseEdgeKey(edgeKey);
        const pos0 = getPositionKey(mesh.vertices[v0].position);
        const pos1 = getPositionKey(mesh.vertices[v1].position);
        const posEdgeKey = [pos0, pos1].sort().join("|");
        if (diagonalEdges.has(posEdgeKey)) {
          newEdges.delete(edgeKey);
        }
      }
    }

    this._selectedVertices.clear();
    this._selectedEdges = newEdges;
    this._selectedFaces.clear();
    this.notifyChange();
  }

  /**
   * Convert face selection to vertex selection
   * Includes all co-located vertices at the same positions to prevent mesh tearing
   */
  private convertFacesToVertices(mesh: Mesh): void {
    if (this._selectedFaces.size === 0) return;

    const epsilon = 0.0001;
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build position-to-vertices map for all mesh vertices
    const positionToVertices: Map<string, number[]> = new Map();
    for (let i = 0; i < mesh.vertices.length; i++) {
      const key = getPositionKey(mesh.vertices[i].position);
      if (!positionToVertices.has(key)) {
        positionToVertices.set(key, []);
      }
      positionToVertices.get(key)!.push(i);
    }

    // Collect all unique positions from selected faces
    const selectedPositions = new Set<string>();

    for (const faceIdx of this._selectedFaces) {
      if (faceIdx >= mesh.faces.length) continue;

      const face = mesh.faces[faceIdx];
      for (const triIdx of face.triangles) {
        const base = triIdx * 3;
        if (base + 2 >= mesh.indices.length) continue;

        selectedPositions.add(
          getPositionKey(mesh.vertices[mesh.indices[base]].position)
        );
        selectedPositions.add(
          getPositionKey(mesh.vertices[mesh.indices[base + 1]].position)
        );
        selectedPositions.add(
          getPositionKey(mesh.vertices[mesh.indices[base + 2]].position)
        );
      }
    }

    // Get all vertices at these positions (including co-located duplicates)
    const newVertices = new Set<number>();
    for (const posKey of selectedPositions) {
      const vertices = positionToVertices.get(posKey) || [];
      for (const v of vertices) {
        newVertices.add(v);
      }
    }

    this._selectedVertices = newVertices;
    this._selectedEdges.clear();
    this._selectedFaces.clear();
    this.notifyChange();
  }

  /**
   * Convert edge selection to vertex selection
   * Includes all co-located vertices at the same positions to prevent mesh tearing
   */
  private convertEdgesToVertices(mesh: Mesh): void {
    if (this._selectedEdges.size === 0) return;

    const epsilon = 0.0001;
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build position-to-vertices map for all mesh vertices
    const positionToVertices: Map<string, number[]> = new Map();
    for (let i = 0; i < mesh.vertices.length; i++) {
      const key = getPositionKey(mesh.vertices[i].position);
      if (!positionToVertices.has(key)) {
        positionToVertices.set(key, []);
      }
      positionToVertices.get(key)!.push(i);
    }

    // Collect all unique positions from selected edges
    const selectedPositions = new Set<string>();

    for (const edgeKey of this._selectedEdges) {
      const [v0, v1] = this.parseEdgeKey(edgeKey);
      selectedPositions.add(getPositionKey(mesh.vertices[v0].position));
      selectedPositions.add(getPositionKey(mesh.vertices[v1].position));
    }

    // Get all vertices at these positions (including co-located duplicates)
    const newVertices = new Set<number>();
    for (const posKey of selectedPositions) {
      const vertices = positionToVertices.get(posKey) || [];
      for (const v of vertices) {
        newVertices.add(v);
      }
    }

    this._selectedVertices = newVertices;
    this._selectedEdges.clear();
    this._selectedFaces.clear();
    this.notifyChange();
  }

  /**
   * Convert vertex selection to edge selection
   * Selects edges where BOTH vertices are selected (by position)
   */
  private convertVerticesToEdges(mesh: Mesh): void {
    if (this._selectedVertices.size === 0) return;

    const epsilon = 0.0001;
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Get all selected positions
    const selectedPositions = new Set<string>();
    for (const v of this._selectedVertices) {
      selectedPositions.add(getPositionKey(mesh.vertices[v].position));
    }

    // Get quad diagonal edges to exclude
    const diagonalEdges = mesh.getQuadDiagonalEdges();

    // Find all edges where both endpoints are in selected positions
    const newEdges = new Set<string>();
    const seenEdges = new Set<string>();

    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];

      const edges = [
        [i0, i1],
        [i1, i2],
        [i2, i0],
      ];

      for (const [v0, v1] of edges) {
        const edgeKey = this.makeEdgeKey(v0, v1);
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const pos0 = getPositionKey(mesh.vertices[v0].position);
        const pos1 = getPositionKey(mesh.vertices[v1].position);

        // Skip diagonal edges
        if (diagonalEdges.size > 0) {
          const posEdgeKey = [pos0, pos1].sort().join("|");
          if (diagonalEdges.has(posEdgeKey)) continue;
        }

        // Both endpoints must be selected
        if (selectedPositions.has(pos0) && selectedPositions.has(pos1)) {
          newEdges.add(edgeKey);
        }
      }
    }

    this._selectedVertices.clear();
    this._selectedEdges = newEdges;
    this._selectedFaces.clear();
    this.notifyChange();
  }

  /**
   * Convert vertex selection to face selection
   * Selects faces where ALL vertices are selected (by position)
   */
  private convertVerticesToFaces(mesh: Mesh): void {
    if (this._selectedVertices.size === 0) return;

    const epsilon = 0.0001;
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Get all selected positions
    const selectedPositions = new Set<string>();
    for (const v of this._selectedVertices) {
      selectedPositions.add(getPositionKey(mesh.vertices[v].position));
    }

    // Find faces where all vertices are selected
    const newFaces = new Set<number>();

    for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
      const face = mesh.faces[faceIdx];
      let allSelected = true;

      for (const triIdx of face.triangles) {
        const base = triIdx * 3;
        if (base + 2 >= mesh.indices.length) {
          allSelected = false;
          break;
        }

        const pos0 = getPositionKey(mesh.vertices[mesh.indices[base]].position);
        const pos1 = getPositionKey(
          mesh.vertices[mesh.indices[base + 1]].position
        );
        const pos2 = getPositionKey(
          mesh.vertices[mesh.indices[base + 2]].position
        );

        if (
          !selectedPositions.has(pos0) ||
          !selectedPositions.has(pos1) ||
          !selectedPositions.has(pos2)
        ) {
          allSelected = false;
          break;
        }
      }

      if (allSelected) {
        newFaces.add(faceIdx);
      }
    }

    this._selectedVertices.clear();
    this._selectedEdges.clear();
    this._selectedFaces = newFaces;
    this.notifyChange();
  }

  /**
   * Convert edge selection to face selection
   * Selects faces where ALL edges are selected
   */
  private convertEdgesToFaces(mesh: Mesh): void {
    if (this._selectedEdges.size === 0) return;

    const epsilon = 0.0001;
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build a set of selected edge position keys for comparison
    const selectedEdgePositions = new Set<string>();
    for (const edgeKey of this._selectedEdges) {
      const [v0, v1] = this.parseEdgeKey(edgeKey);
      const pos0 = getPositionKey(mesh.vertices[v0].position);
      const pos1 = getPositionKey(mesh.vertices[v1].position);
      const posEdgeKey = [pos0, pos1].sort().join("|");
      selectedEdgePositions.add(posEdgeKey);
    }

    // Get quad diagonal edges (these don't need to be selected)
    const diagonalEdges = mesh.getQuadDiagonalEdges();

    // Find faces where all boundary edges are selected
    const newFaces = new Set<number>();

    for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
      const face = mesh.faces[faceIdx];

      // Collect all edges of this face
      const faceEdges = new Set<string>();
      for (const triIdx of face.triangles) {
        const base = triIdx * 3;
        if (base + 2 >= mesh.indices.length) continue;

        const i0 = mesh.indices[base];
        const i1 = mesh.indices[base + 1];
        const i2 = mesh.indices[base + 2];

        const pos0 = getPositionKey(mesh.vertices[i0].position);
        const pos1 = getPositionKey(mesh.vertices[i1].position);
        const pos2 = getPositionKey(mesh.vertices[i2].position);

        faceEdges.add([pos0, pos1].sort().join("|"));
        faceEdges.add([pos1, pos2].sort().join("|"));
        faceEdges.add([pos2, pos0].sort().join("|"));
      }

      // Check if all non-diagonal edges are selected
      let allSelected = true;
      for (const posEdgeKey of faceEdges) {
        // Skip diagonal edges - they don't need to be selected
        if (diagonalEdges.has(posEdgeKey)) continue;

        if (!selectedEdgePositions.has(posEdgeKey)) {
          allSelected = false;
          break;
        }
      }

      if (allSelected && faceEdges.size > 0) {
        newFaces.add(faceIdx);
      }
    }

    this._selectedVertices.clear();
    this._selectedEdges.clear();
    this._selectedFaces = newFaces;
    this.notifyChange();
  }

  // ==================== Selection State ====================

  /**
   * Check if there's any selection in current mode
   */
  hasSelection(): boolean {
    if (this._mode === "vertex") {
      return this._selectedVertices.size > 0;
    } else if (this._mode === "edge") {
      return this._selectedEdges.size > 0;
    } else if (this._mode === "face") {
      return this._selectedFaces.size > 0;
    }
    return false;
  }

  /**
   * Clear all selections
   */
  clearAll(): void {
    const hadSelection =
      this._selectedVertices.size > 0 ||
      this._selectedEdges.size > 0 ||
      this._selectedFaces.size > 0;

    this._selectedVertices.clear();
    this._selectedEdges.clear();
    this._selectedFaces.clear();

    if (hadSelection) {
      this.notifyChange();
    }
  }

  // ==================== Vertex Selection ====================

  /**
   * Add a vertex to selection
   */
  addVertex(index: number): void {
    if (!this._selectedVertices.has(index)) {
      this._selectedVertices.add(index);
      this.notifyChange();
    }
  }

  /**
   * Remove a vertex from selection
   */
  removeVertex(index: number): void {
    if (this._selectedVertices.delete(index)) {
      this.notifyChange();
    }
  }

  /**
   * Toggle vertex selection
   */
  toggleVertex(index: number): void {
    if (this._selectedVertices.has(index)) {
      this._selectedVertices.delete(index);
    } else {
      this._selectedVertices.add(index);
    }
    this.notifyChange();
  }

  /**
   * Set vertex selection (replaces current)
   */
  setVertices(indices: Iterable<number>): void {
    this._selectedVertices.clear();
    for (const idx of indices) {
      this._selectedVertices.add(idx);
    }
    this.notifyChange();
  }

  /**
   * Add multiple vertices
   */
  addVertices(indices: Iterable<number>): void {
    for (const idx of indices) {
      this._selectedVertices.add(idx);
    }
    this.notifyChange();
  }

  // ==================== Edge Selection ====================

  /**
   * Add an edge to selection
   */
  addEdge(v0: number, v1: number): void {
    const key = this.makeEdgeKey(v0, v1);
    if (!this._selectedEdges.has(key)) {
      this._selectedEdges.add(key);
      this.notifyChange();
    }
  }

  /**
   * Add an edge by key
   */
  addEdgeByKey(key: string): void {
    if (!this._selectedEdges.has(key)) {
      this._selectedEdges.add(key);
      this.notifyChange();
    }
  }

  /**
   * Remove an edge from selection
   */
  removeEdge(v0: number, v1: number): void {
    const key = this.makeEdgeKey(v0, v1);
    if (this._selectedEdges.delete(key)) {
      this.notifyChange();
    }
  }

  /**
   * Toggle edge selection
   */
  toggleEdge(v0: number, v1: number): void {
    const key = this.makeEdgeKey(v0, v1);
    if (this._selectedEdges.has(key)) {
      this._selectedEdges.delete(key);
    } else {
      this._selectedEdges.add(key);
    }
    this.notifyChange();
  }

  /**
   * Set edge selection (replaces current)
   */
  setEdges(edges: Iterable<string>): void {
    this._selectedEdges.clear();
    for (const edge of edges) {
      this._selectedEdges.add(edge);
    }
    this.notifyChange();
  }

  // ==================== Face Selection ====================

  /**
   * Add a face to selection
   */
  addFace(index: number): void {
    if (!this._selectedFaces.has(index)) {
      this._selectedFaces.add(index);
      this.notifyChange();
    }
  }

  /**
   * Remove a face from selection
   */
  removeFace(index: number): void {
    if (this._selectedFaces.delete(index)) {
      this.notifyChange();
    }
  }

  /**
   * Toggle face selection
   */
  toggleFace(index: number): void {
    if (this._selectedFaces.has(index)) {
      this._selectedFaces.delete(index);
    } else {
      this._selectedFaces.add(index);
    }
    this.notifyChange();
  }

  /**
   * Set face selection (replaces current)
   */
  setFaces(indices: Iterable<number>): void {
    this._selectedFaces.clear();
    for (const idx of indices) {
      this._selectedFaces.add(idx);
    }
    this.notifyChange();
  }

  /**
   * Add multiple faces
   */
  addFaces(indices: Iterable<number>): void {
    for (const idx of indices) {
      this._selectedFaces.add(idx);
    }
    this.notifyChange();
  }

  // ==================== Bulk Operations ====================

  /**
   * Select all elements of current mode in a mesh
   */
  selectAll(mesh: Mesh): void {
    if (this._mode === "vertex") {
      for (let i = 0; i < mesh.vertices.length; i++) {
        this._selectedVertices.add(i);
      }
    } else if (this._mode === "edge") {
      const edges = this.getMeshEdges(mesh);
      for (const edge of edges) {
        this._selectedEdges.add(this.makeEdgeKey(edge.v0, edge.v1));
      }
    } else if (this._mode === "face") {
      // Select all logical faces (not individual triangles)
      for (let i = 0; i < mesh.faces.length; i++) {
        this._selectedFaces.add(i);
      }
    }
    this.notifyChange();
  }

  // ==================== Vertex Index Helpers ====================

  /**
   * Get vertices affected by current selection (for transforms)
   * Returns vertex indices that should be transformed
   *
   * For vertex mode: includes selected vertices and topologically-connected co-located vertices
   * For edge/face mode: includes co-located vertices from the same connected mesh component
   */
  getSelectedVertexIndices(mesh: Mesh): Set<number> {
    const vertices = new Set<number>();

    if (this._mode === "vertex") {
      // For vertex mode, include selected vertices and their topologically-connected co-located vertices
      const connectedColocated = this.getConnectedColocatedVertices(
        mesh,
        this._selectedVertices
      );
      for (const v of this._selectedVertices) {
        vertices.add(v);
      }
      for (const v of connectedColocated) {
        vertices.add(v);
      }
    } else if (this._mode === "edge") {
      // Collect edge vertices
      const edgeVertices = new Set<number>();
      for (const edgeKey of this._selectedEdges) {
        const [v0, v1] = this.parseEdgeKey(edgeKey);
        edgeVertices.add(v0);
        edgeVertices.add(v1);
      }
      // Get ALL co-located vertices at these positions
      const allColocated = this.getColocatedVerticesForPositions(
        mesh,
        edgeVertices
      );
      for (const v of allColocated) {
        vertices.add(v);
      }
    } else if (this._mode === "face") {
      // Collect face vertices from logical faces
      const faceVertices = new Set<number>();
      for (const faceIdx of this._selectedFaces) {
        if (faceIdx < mesh.faces.length) {
          // Get all triangles in this logical face
          for (const triIdx of mesh.faces[faceIdx].triangles) {
            const baseIdx = triIdx * 3;
            if (baseIdx + 2 < mesh.indices.length) {
              faceVertices.add(mesh.indices[baseIdx]);
              faceVertices.add(mesh.indices[baseIdx + 1]);
              faceVertices.add(mesh.indices[baseIdx + 2]);
            }
          }
        }
      }
      // Get ALL co-located vertices at these positions
      const allColocated = this.getColocatedVerticesForPositions(
        mesh,
        faceVertices
      );
      for (const v of allColocated) {
        vertices.add(v);
      }
    }

    return vertices;
  }

  // ==================== Co-located Vertex Helpers ====================

  /**
   * Get ALL vertices that share positions with given source vertices
   * AND are in the same connected mesh component.
   *
   * This expands the selection to include duplicate vertices (for per-face normals)
   * at the exact same positions, ensuring the mesh stays connected when transforming.
   */
  getColocatedVerticesForPositions(
    mesh: Mesh,
    sourceVertices: Set<number>
  ): Set<number> {
    const epsilon = 0.0001;

    // Build position key helper
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build position-to-vertices map
    const positionToVertices: Map<string, number[]> = new Map();
    for (let i = 0; i < mesh.vertices.length; i++) {
      const key = getPositionKey(mesh.vertices[i].position);
      if (!positionToVertices.has(key)) {
        positionToVertices.set(key, []);
      }
      positionToVertices.get(key)!.push(i);
    }

    // Build geometric edge connectivity for triangles
    const makeGeomEdgeKey = (posKey1: string, posKey2: string) =>
      posKey1 < posKey2 ? `${posKey1}|${posKey2}` : `${posKey2}|${posKey1}`;

    // Map from triangle index to its geometric edges
    const triangleCount = Math.floor(mesh.indices.length / 3);
    const triangleToGeomEdges: Map<number, string[]> = new Map();
    const geomEdgeToTriangles: Map<string, number[]> = new Map();

    for (let triIdx = 0; triIdx < triangleCount; triIdx++) {
      const baseIdx = triIdx * 3;
      const indices = [
        mesh.indices[baseIdx],
        mesh.indices[baseIdx + 1],
        mesh.indices[baseIdx + 2],
      ];
      const posKeys = indices.map((idx) =>
        getPositionKey(mesh.vertices[idx].position)
      );

      const edges = [
        makeGeomEdgeKey(posKeys[0], posKeys[1]),
        makeGeomEdgeKey(posKeys[1], posKeys[2]),
        makeGeomEdgeKey(posKeys[2], posKeys[0]),
      ];

      triangleToGeomEdges.set(triIdx, edges);

      for (const edge of edges) {
        if (!geomEdgeToTriangles.has(edge)) {
          geomEdgeToTriangles.set(edge, []);
        }
        geomEdgeToTriangles.get(edge)!.push(triIdx);
      }
    }

    // Build triangle adjacency (which triangles share a geometric edge)
    const triangleNeighbors: Map<number, Set<number>> = new Map();
    for (let i = 0; i < triangleCount; i++) {
      triangleNeighbors.set(i, new Set());
    }

    for (const [, triangles] of geomEdgeToTriangles) {
      for (let i = 0; i < triangles.length; i++) {
        for (let j = i + 1; j < triangles.length; j++) {
          triangleNeighbors.get(triangles[i])!.add(triangles[j]);
          triangleNeighbors.get(triangles[j])!.add(triangles[i]);
        }
      }
    }

    // Find triangles containing source vertices
    const sourceTriangles = new Set<number>();
    for (let triIdx = 0; triIdx < triangleCount; triIdx++) {
      const baseIdx = triIdx * 3;
      for (let j = 0; j < 3; j++) {
        if (sourceVertices.has(mesh.indices[baseIdx + j])) {
          sourceTriangles.add(triIdx);
          break;
        }
      }
    }

    // Flood-fill to find all connected triangles
    const connectedTriangles = new Set<number>();
    const queue = [...sourceTriangles];

    while (queue.length > 0) {
      const tri = queue.pop()!;
      if (connectedTriangles.has(tri)) continue;
      connectedTriangles.add(tri);

      const neighbors = triangleNeighbors.get(tri);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!connectedTriangles.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    // Collect all vertices from connected triangles
    const connectedVertices = new Set<number>();
    for (const triIdx of connectedTriangles) {
      const baseIdx = triIdx * 3;
      for (let j = 0; j < 3; j++) {
        connectedVertices.add(mesh.indices[baseIdx + j]);
      }
    }

    // Get source vertex positions
    const sourcePositionKeys = new Set<string>();
    for (const v of sourceVertices) {
      sourcePositionKeys.add(getPositionKey(mesh.vertices[v].position));
    }

    // Return vertices at source positions that are in connected component
    const result = new Set<number>();
    for (const posKey of sourcePositionKeys) {
      const verts = positionToVertices.get(posKey) || [];
      for (const v of verts) {
        if (connectedVertices.has(v)) {
          result.add(v);
        }
      }
    }

    return result;
  }

  /**
   * Find co-located vertices that are topologically connected to the given vertices.
   *
   * For each source vertex, finds OTHER vertices at the SAME position that belong to
   * triangles sharing a geometric edge with the source vertex's triangles.
   */
  getConnectedColocatedVertices(
    mesh: Mesh,
    sourceVertices: Set<number>
  ): Set<number> {
    const epsilon = 0.0001;

    // Build position key helper
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build position-to-vertices map
    const positionToVertices: Map<string, number[]> = new Map();
    for (let i = 0; i < mesh.vertices.length; i++) {
      const key = getPositionKey(mesh.vertices[i].position);
      if (!positionToVertices.has(key)) {
        positionToVertices.set(key, []);
      }
      positionToVertices.get(key)!.push(i);
    }

    // Build vertex-to-triangles map
    const vertexToTriangles: Map<number, Set<number>> = new Map();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triIdx = Math.floor(i / 3);
      for (let j = 0; j < 3; j++) {
        const vIdx = mesh.indices[i + j];
        if (!vertexToTriangles.has(vIdx)) {
          vertexToTriangles.set(vIdx, new Set());
        }
        vertexToTriangles.get(vIdx)!.add(triIdx);
      }
    }

    // Build geometric edge to triangles map
    const makeGeomEdgeKey = (posKey1: string, posKey2: string) =>
      posKey1 < posKey2 ? `${posKey1}|${posKey2}` : `${posKey2}|${posKey1}`;

    const geomEdgeToTriangles: Map<string, Set<number>> = new Map();

    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triIdx = Math.floor(i / 3);
      const indices = [
        mesh.indices[i],
        mesh.indices[i + 1],
        mesh.indices[i + 2],
      ];
      const posKeys = indices.map((idx) =>
        getPositionKey(mesh.vertices[idx].position)
      );

      const edges = [
        makeGeomEdgeKey(posKeys[0], posKeys[1]),
        makeGeomEdgeKey(posKeys[1], posKeys[2]),
        makeGeomEdgeKey(posKeys[2], posKeys[0]),
      ];

      for (const edgeKey of edges) {
        if (!geomEdgeToTriangles.has(edgeKey)) {
          geomEdgeToTriangles.set(edgeKey, new Set());
        }
        geomEdgeToTriangles.get(edgeKey)!.add(triIdx);
      }
    }

    // For each source vertex position, find triangles that share geometric edges
    // with source triangles, then include co-located vertices from those triangles
    const result = new Set<number>();

    // Get all triangles containing source vertices
    const sourceTriangles = new Set<number>();
    for (const srcVertex of sourceVertices) {
      const tris = vertexToTriangles.get(srcVertex);
      if (tris) {
        for (const tri of tris) {
          sourceTriangles.add(tri);
        }
      }
    }

    // Get all geometric edges of source triangles
    const sourceGeomEdges = new Set<string>();
    for (const triIdx of sourceTriangles) {
      const baseIdx = triIdx * 3;
      const indices = [
        mesh.indices[baseIdx],
        mesh.indices[baseIdx + 1],
        mesh.indices[baseIdx + 2],
      ];
      const posKeys = indices.map((idx) =>
        getPositionKey(mesh.vertices[idx].position)
      );

      sourceGeomEdges.add(makeGeomEdgeKey(posKeys[0], posKeys[1]));
      sourceGeomEdges.add(makeGeomEdgeKey(posKeys[1], posKeys[2]));
      sourceGeomEdges.add(makeGeomEdgeKey(posKeys[2], posKeys[0]));
    }

    // Get triangles that share geometric edges with source triangles
    const adjacentTriangles = new Set<number>();
    for (const geomEdge of sourceGeomEdges) {
      const tris = geomEdgeToTriangles.get(geomEdge);
      if (tris) {
        for (const tri of tris) {
          adjacentTriangles.add(tri);
        }
      }
    }

    // Combine source and adjacent triangles
    const connectedTriangles = new Set([
      ...sourceTriangles,
      ...adjacentTriangles,
    ]);

    // Get all vertices in connected triangles
    const connectedVertices = new Set<number>();
    for (const triIdx of connectedTriangles) {
      const baseIdx = triIdx * 3;
      for (let j = 0; j < 3; j++) {
        connectedVertices.add(mesh.indices[baseIdx + j]);
      }
    }

    // For each source vertex, find co-located vertices that are in connected triangles
    for (const srcVertex of sourceVertices) {
      const srcPosKey = getPositionKey(mesh.vertices[srcVertex].position);
      const colocatedVerts = positionToVertices.get(srcPosKey) || [];

      for (const v of colocatedVerts) {
        if (v !== srcVertex && connectedVertices.has(v)) {
          result.add(v);
        }
      }
    }

    return result;
  }

  // ==================== Select Linked ====================

  /**
   * Select all geometry connected to the current selection (Ctrl+L)
   * Works in all edit modes - finds connected components via shared vertices
   */
  selectLinked(mesh: Mesh): void {
    if (!this.hasSelection()) return;

    const epsilon = 0.0001;

    // Build position-to-vertices map for finding co-located vertices
    const positionToVertices: Map<string, number[]> = new Map();
    const getPositionKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    for (let i = 0; i < mesh.vertices.length; i++) {
      const key = getPositionKey(mesh.vertices[i].position);
      if (!positionToVertices.has(key)) {
        positionToVertices.set(key, []);
      }
      positionToVertices.get(key)!.push(i);
    }

    // Build geometric edge map
    const makeGeomEdgeKey = (posKey1: string, posKey2: string) =>
      posKey1 < posKey2 ? `${posKey1}|${posKey2}` : `${posKey2}|${posKey1}`;

    const geomEdgeToTriangles: Map<
      string,
      Array<{ triIdx: number; v0: number; v1: number }>
    > = new Map();

    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triIdx = Math.floor(i / 3);
      const indices = [
        mesh.indices[i],
        mesh.indices[i + 1],
        mesh.indices[i + 2],
      ];
      const posKeys = indices.map((idx) =>
        getPositionKey(mesh.vertices[idx].position)
      );

      const edges = [
        { v0: indices[0], v1: indices[1], pk0: posKeys[0], pk1: posKeys[1] },
        { v0: indices[1], v1: indices[2], pk0: posKeys[1], pk1: posKeys[2] },
        { v0: indices[2], v1: indices[0], pk0: posKeys[2], pk1: posKeys[0] },
      ];

      for (const edge of edges) {
        const geomKey = makeGeomEdgeKey(edge.pk0, edge.pk1);
        if (!geomEdgeToTriangles.has(geomKey)) {
          geomEdgeToTriangles.set(geomKey, []);
        }
        geomEdgeToTriangles
          .get(geomKey)!
          .push({ triIdx, v0: edge.v0, v1: edge.v1 });
      }
    }

    // Build vertex adjacency graph
    const vertexNeighbors: Map<number, Set<number>> = new Map();

    for (let i = 0; i < mesh.vertices.length; i++) {
      vertexNeighbors.set(i, new Set());
    }

    // Connect vertices within each triangle
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];

      vertexNeighbors.get(i0)!.add(i1);
      vertexNeighbors.get(i0)!.add(i2);
      vertexNeighbors.get(i1)!.add(i0);
      vertexNeighbors.get(i1)!.add(i2);
      vertexNeighbors.get(i2)!.add(i0);
      vertexNeighbors.get(i2)!.add(i1);
    }

    // Connect vertices across triangles that share a geometric edge
    for (const [, triangles] of geomEdgeToTriangles) {
      if (triangles.length > 1) {
        for (let i = 0; i < triangles.length; i++) {
          for (let j = i + 1; j < triangles.length; j++) {
            const t1 = triangles[i];
            const t2 = triangles[j];
            vertexNeighbors.get(t1.v0)!.add(t2.v0);
            vertexNeighbors.get(t1.v0)!.add(t2.v1);
            vertexNeighbors.get(t1.v1)!.add(t2.v0);
            vertexNeighbors.get(t1.v1)!.add(t2.v1);
            vertexNeighbors.get(t2.v0)!.add(t1.v0);
            vertexNeighbors.get(t2.v0)!.add(t1.v1);
            vertexNeighbors.get(t2.v1)!.add(t1.v0);
            vertexNeighbors.get(t2.v1)!.add(t1.v1);
          }
        }
      }
    }

    // Get starting vertices based on current selection mode
    const startVertices = new Set<number>();

    if (this._mode === "vertex") {
      for (const v of this._selectedVertices) {
        startVertices.add(v);
      }
    } else if (this._mode === "edge") {
      for (const edgeKey of this._selectedEdges) {
        const [v0, v1] = this.parseEdgeKey(edgeKey);
        startVertices.add(v0);
        startVertices.add(v1);
      }
    } else if (this._mode === "face") {
      // Get vertices from logical faces
      for (const faceIdx of this._selectedFaces) {
        if (faceIdx < mesh.faces.length) {
          for (const triIdx of mesh.faces[faceIdx].triangles) {
            const baseIdx = triIdx * 3;
            if (baseIdx + 2 < mesh.indices.length) {
              startVertices.add(mesh.indices[baseIdx]);
              startVertices.add(mesh.indices[baseIdx + 1]);
              startVertices.add(mesh.indices[baseIdx + 2]);
            }
          }
        }
      }
    }

    // Flood fill to find all connected vertices
    const connectedVertices = new Set<number>();
    const queue: number[] = [...startVertices];

    while (queue.length > 0) {
      const v = queue.pop()!;
      if (connectedVertices.has(v)) continue;
      connectedVertices.add(v);

      const neighbors = vertexNeighbors.get(v);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!connectedVertices.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    // Select all geometry that uses these vertices based on selection mode
    if (this._mode === "vertex") {
      for (const v of connectedVertices) {
        this._selectedVertices.add(v);
      }
    } else if (this._mode === "edge") {
      const edges = this.getMeshEdges(mesh);
      for (const edge of edges) {
        if (connectedVertices.has(edge.v0) && connectedVertices.has(edge.v1)) {
          this._selectedEdges.add(this.makeEdgeKey(edge.v0, edge.v1));
        }
      }
    } else if (this._mode === "face") {
      // Select all logical faces whose triangles use connected vertices
      for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
        const face = mesh.faces[faceIdx];
        let allConnected = true;

        for (const triIdx of face.triangles) {
          const baseIdx = triIdx * 3;
          if (baseIdx + 2 >= mesh.indices.length) {
            allConnected = false;
            break;
          }
          const i0 = mesh.indices[baseIdx];
          const i1 = mesh.indices[baseIdx + 1];
          const i2 = mesh.indices[baseIdx + 2];

          if (
            !connectedVertices.has(i0) ||
            !connectedVertices.has(i1) ||
            !connectedVertices.has(i2)
          ) {
            allConnected = false;
            break;
          }
        }

        if (allConnected) {
          this._selectedFaces.add(faceIdx);
        }
      }
    }

    this.notifyChange();
  }

  // ==================== Edge Loop & Ring Selection ====================

  /**
   * Select an edge loop starting from a given edge.
   * An edge loop follows connected edges end-to-end (like a belt around a mesh).
   * At each vertex, it continues to the edge that shares the most faces (typically the "straight" continuation).
   */
  selectEdgeLoop(mesh: Mesh, startEdgeKey: string, shiftKey: boolean): void {
    const loopEdges = this.findEdgeLoop(mesh, startEdgeKey);

    if (shiftKey) {
      for (const edgeKey of loopEdges) {
        this._selectedEdges.add(edgeKey);
      }
    } else {
      this._selectedEdges.clear();
      for (const edgeKey of loopEdges) {
        this._selectedEdges.add(edgeKey);
      }
    }

    this.notifyChange();
  }

  /**
   * Select an edge ring starting from a given edge.
   * An edge ring selects parallel edges across quads (opposite edges in adjacent faces).
   */
  selectEdgeRing(mesh: Mesh, startEdgeKey: string, shiftKey: boolean): void {
    const ringEdges = this.findEdgeRing(mesh, startEdgeKey);

    if (shiftKey) {
      for (const edgeKey of ringEdges) {
        this._selectedEdges.add(edgeKey);
      }
    } else {
      this._selectedEdges.clear();
      for (const edgeKey of ringEdges) {
        this._selectedEdges.add(edgeKey);
      }
    }

    this.notifyChange();
  }

  /**
   * Select an edge loop starting from a vertex.
   * The direction is determined by the closest edge to the mouse position.
   */
  selectEdgeLoopFromVertex(
    mesh: Mesh,
    vertexIdx: number,
    directionEdgeKey: string,
    shiftKey: boolean
  ): void {
    const loopEdges = this.findEdgeLoop(mesh, directionEdgeKey);

    // Convert edge loop to vertices
    const loopVertices = new Set<number>();
    for (const edgeKey of loopEdges) {
      const [v0, v1] = this.parseEdgeKey(edgeKey);
      loopVertices.add(v0);
      loopVertices.add(v1);
    }

    // Expand to co-located vertices
    const allVertices = this.getColocatedVerticesForPositions(
      mesh,
      loopVertices
    );

    if (shiftKey) {
      for (const v of allVertices) {
        this._selectedVertices.add(v);
      }
    } else {
      this._selectedVertices.clear();
      for (const v of allVertices) {
        this._selectedVertices.add(v);
      }
    }

    this.notifyChange();
  }

  /**
   * Select an edge ring starting from a vertex.
   * The direction is determined by the closest edge to the mouse position.
   */
  selectEdgeRingFromVertex(
    mesh: Mesh,
    vertexIdx: number,
    directionEdgeKey: string,
    shiftKey: boolean
  ): void {
    const ringEdges = this.findEdgeRing(mesh, directionEdgeKey);

    // Convert edge ring to vertices
    const ringVertices = new Set<number>();
    for (const edgeKey of ringEdges) {
      const [v0, v1] = this.parseEdgeKey(edgeKey);
      ringVertices.add(v0);
      ringVertices.add(v1);
    }

    // Expand to co-located vertices
    const allVertices = this.getColocatedVerticesForPositions(
      mesh,
      ringVertices
    );

    if (shiftKey) {
      for (const v of allVertices) {
        this._selectedVertices.add(v);
      }
    } else {
      this._selectedVertices.clear();
      for (const v of allVertices) {
        this._selectedVertices.add(v);
      }
    }

    this.notifyChange();
  }

  /**
   * Find an edge loop starting from a given edge.
   * Follows edges through vertices, selecting edges that continue "straight through".
   * These are edges that don't share any face with the current edge.
   */
  private findEdgeLoop(mesh: Mesh, startEdgeKey: string): Set<string> {
    const loopEdges = new Set<string>();
    loopEdges.add(startEdgeKey);

    const epsilon = 0.0001;
    const getPosKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build vertex position to edges map and edge to faces map
    const posToEdges: Map<string, Set<string>> = new Map();
    const edgeToFaces: Map<string, Set<number>> = new Map();

    for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
      const face = mesh.faces[faceIdx];
      const facePositions: string[] = [];

      for (const triIdx of face.triangles) {
        const baseIdx = triIdx * 3;
        for (let j = 0; j < 3; j++) {
          const vIdx = mesh.indices[baseIdx + j];
          const posKey = getPosKey(mesh.vertices[vIdx].position);
          if (!facePositions.includes(posKey)) {
            facePositions.push(posKey);
          }
        }
      }

      for (let i = 0; i < facePositions.length; i++) {
        const p0 = facePositions[i];
        const p1 = facePositions[(i + 1) % facePositions.length];
        const edgeKey = p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;

        if (!edgeToFaces.has(edgeKey)) {
          edgeToFaces.set(edgeKey, new Set());
        }
        edgeToFaces.get(edgeKey)!.add(faceIdx);

        if (!posToEdges.has(p0)) posToEdges.set(p0, new Set());
        if (!posToEdges.has(p1)) posToEdges.set(p1, new Set());
        posToEdges.get(p0)!.add(edgeKey);
        posToEdges.get(p1)!.add(edgeKey);
      }
    }

    const [v0, v1] = this.parseEdgeKey(startEdgeKey);
    const p0 = getPosKey(mesh.vertices[v0].position);
    const p1 = getPosKey(mesh.vertices[v1].position);
    const startPosEdgeKey = p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;

    const posEdgeToVertexEdge = (posEdgeKey: string): string | null => {
      const [posKey0, posKey1] = posEdgeKey.split("|");
      let found0: number | null = null;
      let found1: number | null = null;

      for (let i = 0; i < mesh.vertices.length; i++) {
        const vPosKey = getPosKey(mesh.vertices[i].position);
        if (vPosKey === posKey0 && found0 === null) found0 = i;
        if (vPosKey === posKey1 && found1 === null) found1 = i;
        if (found0 !== null && found1 !== null) break;
      }

      if (found0 !== null && found1 !== null) {
        return this.makeEdgeKey(found0, found1);
      }
      return null;
    };

    // Find the next edge in the loop at a given vertex position
    // For edge loops: find the edge that does NOT share any face with the current edge
    // Stop if there are multiple candidates (ambiguous) or none
    const findNextEdge = (
      currentEdge: string,
      vertexPos: string,
      visitedEdges: Set<string>
    ): string | null => {
      const edgesAtVertex = posToEdges.get(vertexPos);
      if (!edgesAtVertex) return null;

      const currentFaces = edgeToFaces.get(currentEdge);
      if (!currentFaces) return null;

      // Collect all candidate edges that don't share a face with current edge
      const candidates: string[] = [];

      for (const candidateEdge of edgesAtVertex) {
        if (candidateEdge === currentEdge) continue;
        if (visitedEdges.has(candidateEdge)) continue;

        const candidateFaces = edgeToFaces.get(candidateEdge);
        if (!candidateFaces) continue;

        // Check if this edge shares any face with current edge
        let sharesFace = false;
        for (const faceIdx of currentFaces) {
          if (candidateFaces.has(faceIdx)) {
            sharesFace = true;
            break;
          }
        }

        // For edge loops, we want edges that don't share a face
        if (!sharesFace) {
          candidates.push(candidateEdge);
        }
      }

      // Only continue if there's exactly one candidate (unambiguous)
      if (candidates.length === 1) {
        return candidates[0];
      }

      // Stop if ambiguous (multiple candidates) or no candidates
      return null;
    };

    const getEdgeVertices = (edgeKey: string): [string, string] => {
      const parts = edgeKey.split("|");
      return [parts[0], parts[1]];
    };

    const traverse = (
      startEdge: string,
      startVertex: string,
      visitedEdges: Set<string>
    ) => {
      let currentEdge = startEdge;
      let currentVertex = startVertex;

      while (true) {
        const nextEdge = findNextEdge(currentEdge, currentVertex, visitedEdges);
        if (!nextEdge) break;

        visitedEdges.add(nextEdge);
        const vertexEdge = posEdgeToVertexEdge(nextEdge);
        if (vertexEdge) {
          loopEdges.add(vertexEdge);
        }

        const [ev0, ev1] = getEdgeVertices(nextEdge);
        currentVertex = ev0 === currentVertex ? ev1 : ev0;
        currentEdge = nextEdge;

        if (nextEdge === startPosEdgeKey) break;
      }
    };

    const [startP0, startP1] = getEdgeVertices(startPosEdgeKey);
    const visitedEdges = new Set<string>();
    visitedEdges.add(startPosEdgeKey);

    traverse(startPosEdgeKey, startP0, visitedEdges);
    traverse(startPosEdgeKey, startP1, visitedEdges);

    return loopEdges;
  }

  /**
   * Find an edge ring starting from a given edge.
   * Traverses quads, selecting the opposite edge in each quad.
   */
  private findEdgeRing(mesh: Mesh, startEdgeKey: string): Set<string> {
    const ringEdges = new Set<string>();
    ringEdges.add(startEdgeKey);

    const epsilon = 0.0001;
    const getPosKey = (pos: { x: number; y: number; z: number }) =>
      `${Math.round(pos.x / epsilon)},${Math.round(
        pos.y / epsilon
      )},${Math.round(pos.z / epsilon)}`;

    // Build position-based edge to face mapping and face edges
    const edgeToFaces: Map<string, number[]> = new Map();
    const faceEdges: Map<number, string[]> = new Map();

    for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
      const face = mesh.faces[faceIdx];
      const facePositions: string[] = [];

      for (const triIdx of face.triangles) {
        const baseIdx = triIdx * 3;
        for (let j = 0; j < 3; j++) {
          const vIdx = mesh.indices[baseIdx + j];
          const posKey = getPosKey(mesh.vertices[vIdx].position);
          if (!facePositions.includes(posKey)) {
            facePositions.push(posKey);
          }
        }
      }

      const edges: string[] = [];
      for (let i = 0; i < facePositions.length; i++) {
        const p0 = facePositions[i];
        const p1 = facePositions[(i + 1) % facePositions.length];
        const edgeKey = p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;
        edges.push(edgeKey);

        if (!edgeToFaces.has(edgeKey)) {
          edgeToFaces.set(edgeKey, []);
        }
        edgeToFaces.get(edgeKey)!.push(faceIdx);
      }
      faceEdges.set(faceIdx, edges);
    }

    const [v0, v1] = this.parseEdgeKey(startEdgeKey);
    const p0 = getPosKey(mesh.vertices[v0].position);
    const p1 = getPosKey(mesh.vertices[v1].position);
    const startPosEdgeKey = p0 < p1 ? `${p0}|${p1}` : `${p1}|${p0}`;

    // Find the opposite edge in a quad face
    const findOppositeEdge = (
      faceIdx: number,
      enterEdgeKey: string
    ): string | null => {
      const face = mesh.faces[faceIdx];
      if (!face.isQuad) return null;

      const edges = faceEdges.get(faceIdx);
      if (!edges || edges.length !== 4) return null;

      const enterIdx = edges.indexOf(enterEdgeKey);
      if (enterIdx === -1) return null;

      // Opposite edge is 2 positions away in a quad
      const oppositeIdx = (enterIdx + 2) % 4;
      return edges[oppositeIdx];
    };

    const posEdgeToVertexEdge = (posEdgeKey: string): string | null => {
      const [posKey0, posKey1] = posEdgeKey.split("|");
      let found0: number | null = null;
      let found1: number | null = null;

      for (let i = 0; i < mesh.vertices.length; i++) {
        const vPosKey = getPosKey(mesh.vertices[i].position);
        if (vPosKey === posKey0 && found0 === null) found0 = i;
        if (vPosKey === posKey1 && found1 === null) found1 = i;
        if (found0 !== null && found1 !== null) break;
      }

      if (found0 !== null && found1 !== null) {
        return this.makeEdgeKey(found0, found1);
      }
      return null;
    };

    // Traverse through quads, selecting opposite edges
    const traverse = (currentPosEdge: string, visitedFaces: Set<number>) => {
      let edge = currentPosEdge;

      while (true) {
        const faces = edgeToFaces.get(edge);
        if (!faces) break;

        let nextFace: number | null = null;
        for (const faceIdx of faces) {
          if (!visitedFaces.has(faceIdx)) {
            nextFace = faceIdx;
            break;
          }
        }

        if (nextFace === null) break;
        visitedFaces.add(nextFace);

        const oppositeEdge = findOppositeEdge(nextFace, edge);
        if (!oppositeEdge) break;

        const vertexEdge = posEdgeToVertexEdge(oppositeEdge);
        if (vertexEdge) {
          ringEdges.add(vertexEdge);
        }

        edge = oppositeEdge;
      }
    };

    // Traverse in both directions from the starting edge
    const visitedFaces = new Set<number>();
    traverse(startPosEdgeKey, visitedFaces);

    // Try the other direction
    const faces = edgeToFaces.get(startPosEdgeKey);
    if (faces && faces.length === 2) {
      const visitedForOtherDir = new Set<number>();
      visitedForOtherDir.add(faces[0]);
      traverse(startPosEdgeKey, visitedForOtherDir);
    }

    return ringEdges;
  }

  /**
   * Find edges connected to a vertex
   */
  getEdgesAtVertex(mesh: Mesh, vertexIdx: number): string[] {
    const edges: string[] = [];
    const allEdges = this.getMeshEdges(mesh);

    for (const edge of allEdges) {
      if (edge.v0 === vertexIdx || edge.v1 === vertexIdx) {
        edges.push(this.makeEdgeKey(edge.v0, edge.v1));
      }
    }

    return edges;
  }

  /**
   * Find the edge at a vertex that is closest to a given screen direction.
   * Used to determine edge loop/ring direction when Alt+clicking a vertex.
   */
  findEdgeInDirection(
    mesh: Mesh,
    vertexIdx: number,
    mouseScreenX: number,
    mouseScreenY: number,
    vertexScreenX: number,
    vertexScreenY: number,
    projectToScreen: (vIdx: number) => { x: number; y: number } | null
  ): string | null {
    const edges = this.getEdgesAtVertex(mesh, vertexIdx);
    if (edges.length === 0) return null;

    const dirX = mouseScreenX - vertexScreenX;
    const dirY = mouseScreenY - vertexScreenY;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dirLen < 0.001) {
      return edges[0];
    }
    const normDirX = dirX / dirLen;
    const normDirY = dirY / dirLen;

    let bestEdge: string | null = null;
    let bestDot = -Infinity;

    for (const edgeKey of edges) {
      const [v0, v1] = this.parseEdgeKey(edgeKey);
      const otherVertex = v0 === vertexIdx ? v1 : v0;

      const otherScreen = projectToScreen(otherVertex);
      if (!otherScreen) continue;

      const edgeDirX = otherScreen.x - vertexScreenX;
      const edgeDirY = otherScreen.y - vertexScreenY;
      const edgeLen = Math.sqrt(edgeDirX * edgeDirX + edgeDirY * edgeDirY);
      if (edgeLen < 0.001) continue;

      const normEdgeDirX = edgeDirX / edgeLen;
      const normEdgeDirY = edgeDirY / edgeLen;

      const dot = normDirX * normEdgeDirX + normDirY * normEdgeDirY;

      if (dot > bestDot) {
        bestDot = dot;
        bestEdge = edgeKey;
      }
    }

    return bestEdge;
  }

  // ==================== Serialization ====================

  /**
   * Get current selection state for serialization
   */
  getState(): SelectionState {
    return {
      mode: this._mode,
      vertices: [...this._selectedVertices],
      edges: [...this._selectedEdges],
      faces: [...this._selectedFaces],
    };
  }

  /**
   * Restore selection state from serialization
   */
  setState(state: SelectionState): void {
    this._mode = state.mode;
    this._selectedVertices = new Set(state.vertices);
    this._selectedEdges = new Set(state.edges);
    this._selectedFaces = new Set(state.faces);
    this.notifyChange();
  }
}
