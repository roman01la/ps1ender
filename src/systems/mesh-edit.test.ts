/**
 * Unit tests for mesh-edit.ts - Mesh editing operations
 *
 * Tests cover:
 * - Delete vertices, edges, faces
 * - Extrude vertices, edges, faces
 * - Join vertices (create edges)
 * - Fill edges (create faces)
 * - Remove unused vertices
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { MeshEditManager } from "./mesh-edit";
import { Mesh, Vertex } from "../primitives";
import { Vector3, Color } from "../math";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple triangle mesh for testing
 */
function createTriangleMesh(): Mesh {
  const vertices = [
    new Vertex(new Vector3(0, 0, 0), Color.white()),
    new Vertex(new Vector3(1, 0, 0), Color.white()),
    new Vertex(new Vector3(0.5, 1, 0), Color.white()),
  ];

  const mesh = new Mesh(vertices);
  mesh.faceData = [{ vertices: [0, 1, 2] }];
  mesh.rebuildFromFaces();

  return mesh;
}

/**
 * Create a quad mesh (two triangles forming a square)
 */
function createQuadMesh(): Mesh {
  const vertices = [
    new Vertex(new Vector3(0, 0, 0), Color.white()), // 0: bottom-left
    new Vertex(new Vector3(1, 0, 0), Color.white()), // 1: bottom-right
    new Vertex(new Vector3(1, 1, 0), Color.white()), // 2: top-right
    new Vertex(new Vector3(0, 1, 0), Color.white()), // 3: top-left
  ];

  const mesh = new Mesh(vertices);
  mesh.faceData = [{ vertices: [0, 1, 2, 3] }];
  mesh.rebuildFromFaces();

  return mesh;
}

/**
 * Create a cube mesh (8 vertices, 6 quad faces)
 */
function createCubeMesh(): Mesh {
  const vertices = [
    // Front face (z = 1)
    new Vertex(new Vector3(-1, -1, 1), Color.white()),
    new Vertex(new Vector3(1, -1, 1), Color.white()),
    new Vertex(new Vector3(1, 1, 1), Color.white()),
    new Vertex(new Vector3(-1, 1, 1), Color.white()),
    // Back face (z = -1)
    new Vertex(new Vector3(-1, -1, -1), Color.white()),
    new Vertex(new Vector3(1, -1, -1), Color.white()),
    new Vertex(new Vector3(1, 1, -1), Color.white()),
    new Vertex(new Vector3(-1, 1, -1), Color.white()),
  ];

  const mesh = new Mesh(vertices);
  mesh.faceData = [
    { vertices: [0, 1, 2, 3] }, // front
    { vertices: [5, 4, 7, 6] }, // back
    { vertices: [4, 0, 3, 7] }, // left
    { vertices: [1, 5, 6, 2] }, // right
    { vertices: [3, 2, 6, 7] }, // top
    { vertices: [4, 5, 1, 0] }, // bottom
  ];
  mesh.rebuildFromFaces();

  return mesh;
}

/**
 * Create a simple mesh with two disconnected triangles
 */
function createTwoTrianglesMesh(): Mesh {
  const vertices = [
    // First triangle
    new Vertex(new Vector3(0, 0, 0), Color.white()),
    new Vertex(new Vector3(1, 0, 0), Color.white()),
    new Vertex(new Vector3(0.5, 1, 0), Color.white()),
    // Second triangle (offset)
    new Vertex(new Vector3(3, 0, 0), Color.white()),
    new Vertex(new Vector3(4, 0, 0), Color.white()),
    new Vertex(new Vector3(3.5, 1, 0), Color.white()),
  ];

  const mesh = new Mesh(vertices);
  mesh.faceData = [{ vertices: [0, 1, 2] }, { vertices: [3, 4, 5] }];
  mesh.rebuildFromFaces();

  return mesh;
}

// ============================================================================
// Delete Vertices Tests
// ============================================================================

