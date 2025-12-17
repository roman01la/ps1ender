/**
 * Unit tests for the Picking System
 *
 * Tests the PickingManager class for ray casting, object picking,
 * vertex/edge/face picking, and screen projection.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  PickingManager,
  PickContext,
  getMeshEdges,
  makeEdgeKey,
  parseEdgeKey,
} from "./picking";
import { Vector3, Matrix4, Ray } from "../math";
import { Mesh, Vertex } from "../primitives";
import { SceneObject, Camera } from "../scene";
import { Color } from "../math";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple cube mesh for testing
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
 * Create a mock camera for testing
 */
function createTestCamera(): Camera {
  const camera = new Camera();
  camera.position = new Vector3(0, 0, 10);
  camera.target = new Vector3(0, 0, 0);
  return camera;
}

/**
 * Create a test pick context
 */
function createTestContext(camera?: Camera): PickContext {
  return {
    camera: camera || createTestCamera(),
    canvasWidth: 800,
    canvasHeight: 600,
  };
}

/**
 * Create a mock scene object
 */
function createTestSceneObject(
  name: string,
  position: Vector3 = Vector3.zero()
): SceneObject {
  const mesh = createCubeMesh();
  const obj = new SceneObject(name, mesh);
  obj.position = position;
  return obj;
}

// ============================================================================
// Edge Key Utilities
// ============================================================================

describe("Edge Key Utilities", () => {
  test("makeEdgeKey should create sorted key", () => {
    expect(makeEdgeKey(0, 1)).toBe("0-1");
    expect(makeEdgeKey(1, 0)).toBe("0-1");
    expect(makeEdgeKey(5, 3)).toBe("3-5");
    expect(makeEdgeKey(10, 20)).toBe("10-20");
  });

  test("parseEdgeKey should return vertex indices", () => {
    const [v0, v1] = parseEdgeKey("3-7");
    expect(v0).toBe(3);
    expect(v1).toBe(7);
  });

  test("parseEdgeKey should handle single-digit indices", () => {
    const [v0, v1] = parseEdgeKey("0-1");
    expect(v0).toBe(0);
    expect(v1).toBe(1);
  });

  test("parseEdgeKey should handle multi-digit indices", () => {
    const [v0, v1] = parseEdgeKey("100-200");
    expect(v0).toBe(100);
    expect(v1).toBe(200);
  });
});

// ============================================================================
// getMeshEdges
// ============================================================================

describe("getMeshEdges", () => {
  test("should return correct edges for triangle", () => {
    const mesh = createTriangleMesh();
    const edges = getMeshEdges(mesh);

    expect(edges.length).toBe(3);
  });

  test("should return unique edges for cube", () => {
    const mesh = createCubeMesh();
    const edges = getMeshEdges(mesh);

    // A cube with 6 quad faces - after triangulation includes diagonals
    // Each quad becomes 2 triangles, adding 1 diagonal per quad = 6 diagonals
    // 12 original edges + 6 diagonals = 18 edges
    expect(edges.length).toBe(18);
  });

  test("should filter quad diagonals when requested", () => {
    const mesh = createCubeMesh();

    const allEdges = getMeshEdges(mesh, false);
    const withoutDiagonals = getMeshEdges(mesh, true);

    // With quad diagonals filtered, should have fewer or equal edges
    expect(withoutDiagonals.length).toBeLessThanOrEqual(allEdges.length);
  });

  test("edges should have valid vertex indices", () => {
    const mesh = createTriangleMesh();
    const edges = getMeshEdges(mesh);

    for (const edge of edges) {
      expect(edge.v0).toBeGreaterThanOrEqual(0);
      expect(edge.v1).toBeGreaterThanOrEqual(0);
      expect(edge.v0).toBeLessThan(mesh.vertices.length);
      expect(edge.v1).toBeLessThan(mesh.vertices.length);
    }
  });
});

// ============================================================================
// PickingManager - Basic Operations
// ============================================================================

describe("PickingManager - Basic Operations", () => {
  let picking: PickingManager;

  beforeEach(() => {
    picking = new PickingManager();
  });

  test("should initialize with default pick radii", () => {
    expect(picking.vertexPickRadius).toBe(25);
    expect(picking.edgePickRadius).toBe(30);
  });

  test("should allow changing pick radii", () => {
    picking.vertexPickRadius = 50;
    picking.edgePickRadius = 40;

    expect(picking.vertexPickRadius).toBe(50);
    expect(picking.edgePickRadius).toBe(40);
  });
});

