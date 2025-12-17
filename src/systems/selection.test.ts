/**
 * Unit tests for the Selection System
 *
 * Tests the SelectionManager class and its various methods for managing
 * vertex, edge, and face selection in edit mode.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { SelectionManager } from "./selection";
import { Mesh, Vertex } from "../primitives";
import { Vector3, Color } from "../math";

/**
 * Helper function to create a simple cube mesh for testing
 */
function createCubeMesh(): Mesh {
  const vertices = [
    // Front face (z = 1)
    new Vertex(new Vector3(-1, -1, 1), Color.white()),  // 0
    new Vertex(new Vector3(1, -1, 1), Color.white()),   // 1
    new Vertex(new Vector3(1, 1, 1), Color.white()),    // 2
    new Vertex(new Vector3(-1, 1, 1), Color.white()),   // 3
    // Back face (z = -1)
    new Vertex(new Vector3(-1, -1, -1), Color.white()), // 4
    new Vertex(new Vector3(1, -1, -1), Color.white()),  // 5
    new Vertex(new Vector3(1, 1, -1), Color.white()),   // 6
    new Vertex(new Vector3(-1, 1, -1), Color.white()),  // 7
  ];

  const mesh = new Mesh(vertices);
  
  // Define cube faces (6 quad faces)
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
 * Helper function to create a simple triangle mesh for testing
 */
function createTriangleMesh(): Mesh {
  const vertices = [
    new Vertex(new Vector3(0, 0, 0), Color.white()),   // 0
    new Vertex(new Vector3(1, 0, 0), Color.white()),   // 1
    new Vertex(new Vector3(0.5, 1, 0), Color.white()), // 2
  ];

  const mesh = new Mesh(vertices);
  mesh.faceData = [{ vertices: [0, 1, 2] }];
  mesh.rebuildFromFaces();

  return mesh;
}

describe("SelectionManager - Basic Operations", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should initialize with vertex mode", () => {
    expect(selection.mode).toBe("vertex");
  });

  test("should initialize with empty selection", () => {
    expect(selection.selectedVertices.size).toBe(0);
    expect(selection.selectedEdges.size).toBe(0);
    expect(selection.selectedFaces.size).toBe(0);
    expect(selection.hasSelection()).toBe(false);
  });

  test("should trigger onChange callback when selection changes", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    selection.addVertex(0);
    expect(callbackCount).toBe(1);

    selection.addVertex(1);
    expect(callbackCount).toBe(2);

    // Should not trigger if adding same vertex
    selection.addVertex(0);
    expect(callbackCount).toBe(2);
  });

  test("should not trigger onChange callback when cleared with null", () => {
    selection.setOnChange(null);
    selection.addVertex(0);
    // Should not throw
    expect(selection.selectedVertices.size).toBe(1);
  });
});

describe("SelectionManager - Vertex Selection", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should add vertices to selection", () => {
    selection.addVertex(0);
    selection.addVertex(1);
    selection.addVertex(2);

    expect(selection.selectedVertices.size).toBe(3);
    expect(selection.selectedVertices.has(0)).toBe(true);
    expect(selection.selectedVertices.has(1)).toBe(true);
    expect(selection.selectedVertices.has(2)).toBe(true);
    expect(selection.hasSelection()).toBe(true);
  });

  test("should remove vertices from selection", () => {
    selection.addVertex(0);
    selection.addVertex(1);
    selection.removeVertex(0);

    expect(selection.selectedVertices.size).toBe(1);
    expect(selection.selectedVertices.has(0)).toBe(false);
    expect(selection.selectedVertices.has(1)).toBe(true);
  });

  test("should toggle vertex selection", () => {
    selection.toggleVertex(0);
    expect(selection.selectedVertices.has(0)).toBe(true);

    selection.toggleVertex(0);
    expect(selection.selectedVertices.has(0)).toBe(false);
  });

  test("should set vertices (replace current selection)", () => {
    selection.addVertex(0);
    selection.addVertex(1);
    selection.setVertices([2, 3, 4]);

    expect(selection.selectedVertices.size).toBe(3);
    expect(selection.selectedVertices.has(0)).toBe(false);
    expect(selection.selectedVertices.has(1)).toBe(false);
    expect(selection.selectedVertices.has(2)).toBe(true);
    expect(selection.selectedVertices.has(3)).toBe(true);
    expect(selection.selectedVertices.has(4)).toBe(true);
  });

  test("should add multiple vertices", () => {
    selection.addVertices([0, 1, 2]);
    expect(selection.selectedVertices.size).toBe(3);
    
    selection.addVertices([3, 4]);
    expect(selection.selectedVertices.size).toBe(5);
  });
});