describe("MeshEditManager - Delete Vertices", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should delete single vertex and affected faces", () => {
    const mesh = createTriangleMesh();
    const initialVertexCount = mesh.vertices.length;

    const result = manager.deleteVertices(mesh, new Set([0]));

    expect(result.success).toBe(true);
    expect(result.deletedFaces).toBeGreaterThan(0);
    expect(mesh.vertices.length).toBeLessThan(initialVertexCount);
  });

  test("should return false for empty selection", () => {
    const mesh = createTriangleMesh();

    const result = manager.deleteVertices(mesh, new Set());

    expect(result.success).toBe(false);
    expect(result.deletedFaces).toBe(0);
    expect(result.deletedVertices).toBe(0);
  });

  test("should delete all vertices and faces from triangle", () => {
    const mesh = createTriangleMesh();

    const result = manager.deleteVertices(mesh, new Set([0, 1, 2]));

    expect(result.success).toBe(true);
    expect(mesh.vertices.length).toBe(0);
    expect(mesh.faceData.length).toBe(0);
  });

  test("should only delete one triangle from two-triangle mesh", () => {
    const mesh = createTwoTrianglesMesh();

    const result = manager.deleteVertices(mesh, new Set([0, 1, 2]));

    expect(result.success).toBe(true);
    expect(mesh.faceData.length).toBe(1);
    // Should have 3 vertices remaining (second triangle)
    expect(mesh.vertices.length).toBe(3);
  });

  test("should remap vertex indices after deletion", () => {
    const mesh = createCubeMesh();
    const originalVertexCount = mesh.vertices.length;

    // Delete a vertex from the front face
    manager.deleteVertices(mesh, new Set([0]));

    // Verify all face indices are valid
    for (const face of mesh.faceData) {
      for (const vIdx of face.vertices) {
        expect(vIdx).toBeGreaterThanOrEqual(0);
        expect(vIdx).toBeLessThan(mesh.vertices.length);
      }
    }
  });
});

// ============================================================================
// Delete Edges Tests
// ============================================================================

describe("MeshEditManager - Delete Edges", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should delete faces containing selected edge", () => {
    const mesh = createTriangleMesh();

    // Delete edge between vertices 0 and 1
    const result = manager.deleteEdges(mesh, new Set(["0-1"]));

    expect(result.success).toBe(true);
    expect(result.deletedFaces).toBeGreaterThan(0);
  });

  test("should return false for empty selection", () => {
    const mesh = createTriangleMesh();

    const result = manager.deleteEdges(mesh, new Set());

    expect(result.success).toBe(false);
  });

  test("should return false for non-existent edge", () => {
    const mesh = createTriangleMesh();

    // Edge 0-5 doesn't exist in a 3-vertex mesh
    const result = manager.deleteEdges(mesh, new Set(["0-5"]));

    // Should succeed but delete nothing (edge doesn't form part of any face)
    expect(result.deletedFaces).toBe(0);
  });

  test("should handle reversed edge key", () => {
    const mesh = createTriangleMesh();

    // Edge 1-0 is same as 0-1
    const result = manager.deleteEdges(mesh, new Set(["1-0"]));

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Delete Faces Tests
// ============================================================================

describe("MeshEditManager - Delete Faces", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should delete single face", () => {
    const mesh = createTwoTrianglesMesh();

    const result = manager.deleteFaces(mesh, new Set([0]));

    expect(result.success).toBe(true);
    expect(result.deletedFaces).toBe(1);
    expect(mesh.faceData.length).toBe(1);
  });

  test("should return false for empty selection", () => {
    const mesh = createTriangleMesh();

    const result = manager.deleteFaces(mesh, new Set());

    expect(result.success).toBe(false);
    expect(result.deletedFaces).toBe(0);
  });

  test("should delete multiple faces", () => {
    const mesh = createCubeMesh();
    const initialFaceCount = mesh.faceData.length;

    const result = manager.deleteFaces(mesh, new Set([0, 1]));

    expect(result.success).toBe(true);
    expect(mesh.faceData.length).toBe(initialFaceCount - 2);
  });

  test("should clean up unused vertices after face deletion", () => {
    const mesh = createTwoTrianglesMesh();

    // Delete first face
    manager.deleteFaces(mesh, new Set([0]));

    // Should only have 3 vertices left (for remaining triangle)
    expect(mesh.vertices.length).toBe(3);
  });
});

// ============================================================================
// Remove Unused Vertices Tests
// ============================================================================

describe("MeshEditManager - Remove Unused Vertices", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should return 0 when all vertices are used", () => {
    const mesh = createTriangleMesh();

    const removed = manager.removeUnusedVertices(mesh);

    expect(removed).toBe(0);
  });

  test("should remove orphaned vertices", () => {
    const mesh = createTriangleMesh();
    // Add an orphaned vertex
    mesh.vertices.push(new Vertex(new Vector3(10, 10, 10), Color.white()));

    const removed = manager.removeUnusedVertices(mesh);

    expect(removed).toBe(1);
    expect(mesh.vertices.length).toBe(3);
  });

  test("should update faceData indices after removal", () => {
    const mesh = createTriangleMesh();
    // Add orphaned vertex at beginning
    mesh.vertices.unshift(new Vertex(new Vector3(10, 10, 10), Color.white()));
    // Manually update indices (normally done by rebuildFromFaces)
    mesh.indices = [1, 2, 3];
    mesh.faceData = [{ vertices: [1, 2, 3] }];

    manager.removeUnusedVertices(mesh);

    // Check that face indices were remapped
    expect(mesh.faceData[0].vertices).toEqual([0, 1, 2]);
  });
});

// ============================================================================
// Extrude Vertices Tests
// ============================================================================