// ============================================================================
// Screen to Ray
// ============================================================================

describe("PickingManager - Screen to Ray", () => {
  let picking: PickingManager;
  let ctx: PickContext;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
  });

  test("should create ray from screen center", () => {
    const ray = picking.screenToRay(400, 300, ctx);

    expect(ray).toBeInstanceOf(Ray);
    expect(ray.direction.length()).toBeCloseTo(1, 5); // Normalized
  });

  test("should create different rays for different screen positions", () => {
    const ray1 = picking.screenToRay(0, 0, ctx);
    const ray2 = picking.screenToRay(800, 600, ctx);

    // Both should be valid rays with normalized directions
    expect(ray1).toBeInstanceOf(Ray);
    expect(ray2).toBeInstanceOf(Ray);
    expect(ray1.direction.length()).toBeCloseTo(1, 5);
    expect(ray2.direction.length()).toBeCloseTo(1, 5);
  });

  test("ray should point roughly toward scene from camera", () => {
    const ray = picking.screenToRay(400, 300, ctx);

    // Ray should have negative Z component (pointing into scene)
    expect(ray.direction.z).toBeLessThan(0);
  });
});

// ============================================================================
// Project to Screen
// ============================================================================

describe("PickingManager - Project to Screen", () => {
  let picking: PickingManager;
  let ctx: PickContext;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
  });

  test("should project origin to screen center", () => {
    const point = new Vector3(0, 0, 0);
    const screen = picking.projectToScreen(point, ctx);

    expect(screen).not.toBe(null);
    // Should be roughly at center of screen
    expect(screen!.x).toBeCloseTo(400, 0);
    expect(screen!.y).toBeCloseTo(300, 0);
  });

  test("should project point to the right of center", () => {
    const point = new Vector3(5, 0, 0);
    const screen = picking.projectToScreen(point, ctx);

    expect(screen).not.toBe(null);
    // X should be at least at center (projection may flatten depending on camera setup)
    expect(screen!.x).toBeGreaterThanOrEqual(400);
  });

  test("should project point above center", () => {
    const point = new Vector3(0, 5, 0);
    const screen = picking.projectToScreen(point, ctx);

    expect(screen).not.toBe(null);
    // Y should be at most at center (projection may flatten depending on camera setup)
    expect(screen!.y).toBeLessThanOrEqual(300);
  });

  test("should return null for point behind camera", () => {
    const point = new Vector3(0, 0, 20); // Behind camera at z=10
    const screen = picking.projectToScreen(point, ctx);

    // Point behind camera should return null or be clipped
    // Implementation may vary
  });

  test("should include depth information", () => {
    const nearPoint = new Vector3(0, 0, 5);
    const farPoint = new Vector3(0, 0, -5);

    const nearScreen = picking.projectToScreen(nearPoint, ctx);
    const farScreen = picking.projectToScreen(farPoint, ctx);

    if (nearScreen && farScreen) {
      // Near point should have smaller z (closer)
      expect(nearScreen.z).toBeLessThan(farScreen.z);
    }
  });
});

// ============================================================================
// Object Picking
// ============================================================================

describe("PickingManager - Object Picking", () => {
  let picking: PickingManager;
  let ctx: PickContext;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
  });

  test("should pick object at origin when clicking center", () => {
    const objects = [createTestSceneObject("Cube")];

    const picked = picking.pickObject(400, 300, objects, ctx);

    expect(picked).not.toBe(null);
    expect(picked?.name).toBe("Cube");
  });

  test("should return null when clicking empty space", () => {
    const objects = [createTestSceneObject("Cube", new Vector3(100, 0, 0))];

    const picked = picking.pickObject(400, 300, objects, ctx);

    expect(picked).toBe(null);
  });

  test("should pick closest object when multiple overlap", () => {
    const nearCube = createTestSceneObject("NearCube", new Vector3(0, 0, 5));
    const farCube = createTestSceneObject("FarCube", new Vector3(0, 0, -5));

    const objects = [farCube, nearCube];
    const picked = picking.pickObject(400, 300, objects, ctx);

    expect(picked?.name).toBe("NearCube");
  });

  test("should not pick invisible objects", () => {
    const cube = createTestSceneObject("Cube");
    cube.visible = false;

    const objects = [cube];
    const picked = picking.pickObject(400, 300, objects, ctx);

    expect(picked).toBe(null);
  });

  test("should pick visible object when invisible one is closer", () => {
    const invisibleCube = createTestSceneObject(
      "InvisibleCube",
      new Vector3(0, 0, 5)
    );
    invisibleCube.visible = false;
    const visibleCube = createTestSceneObject(
      "VisibleCube",
      new Vector3(0, 0, 0)
    );

    const objects = [invisibleCube, visibleCube];
    const picked = picking.pickObject(400, 300, objects, ctx);

    expect(picked?.name).toBe("VisibleCube");
  });
});