describe("SelectionManager - Edge Selection", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
    selection.setMode("edge"); // Set to edge mode
  });

  test("should add edges to selection", () => {
    selection.addEdge(0, 1);
    selection.addEdge(1, 2);

    expect(selection.selectedEdges.size).toBe(2);
    expect(selection.hasSelection()).toBe(true);
  });

  test("should create canonical edge keys (sorted)", () => {
    selection.addEdge(1, 0);
    selection.addEdge(0, 1);

    // Both should create same edge key
    expect(selection.selectedEdges.size).toBe(1);
  });

  test("should remove edges from selection", () => {
    selection.addEdge(0, 1);
    selection.addEdge(1, 2);
    selection.removeEdge(0, 1);

    expect(selection.selectedEdges.size).toBe(1);
    expect(selection.selectedEdges.has(selection.makeEdgeKey(0, 1))).toBe(false);
  });

  test("should toggle edge selection", () => {
    selection.toggleEdge(0, 1);
    expect(selection.selectedEdges.has(selection.makeEdgeKey(0, 1))).toBe(true);

    selection.toggleEdge(0, 1);
    expect(selection.selectedEdges.has(selection.makeEdgeKey(0, 1))).toBe(false);
  });

  test("should set edges (replace current selection)", () => {
    selection.addEdge(0, 1);
    selection.setEdges(["2-3", "4-5"]);

    expect(selection.selectedEdges.size).toBe(2);
    expect(selection.selectedEdges.has("0-1")).toBe(false);
    expect(selection.selectedEdges.has("2-3")).toBe(true);
    expect(selection.selectedEdges.has("4-5")).toBe(true);
  });

  test("should add edge by key", () => {
    selection.addEdgeByKey("0-1");
    expect(selection.selectedEdges.has("0-1")).toBe(true);
  });
});

describe("SelectionManager - Face Selection", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
    selection.setMode("face"); // Set to face mode
  });

  test("should add faces to selection", () => {
    selection.addFace(0);
    selection.addFace(1);

    expect(selection.selectedFaces.size).toBe(2);
    expect(selection.selectedFaces.has(0)).toBe(true);
    expect(selection.selectedFaces.has(1)).toBe(true);
    expect(selection.hasSelection()).toBe(true);
  });

  test("should remove faces from selection", () => {
    selection.addFace(0);
    selection.addFace(1);
    selection.removeFace(0);

    expect(selection.selectedFaces.size).toBe(1);
    expect(selection.selectedFaces.has(0)).toBe(false);
    expect(selection.selectedFaces.has(1)).toBe(true);
  });

  test("should toggle face selection", () => {
    selection.toggleFace(0);
    expect(selection.selectedFaces.has(0)).toBe(true);

    selection.toggleFace(0);
    expect(selection.selectedFaces.has(0)).toBe(false);
  });

  test("should set faces (replace current selection)", () => {
    selection.addFace(0);
    selection.addFace(1);
    selection.setFaces([2, 3]);

    expect(selection.selectedFaces.size).toBe(2);
    expect(selection.selectedFaces.has(0)).toBe(false);
    expect(selection.selectedFaces.has(1)).toBe(false);
    expect(selection.selectedFaces.has(2)).toBe(true);
    expect(selection.selectedFaces.has(3)).toBe(true);
  });

  test("should add multiple faces", () => {
    selection.addFaces([0, 1]);
    expect(selection.selectedFaces.size).toBe(2);
    
    selection.addFaces([2, 3]);
    expect(selection.selectedFaces.size).toBe(4);
  });
});

describe("SelectionManager - Edge Key Utilities", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should create canonical edge keys", () => {
    expect(selection.makeEdgeKey(0, 1)).toBe("0-1");
    expect(selection.makeEdgeKey(1, 0)).toBe("0-1");
    expect(selection.makeEdgeKey(5, 3)).toBe("3-5");
  });

  test("should parse edge keys", () => {
    const [v0, v1] = selection.parseEdgeKey("3-7");
    expect(v0).toBe(3);
    expect(v1).toBe(7);
  });

  test("should get mesh edges", () => {
    const mesh = createTriangleMesh();
    const edges = selection.getMeshEdges(mesh);

    expect(edges.length).toBe(3);
    // Triangle should have 3 edges
    expect(edges.some(e => (e.v0 === 0 && e.v1 === 1) || (e.v0 === 1 && e.v1 === 0))).toBe(true);
    expect(edges.some(e => (e.v0 === 1 && e.v1 === 2) || (e.v0 === 2 && e.v1 === 1))).toBe(true);
    expect(edges.some(e => (e.v0 === 2 && e.v1 === 0) || (e.v0 === 0 && e.v1 === 2))).toBe(true);
  });
});