describe("MeshEditManager - Extrude Vertices", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should create new vertices from selected vertices", () => {
    const mesh = createTriangleMesh();
    const initialVertexCount = mesh.vertices.length;

    const result = manager.extrudeVertices(mesh, new Set([0]));

    expect(result.success).toBe(true);
    expect(result.newVertices.size).toBe(1);
    expect(mesh.vertices.length).toBe(initialVertexCount + 1);
  });

  test("should create new vertices at same position", () => {
    const mesh = createTriangleMesh();
    const originalPos = mesh.vertices[0].position.clone();

    const result = manager.extrudeVertices(mesh, new Set([0]));

    const newVertIdx = Array.from(result.newVertices)[0];
    const newPos = mesh.vertices[newVertIdx].position;

    expect(newPos.x).toBe(originalPos.x);
    expect(newPos.y).toBe(originalPos.y);
    expect(newPos.z).toBe(originalPos.z);
  });

  test("should return false for empty selection", () => {
    const mesh = createTriangleMesh();

    const result = manager.extrudeVertices(mesh, new Set());

    expect(result.success).toBe(false);
    expect(result.newVertices.size).toBe(0);
  });

  test("should extrude multiple vertices", () => {
    const mesh = createTriangleMesh();

    const result = manager.extrudeVertices(mesh, new Set([0, 1, 2]));

    expect(result.success).toBe(true);
    expect(result.newVertices.size).toBe(3);
  });

  test("should create edges connecting original to new vertices", () => {
    const mesh = createTriangleMesh();

    const result = manager.extrudeVertices(mesh, new Set([0]));

    expect(result.newEdges.size).toBe(1);
  });
});

// ============================================================================
// Extrude Edges Tests
// ============================================================================

describe("MeshEditManager - Extrude Edges", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should create new vertices for edge vertices", () => {
    const mesh = createTriangleMesh();
    const initialVertexCount = mesh.vertices.length;

    const result = manager.extrudeEdges(mesh, new Set(["0-1"]));

    expect(result.success).toBe(true);
    expect(result.newVertices.size).toBe(2);
    expect(mesh.vertices.length).toBe(initialVertexCount + 2);
  });

  test("should return false for empty selection", () => {
    const mesh = createTriangleMesh();

    const result = manager.extrudeEdges(mesh, new Set());

    expect(result.success).toBe(false);
  });

  test("should create quad face connecting original and new edge", () => {
    const mesh = createTriangleMesh();
    const initialFaceCount = mesh.faceData.length;

    manager.extrudeEdges(mesh, new Set(["0-1"]));

    // Should have added a quad face
    expect(mesh.faceData.length).toBeGreaterThan(initialFaceCount);
  });

  test("should create new edges for the extruded geometry", () => {
    const mesh = createTriangleMesh();

    const result = manager.extrudeEdges(mesh, new Set(["0-1"]));

    // Should have edges: 0-newV0, 1-newV1, newV0-newV1
    expect(result.newEdges.size).toBe(3);
  });

  test("should extrude multiple edges", () => {
    const mesh = createQuadMesh();

    const result = manager.extrudeEdges(mesh, new Set(["0-1", "2-3"]));

    expect(result.success).toBe(true);
    expect(result.newVertices.size).toBe(4);
  });
});

// ============================================================================
// Join Vertices Tests
// ============================================================================