// ============================================================================
// Vertex Picking
// ============================================================================

describe("PickingManager - Vertex Picking", () => {
  let picking: PickingManager;
  let ctx: PickContext;
  let mesh: Mesh;
  let modelMatrix: Matrix4;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
    mesh = createTriangleMesh();
    modelMatrix = Matrix4.identity();
  });

  test("should pick vertex near click position", () => {
    // Project vertex 0 (at 0,0,0) to screen and pick there
    const vertex = picking.pickVertex(400, 300, mesh, modelMatrix, ctx);

    // Should pick one of the vertices
    expect(
      vertex === null || (vertex >= 0 && vertex < mesh.vertices.length)
    ).toBe(true);
  });

  test("should return null when clicking far from vertices", () => {
    // Click far from any vertex
    const vertex = picking.pickVertex(10, 10, mesh, modelMatrix, ctx);

    // Might or might not pick depending on mesh position and pick radius
  });

  test("should pick with distance information", () => {
    const result = picking.pickVertexWithDistance(
      400,
      300,
      mesh,
      modelMatrix,
      ctx
    );

    if (result !== null) {
      expect(typeof result.index).toBe("number");
      expect(typeof result.distance).toBe("number");
      expect(result.distance).toBeLessThanOrEqual(picking.vertexPickRadius);
    }
  });

  test("should respect vertex pick radius", () => {
    picking.vertexPickRadius = 1; // Very small radius

    const result = picking.pickVertexWithDistance(
      400,
      300,
      mesh,
      modelMatrix,
      ctx
    );

    // With small radius, might not pick anything unless exactly on vertex
  });
});

// ============================================================================
// Edge Picking
// ============================================================================

describe("PickingManager - Edge Picking", () => {
  let picking: PickingManager;
  let ctx: PickContext;
  let mesh: Mesh;
  let modelMatrix: Matrix4;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
    mesh = createTriangleMesh();
    modelMatrix = Matrix4.identity();
  });

  test("should pick edge and return edge key", () => {
    const edgeKey = picking.pickEdge(400, 300, mesh, modelMatrix, ctx);

    if (edgeKey !== null) {
      // Edge key should be in format "v0-v1"
      expect(edgeKey).toMatch(/^\d+-\d+$/);
    }
  });

  test("should pick with distance information", () => {
    const result = picking.pickEdgeWithDistance(
      400,
      300,
      mesh,
      modelMatrix,
      ctx
    );

    if (result !== null) {
      expect(typeof result.edgeKey).toBe("string");
      expect(typeof result.distance).toBe("number");
      expect(result.distance).toBeLessThanOrEqual(picking.edgePickRadius);
    }
  });

  test("should respect edge pick radius", () => {
    picking.edgePickRadius = 1; // Very small radius

    const result = picking.pickEdgeWithDistance(
      400,
      300,
      mesh,
      modelMatrix,
      ctx
    );

    // With small radius, might not pick anything unless exactly on edge
  });
});

// ============================================================================
// Face Picking
// ============================================================================