describe("SelectionManager - Selection Mode", () => {
  let selection: SelectionManager;
  let mesh: Mesh;

  beforeEach(() => {
    selection = new SelectionManager();
    mesh = createCubeMesh();
  });

  test("should change selection mode", () => {
    selection.setMode("edge");
    expect(selection.mode).toBe("edge");

    selection.setMode("face");
    expect(selection.mode).toBe("face");

    selection.setMode("vertex");
    expect(selection.mode).toBe("vertex");
  });

  test("should not change if mode is the same", () => {
    selection.addVertex(0);
    selection.setMode("vertex");
    expect(selection.selectedVertices.size).toBe(1);
  });

  test("should clear selection when changing mode without mesh", () => {
    selection.addVertex(0);
    selection.addVertex(1);
    selection.setMode("edge");

    expect(selection.selectedVertices.size).toBe(0);
    expect(selection.selectedEdges.size).toBe(0);
  });
});

describe("SelectionManager - Clear Operations", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should clear all selections", () => {
    selection.addVertex(0);
    selection.addVertex(1);
    selection.clearAll();

    expect(selection.selectedVertices.size).toBe(0);
    expect(selection.hasSelection()).toBe(false);
  });

  test("should trigger onChange when clearing selection", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    selection.addVertex(0);
    expect(callbackCount).toBe(1);

    selection.clearAll();
    expect(callbackCount).toBe(2);
  });

  test("should not trigger onChange when clearing empty selection", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    selection.clearAll();
    expect(callbackCount).toBe(0);
  });
});

describe("SelectionManager - Select All", () => {
  let selection: SelectionManager;
  let mesh: Mesh;

  beforeEach(() => {
    selection = new SelectionManager();
    mesh = createCubeMesh();
  });

  test("should select all vertices in vertex mode", () => {
    selection.setMode("vertex");
    selection.selectAll(mesh);

    expect(selection.selectedVertices.size).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(selection.selectedVertices.has(i)).toBe(true);
    }
  });

  test("should select all edges in edge mode", () => {
    selection.setMode("edge", mesh);
    selection.selectAll(mesh);

    // Cube has 12 unique edges
    expect(selection.selectedEdges.size).toBeGreaterThan(0);
  });

  test("should select all faces in face mode", () => {
    selection.setMode("face", mesh);
    selection.selectAll(mesh);

    expect(selection.selectedFaces.size).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(selection.selectedFaces.has(i)).toBe(true);
    }
  });
});

describe("SelectionManager - Serialization", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should get selection state", () => {
    selection.addVertex(0);
    selection.addVertex(1);
    selection.addEdge(2, 3);
    selection.addFace(4);

    const state = selection.getState();

    expect(state.mode).toBe("vertex");
    expect(state.vertices).toEqual([0, 1]);
    expect(state.edges.length).toBe(1);
    expect(state.faces).toEqual([4]);
  });

  test("should restore selection state", () => {
    const state = {
      mode: "edge" as const,
      vertices: [0, 1, 2],
      edges: ["3-4", "5-6"],
      faces: [7, 8],
    };

    selection.setState(state);

    expect(selection.mode).toBe("edge");
    expect(selection.selectedVertices.size).toBe(3);
    expect(selection.selectedEdges.size).toBe(2);
    expect(selection.selectedFaces.size).toBe(2);
  });

  test("should trigger onChange when restoring state", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    const state = {
      mode: "vertex" as const,
      vertices: [0],
      edges: [],
      faces: [],
    };

    selection.setState(state);
    expect(callbackCount).toBe(1);
  });
});

describe("SelectionManager - Read-only Collections", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should return read-only vertex set", () => {
    selection.addVertex(0);
    const vertices = selection.selectedVertices;

    expect(vertices.has(0)).toBe(true);
    expect(vertices.size).toBe(1);
    // ReadonlySet type prevents adding/deleting at compile time
  });

  test("should return read-only edge set", () => {
    selection.addEdge(0, 1);
    const edges = selection.selectedEdges;

    expect(edges.size).toBe(1);
  });

  test("should return read-only face set", () => {
    selection.addFace(0);
    const faces = selection.selectedFaces;

    expect(faces.has(0)).toBe(true);
    expect(faces.size).toBe(1);
  });
});

describe("SelectionManager - Edge Cases", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  test("should handle removing non-existent vertex", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    selection.removeVertex(999);
    expect(callbackCount).toBe(0);
  });

  test("should handle removing non-existent edge", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    selection.removeEdge(999, 1000);
    expect(callbackCount).toBe(0);
  });

  test("should handle removing non-existent face", () => {
    let callbackCount = 0;
    selection.setOnChange(() => callbackCount++);

    selection.removeFace(999);
    expect(callbackCount).toBe(0);
  });

  test("should handle empty mesh in selectAll", () => {
    const emptyMesh = new Mesh([]);
    selection.selectAll(emptyMesh);

    expect(selection.selectedVertices.size).toBe(0);
  });
});