describe("MeshEditManager - Join Vertices", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should join exactly two vertices with an edge", () => {
    const mesh = createTwoTrianglesMesh();

    const result = manager.joinVertices(mesh, new Set([2, 3]));

    expect(result.success).toBe(true);
    expect(result.edgeKey).toBe("2-3");
  });

  test("should return false for single vertex", () => {
    const mesh = createTriangleMesh();

    const result = manager.joinVertices(mesh, new Set([0]));

    expect(result.success).toBe(false);
  });

  test("should return false for more than two vertices", () => {
    const mesh = createTriangleMesh();

    const result = manager.joinVertices(mesh, new Set([0, 1, 2]));

    expect(result.success).toBe(false);
  });

  test("should return false for empty selection", () => {
    const mesh = createTriangleMesh();

    const result = manager.joinVertices(mesh, new Set());

    expect(result.success).toBe(false);
  });

  test("should return false if edge already exists", () => {
    const mesh = createTriangleMesh();

    // Edge 0-1 already exists in the triangle
    const result = manager.joinVertices(mesh, new Set([0, 1]));

    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Fill Edges Tests
// ============================================================================

describe("MeshEditManager - Fill Edges", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should return false for less than 2 edges", () => {
    const mesh = createQuadMesh();

    const result = manager.fillEdges(mesh, new Set(["0-1"]));

    expect(result.success).toBe(false);
  });

  test("should return false for empty selection", () => {
    const mesh = createQuadMesh();

    const result = manager.fillEdges(mesh, new Set());

    expect(result.success).toBe(false);
  });

  test("should create triangle from 2 edges sharing a vertex", () => {
    // Create mesh with an open corner (like an L-shape)
    const vertices = [
      new Vertex(new Vector3(0, 0, 0), Color.white()), // 0: corner
      new Vertex(new Vector3(1, 0, 0), Color.white()), // 1: right
      new Vertex(new Vector3(0, 1, 0), Color.white()), // 2: up
    ];
    const mesh = new Mesh(vertices);
    // Create two edges forming an L
    mesh.indices = [0, 1, 0, 0, 2, 0]; // degenerate triangles for edges
    mesh.faceData = [];
    mesh.rebuildMesh();

    const result = manager.fillEdges(mesh, new Set(["0-1", "0-2"]));

    expect(result.success).toBe(true);
    expect(result.faceIndex).toBeGreaterThanOrEqual(0);
  });

  test("should create quad from 2 opposite edges", () => {
    // Create 4 vertices forming a square without faces
    const vertices = [
      new Vertex(new Vector3(0, 0, 0), Color.white()), // 0: bottom-left
      new Vertex(new Vector3(1, 0, 0), Color.white()), // 1: bottom-right
      new Vertex(new Vector3(1, 1, 0), Color.white()), // 2: top-right
      new Vertex(new Vector3(0, 1, 0), Color.white()), // 3: top-left
    ];
    const mesh = new Mesh(vertices);
    mesh.faceData = [];
    mesh.indices = [];
    mesh.rebuildMesh();

    // Select bottom edge (0-1) and top edge (2-3)
    const result = manager.fillEdges(mesh, new Set(["0-1", "2-3"]));

    expect(result.success).toBe(true);
    expect(mesh.faceData.length).toBe(1);
    expect(mesh.faceData[0].vertices.length).toBe(4);
  });
});

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

describe("MeshEditManager - Edge Cases", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("should handle deleting vertex that doesn't exist", () => {
    const mesh = createTriangleMesh();

    // Try to delete vertex index that's out of bounds
    const result = manager.deleteVertices(mesh, new Set([100]));

    // Should succeed but not actually delete anything (no faces reference it)
    expect(mesh.vertices.length).toBe(3);
  });

  test("should handle sequential operations", () => {
    const mesh = createCubeMesh();

    // Extrude an edge
    const extrudeResult = manager.extrudeEdges(mesh, new Set(["0-1"]));
    expect(extrudeResult.success).toBe(true);

    // Delete the new vertices
    const deleteResult = manager.deleteVertices(
      mesh,
      extrudeResult.newVertices
    );
    expect(deleteResult.success).toBe(true);
  });

  test("should handle empty mesh operations", () => {
    const mesh = new Mesh([]);
    mesh.faceData = [];
    mesh.indices = [];

    // deleteVertices returns success:true when vertex doesn't exist (no-op)
    const deleteResult = manager.deleteVertices(mesh, new Set([0]));
    expect(deleteResult.deletedFaces).toBe(0);
    expect(deleteResult.deletedVertices).toBe(0);

    // extrudeVertices with empty selection returns false
    const extrudeResult = manager.extrudeVertices(mesh, new Set());
    expect(extrudeResult.success).toBe(false);
  });
});

describe("MeshEditManager - Mesh Integrity", () => {
  let manager: MeshEditManager;

  beforeEach(() => {
    manager = new MeshEditManager();
  });

  test("face indices should remain valid after vertex deletion", () => {
    const mesh = createCubeMesh();

    manager.deleteVertices(mesh, new Set([0]));

    for (const face of mesh.faceData) {
      for (const vIdx of face.vertices) {
        expect(vIdx).toBeGreaterThanOrEqual(0);
        expect(vIdx).toBeLessThan(mesh.vertices.length);
      }
    }
  });

  test("face indices should remain valid after edge extrusion", () => {
    const mesh = createTriangleMesh();

    manager.extrudeEdges(mesh, new Set(["0-1"]));

    for (const face of mesh.faceData) {
      for (const vIdx of face.vertices) {
        expect(vIdx).toBeGreaterThanOrEqual(0);
        expect(vIdx).toBeLessThan(mesh.vertices.length);
      }
    }
  });

  test("mesh should rebuild correctly after multiple operations", () => {
    const mesh = createQuadMesh();

    // Extrude edge
    manager.extrudeEdges(mesh, new Set(["0-1"]));

    // Delete a face
    manager.deleteFaces(mesh, new Set([0]));

    // Mesh should still be valid
    expect(mesh.vertices.length).toBeGreaterThan(0);
    for (const face of mesh.faceData) {
      expect(face.vertices.length).toBeGreaterThanOrEqual(3);
    }
  });
});