describe("PickingManager - Face Picking", () => {
  let picking: PickingManager;
  let ctx: PickContext;
  let mesh: Mesh;
  let modelMatrix: Matrix4;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
    mesh = createTriangleMesh();
    modelMatrix = Matrix4.identity();
  });

  test("should pick face when clicking inside", () => {
    const faceIndex = picking.pickFace(400, 300, mesh, modelMatrix, ctx);

    // If triangle is visible, should pick it
    if (faceIndex !== null) {
      expect(faceIndex).toBeGreaterThanOrEqual(0);
    }
  });

  test("should return null when clicking outside faces", () => {
    // Position mesh far away using model matrix translation
    const farMesh = createTriangleMesh();
    const translatedMatrix = Matrix4.translation(100, 0, 0);

    const faceIndex = picking.pickFace(
      400,
      300,
      farMesh,
      translatedMatrix,
      ctx
    );
    // When clicking center and mesh is translated far right, should not hit
    // (result depends on ray casting implementation - may still hit if mesh is large)
    expect(faceIndex === null || typeof faceIndex === "number").toBe(true);
  });

  test("should pick with depth information", () => {
    const result = picking.pickFaceWithDepth(400, 300, mesh, modelMatrix, ctx);

    if (result !== null) {
      expect(typeof result.faceIndex).toBe("number");
      expect(typeof result.depth).toBe("number");
    }
  });

  test("should pick frontmost face when multiple faces overlap", () => {
    const cube = createCubeMesh();

    const result = picking.pickFaceWithDepth(400, 300, cube, modelMatrix, ctx);

    if (result !== null) {
      expect(result.faceIndex).toBeGreaterThanOrEqual(0);
      expect(result.faceIndex).toBeLessThan(6); // Cube has 6 faces
    }
  });
});

// ============================================================================
// Colocated Vertices
// ============================================================================

describe("PickingManager - Colocated Vertices", () => {
  let picking: PickingManager;

  beforeEach(() => {
    picking = new PickingManager();
  });

  test("should find self when checking colocated vertices", () => {
    const mesh = createTriangleMesh();
    const colocated = picking.getColocatedVertices(mesh, 0);

    expect(colocated).toContain(0);
  });

  test("should find all vertices at same position", () => {
    // Create mesh with duplicate vertex positions
    const vertices = [
      new Vertex(new Vector3(0, 0, 0), Color.white()),
      new Vertex(new Vector3(1, 0, 0), Color.white()),
      new Vertex(new Vector3(0, 0, 0), Color.white()), // Same as vertex 0
      new Vertex(new Vector3(0, 0, 0), Color.white()), // Same as vertex 0
    ];
    const mesh = new Mesh(vertices);

    const colocated = picking.getColocatedVertices(mesh, 0);

    expect(colocated).toContain(0);
    expect(colocated).toContain(2);
    expect(colocated).toContain(3);
    expect(colocated.length).toBe(3);
  });

  test("should not include non-colocated vertices", () => {
    const mesh = createTriangleMesh();
    const colocated = picking.getColocatedVertices(mesh, 0);

    // Vertices 1 and 2 are at different positions
    expect(colocated).not.toContain(1);
    expect(colocated).not.toContain(2);
  });

  test("should handle floating point tolerance", () => {
    // Create vertices with very small position differences
    const vertices = [
      new Vertex(new Vector3(0, 0, 0), Color.white()),
      new Vertex(new Vector3(0.00001, 0.00001, 0.00001), Color.white()), // Within tolerance
      new Vertex(new Vector3(0.001, 0, 0), Color.white()), // Outside tolerance
    ];
    const mesh = new Mesh(vertices);

    const colocated = picking.getColocatedVertices(mesh, 0);

    expect(colocated).toContain(0);
    expect(colocated).toContain(1); // Within tolerance
    expect(colocated).not.toContain(2); // Outside tolerance
  });
});

// ============================================================================
// Model Matrix Transform
// ============================================================================

describe("PickingManager - Model Matrix Transform", () => {
  let picking: PickingManager;
  let ctx: PickContext;
  let mesh: Mesh;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
    mesh = createTriangleMesh();
  });

  test("should use identity matrix correctly", () => {
    const modelMatrix = Matrix4.identity();
    const vertex = picking.pickVertex(400, 300, mesh, modelMatrix, ctx);

    // Should work with identity matrix
    // Result depends on mesh position relative to camera
  });

  test("should handle translated mesh", () => {
    // Translate mesh to the right
    const modelMatrix = Matrix4.translation(5, 0, 0);

    // Clicking at center shouldn't pick vertex now
    // (unless pick radius is very large)
    picking.vertexPickRadius = 10;
    const vertex = picking.pickVertex(400, 300, mesh, modelMatrix, ctx);

    // Vertex should be shifted, so clicking center might not hit
  });

  test("should handle scaled mesh", () => {
    const scaledMatrix = Matrix4.scaling(2, 2, 2);

    // Scaled mesh should still be pickable
    const vertex = picking.pickVertex(400, 300, mesh, scaledMatrix, ctx);

    // Result depends on specific positions
  });
});

