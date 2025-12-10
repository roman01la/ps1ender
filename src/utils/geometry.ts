/**
 * Geometry Utilities - Shared utilities for mesh and geometry operations
 *
 * This module centralizes common geometry operations to avoid duplication:
 * - Edge key creation and parsing
 * - Position key generation for vertex comparison
 * - Mesh edge extraction
 */

import { Vector3 } from "../math";
import { Mesh } from "../primitives";

// ==================== Constants ====================

/**
 * Epsilon value for position comparisons.
 * Used when comparing vertex positions for co-location detection.
 */
export const POSITION_EPSILON = 0.0001;

// ==================== Edge Key Utilities ====================

/**
 * Create a canonical edge key from two vertex indices.
 * The key is sorted so that edge (a,b) and edge (b,a) produce the same key.
 *
 * @param v0 First vertex index
 * @param v1 Second vertex index
 * @returns A string key in format "min-max"
 */
export function makeEdgeKey(v0: number, v1: number): string {
  return v0 < v1 ? `${v0}-${v1}` : `${v1}-${v0}`;
}

/**
 * Parse an edge key back into vertex indices.
 *
 * @param key Edge key in format "v0-v1"
 * @returns Tuple of [v0, v1] vertex indices
 */
export function parseEdgeKey(key: string): [number, number] {
  const [a, b] = key.split("-").map(Number);
  return [a, b];
}

// ==================== Position Key Utilities ====================

/**
 * Create a position key from a Vector3 for hashing/comparison.
 * Uses POSITION_EPSILON for rounding to handle floating point imprecision.
 *
 * @param pos The position vector
 * @returns A string key representing the position
 */
export function getPositionKey(pos: Vector3): string {
  return `${Math.round(pos.x / POSITION_EPSILON)},${Math.round(
    pos.y / POSITION_EPSILON
  )},${Math.round(pos.z / POSITION_EPSILON)}`;
}

/**
 * Check if two positions are equal within POSITION_EPSILON tolerance.
 *
 * @param a First position
 * @param b Second position
 * @returns True if positions are within epsilon of each other
 */
export function positionsEqual(a: Vector3, b: Vector3): boolean {
  return (
    Math.abs(a.x - b.x) < POSITION_EPSILON &&
    Math.abs(a.y - b.y) < POSITION_EPSILON &&
    Math.abs(a.z - b.z) < POSITION_EPSILON
  );
}

// ==================== Edge Representation ====================

/**
 * Edge representation with vertex indices
 */
export interface Edge {
  v0: number;
  v1: number;
}

// ==================== Mesh Edge Extraction ====================

/**
 * Get all unique edges from a mesh.
 *
 * @param mesh The mesh to extract edges from
 * @param skipQuadDiagonals If true, excludes internal diagonal edges inside quads
 * @returns Array of edges with vertex indices
 */
export function getMeshEdges(
  mesh: Mesh,
  skipQuadDiagonals: boolean = false
): Edge[] {
  const edgeSet = new Set<string>();
  const edges: Edge[] = [];

  // Get quad diagonal edges to skip if requested
  const diagonalEdges = skipQuadDiagonals
    ? mesh.getQuadDiagonalEdges()
    : new Set<string>();

  // Helper to check if an edge is a diagonal
  const isDiagonal = (i0: number, i1: number): boolean => {
    if (!skipQuadDiagonals) return false;
    const p0 = mesh.vertices[i0].position;
    const p1 = mesh.vertices[i1].position;
    const key1 = `${getPositionKey(p0)}|${getPositionKey(p1)}`;
    const key2 = `${getPositionKey(p1)}|${getPositionKey(p0)}`;
    return diagonalEdges.has(key1) || diagonalEdges.has(key2);
  };

  // Process each triangle
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i];
    const i1 = mesh.indices[i + 1];
    const i2 = mesh.indices[i + 2];

    // Skip degenerate triangles (edge-only triangles like [a, b, a])
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      // For degenerate triangles, only add the actual edge
      if (i0 !== i1) {
        const key = makeEdgeKey(i0, i1);
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ v0: i0, v1: i1 });
        }
      } else if (i1 !== i2) {
        const key = makeEdgeKey(i1, i2);
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ v0: i1, v1: i2 });
        }
      } else if (i0 !== i2) {
        const key = makeEdgeKey(i0, i2);
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ v0: i0, v1: i2 });
        }
      }
      continue;
    }

    // Add each edge of the triangle
    const triEdges: [number, number][] = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];

    for (const [a, b] of triEdges) {
      // Skip diagonal edges if requested
      if (isDiagonal(a, b)) continue;

      const key = makeEdgeKey(a, b);
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ v0: a, v1: b });
      }
    }
  }

  return edges;
}