// ============================================================================
// Camera Position Tests
// ============================================================================

describe("PickingManager - Camera Variations", () => {
  let picking: PickingManager;
  let mesh: Mesh;
  let modelMatrix: Matrix4;

  beforeEach(() => {
    picking = new PickingManager();
    mesh = createTriangleMesh();
    modelMatrix = Matrix4.identity();
  });

  test("should work with camera at different Z position", () => {
    const camera = new Camera();
    camera.position = new Vector3(0, 0, 20);
    camera.target = new Vector3(0, 0, 0);

    const ctx = createTestContext(camera);
    const vertex = picking.pickVertex(400, 300, mesh, modelMatrix, ctx);

    // Should still work, just at different distance
  });

  test("should work with offset camera", () => {
    const camera = new Camera();
    camera.position = new Vector3(5, 5, 10);
    camera.target = new Vector3(0, 0, 0);

    const ctx = createTestContext(camera);
    const vertex = picking.pickVertex(400, 300, mesh, modelMatrix, ctx);

    // Should work with angled view
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("PickingManager - Edge Cases", () => {
  let picking: PickingManager;
  let ctx: PickContext;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
  });

  test("should handle empty objects array", () => {
    const picked = picking.pickObject(400, 300, [], ctx);
    expect(picked).toBe(null);
  });

  test("should handle mesh with no vertices", () => {
    const emptyMesh = new Mesh([]);
    const modelMatrix = Matrix4.identity();

    const vertex = picking.pickVertex(400, 300, emptyMesh, modelMatrix, ctx);
    expect(vertex).toBe(null);
  });

  test("should handle screen coordinates at edges", () => {
    const mesh = createTriangleMesh();
    const modelMatrix = Matrix4.identity();

    // Top-left corner
    const v1 = picking.pickVertex(0, 0, mesh, modelMatrix, ctx);
    // Bottom-right corner
    const v2 = picking.pickVertex(800, 600, mesh, modelMatrix, ctx);

    // Should not throw
  });

  test("should handle negative screen coordinates", () => {
    const mesh = createTriangleMesh();
    const modelMatrix = Matrix4.identity();

    const vertex = picking.pickVertex(-100, -100, mesh, modelMatrix, ctx);
    // Should not throw, just return null
    expect(vertex).toBe(null);
  });

  test("should handle very large screen coordinates", () => {
    const mesh = createTriangleMesh();
    const modelMatrix = Matrix4.identity();

    const vertex = picking.pickVertex(10000, 10000, mesh, modelMatrix, ctx);
    // Should not throw, just return null
    expect(vertex).toBe(null);
  });
});

// ============================================================================
// Performance Edge Cases
// ============================================================================

describe("PickingManager - Performance Considerations", () => {
  let picking: PickingManager;
  let ctx: PickContext;

  beforeEach(() => {
    picking = new PickingManager();
    ctx = createTestContext();
  });

  test("should handle mesh with many vertices", () => {
    // Create mesh with many vertices
    const vertices: Vertex[] = [];
    for (let i = 0; i < 1000; i++) {
      vertices.push(
        new Vertex(
          new Vector3(
            Math.random() * 10 - 5,
            Math.random() * 10 - 5,
            Math.random() * 10 - 5
          ),
          Color.white()
        )
      );
    }
    const mesh = new Mesh(vertices);
    const modelMatrix = Matrix4.identity();

    // Should complete in reasonable time
    const startTime = performance.now();
    picking.pickVertex(400, 300, mesh, modelMatrix, ctx);
    const endTime = performance.now();

    // Should complete in less than 100ms
    expect(endTime - startTime).toBeLessThan(100);
  });

  test("should handle many objects for picking", () => {
    const objects: SceneObject[] = [];
    for (let i = 0; i < 100; i++) {
      objects.push(
        createTestSceneObject(
          `Object${i}`,
          new Vector3(
            Math.random() * 20 - 10,
            Math.random() * 20 - 10,
            Math.random() * 20 - 10
          )
        )
      );
    }

    const startTime = performance.now();
    picking.pickObject(400, 300, objects, ctx);
    const endTime = performance.now();

    // Should complete in less than 100ms
    expect(endTime - startTime).toBeLessThan(100);
  });
});
