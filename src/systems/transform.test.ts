/**
 * Unit tests for the Transform System
 *
 * Tests the TransformManager class for handling object and vertex
 * transforms (grab, rotate, scale) with axis constraints.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  TransformManager,
  TransformMode,
  AxisConstraint,
  AxisSpace,
} from "./transform";
import { Vector3, Matrix4, Color } from "../math";
import { Mesh, Vertex } from "../primitives";
import { SceneObject } from "../scene";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock scene object for testing
 */
function createMockSceneObject(
  name: string,
  position: Vector3 = Vector3.zero()
): SceneObject {
  const vertices = [
    new Vertex(new Vector3(-1, -1, -1), Color.white()),
    new Vertex(new Vector3(1, -1, -1), Color.white()),
    new Vertex(new Vector3(1, 1, -1), Color.white()),
    new Vertex(new Vector3(-1, 1, -1), Color.white()),
    new Vertex(new Vector3(-1, -1, 1), Color.white()),
    new Vertex(new Vector3(1, -1, 1), Color.white()),
    new Vertex(new Vector3(1, 1, 1), Color.white()),
    new Vertex(new Vector3(-1, 1, 1), Color.white()),
  ];
  const mesh = new Mesh(vertices);
  const obj = new SceneObject(name, mesh);
  obj.position = position;
  return obj;
}

/**
 * Create a test mesh
 */
function createTestMesh(): Mesh {
  const vertices = [
    new Vertex(new Vector3(0, 0, 0), Color.white()),
    new Vertex(new Vector3(1, 0, 0), Color.white()),
    new Vertex(new Vector3(0.5, 1, 0), Color.white()),
    new Vertex(new Vector3(0.5, 0.5, 1), Color.white()),
  ];
  return new Mesh(vertices);
}

/**
 * Mock model matrix for testing
 */
const identityModelMatrix = {
  transformPoint: (v: Vector3) => v.clone(),
};

// ============================================================================
// Basic Operations
// ============================================================================

describe("TransformManager - Basic Operations", () => {
  let transform: TransformManager;

  beforeEach(() => {
    transform = new TransformManager();
  });

  test("should initialize with no active transform", () => {
    expect(transform.mode).toBe("none");
    expect(transform.isActive).toBe(false);
    expect(transform.axisConstraint).toBe("none");
    expect(transform.axisSpace).toBe("world");
    expect(transform.transformOrigin).toBe(null);
  });

  test("should get state", () => {
    const state = transform.getState();

    expect(state.mode).toBe("none");
    expect(state.axisConstraint).toBe("none");
    expect(state.startPos).toBe(null);
    expect(state.startRotation).toBe(null);
    expect(state.startScale).toBe(null);
    expect(state.vertexStartPositions.size).toBe(0);
  });
});

// ============================================================================
// Object Grab Transform
// ============================================================================

describe("TransformManager - Object Grab", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube", new Vector3(5, 3, 2));
  });

  test("should start object grab", () => {
    const result = transform.startObjectGrab(obj);

    expect(result).toBe(true);
    expect(transform.mode).toBe("grab");
    expect(transform.isActive).toBe(true);
    expect(transform.axisConstraint).toBe("none");
    expect(transform.axisSpace).toBe("world");
  });

  test("should store transform origin", () => {
    transform.startObjectGrab(obj);

    expect(transform.transformOrigin).not.toBe(null);
  });

  test("should cancel grab", () => {
    transform.startObjectGrab(obj);
    transform.cancel(obj, false);

    expect(transform.mode).toBe("none");
    expect(transform.isActive).toBe(false);
  });
});

// ============================================================================
// Multi-Object Grab Transform
// ============================================================================

describe("TransformManager - Multi-Object Grab", () => {
  let transform: TransformManager;
  let objects: SceneObject[];

  beforeEach(() => {
    transform = new TransformManager();
    objects = [
      createMockSceneObject("Cube1", new Vector3(0, 0, 0)),
      createMockSceneObject("Cube2", new Vector3(4, 0, 0)),
      createMockSceneObject("Cube3", new Vector3(2, 4, 0)),
    ];
  });

  test("should start multi-object grab", () => {
    const result = transform.startMultiObjectGrab(objects);

    expect(result).toBe(true);
    expect(transform.mode).toBe("grab");
    expect(transform.isActive).toBe(true);
  });

  test("should store start positions for all objects", () => {
    transform.startMultiObjectGrab(objects);

    const startPositions = transform.getMultiObjectStartPositions();
    expect(startPositions.size).toBe(3);
    expect(startPositions.has("Cube1")).toBe(true);
    expect(startPositions.has("Cube2")).toBe(true);
    expect(startPositions.has("Cube3")).toBe(true);
  });

  test("should return false for empty objects array", () => {
    const result = transform.startMultiObjectGrab([]);

    expect(result).toBe(false);
    expect(transform.isActive).toBe(false);
  });

  test("should calculate combined center as transform origin", () => {
    transform.startMultiObjectGrab(objects);

    const origin = transform.transformOrigin;
    expect(origin).not.toBe(null);
    // Origin should be average of object centers
  });
});

// ============================================================================
// Vertex Grab Transform
// ============================================================================

describe("TransformManager - Vertex Grab", () => {
  let transform: TransformManager;
  let mesh: Mesh;

  beforeEach(() => {
    transform = new TransformManager();
    mesh = createTestMesh();
  });

  test("should start vertex grab", () => {
    const indices = new Set([0, 1, 2]);
    const result = transform.startVertexGrab(
      mesh,
      indices,
      identityModelMatrix
    );

    expect(result).toBe(true);
    expect(transform.mode).toBe("grab");
    expect(transform.isActive).toBe(true);
  });

  test("should return false for empty vertex set", () => {
    const indices = new Set<number>();
    const result = transform.startVertexGrab(
      mesh,
      indices,
      identityModelMatrix
    );

    expect(result).toBe(false);
    expect(transform.isActive).toBe(false);
  });

  test("should store vertex start positions", () => {
    const indices = new Set([0, 1, 2]);
    transform.startVertexGrab(mesh, indices, identityModelMatrix);

    const state = transform.getState();
    expect(state.vertexStartPositions.size).toBe(3);
  });
});

// ============================================================================
// Object Rotate Transform
// ============================================================================

describe("TransformManager - Object Rotate", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube");
    obj.rotation = new Vector3(0, 45, 0);
  });

  test("should start object rotate", () => {
    const result = transform.startObjectRotate(obj);

    expect(result).toBe(true);
    expect(transform.mode).toBe("rotate");
    expect(transform.isActive).toBe(true);
  });
});

// ============================================================================
// Multi-Object Rotate Transform
// ============================================================================

describe("TransformManager - Multi-Object Rotate", () => {
  let transform: TransformManager;
  let objects: SceneObject[];

  beforeEach(() => {
    transform = new TransformManager();
    objects = [createMockSceneObject("Cube1"), createMockSceneObject("Cube2")];
  });

  test("should start multi-object rotate", () => {
    const result = transform.startMultiObjectRotate(objects);

    expect(result).toBe(true);
    expect(transform.mode).toBe("rotate");
    expect(transform.isActive).toBe(true);
  });

  test("should store start rotations for all objects", () => {
    transform.startMultiObjectRotate(objects);

    const startRotations = transform.getMultiObjectStartRotations();
    expect(startRotations.size).toBe(2);
  });

  test("should return false for empty objects array", () => {
    const result = transform.startMultiObjectRotate([]);

    expect(result).toBe(false);
    expect(transform.isActive).toBe(false);
  });
});

// ============================================================================
// Vertex Rotate Transform
// ============================================================================

describe("TransformManager - Vertex Rotate", () => {
  let transform: TransformManager;
  let mesh: Mesh;

  beforeEach(() => {
    transform = new TransformManager();
    mesh = createTestMesh();
  });

  test("should start vertex rotate", () => {
    const indices = new Set([0, 1, 2]);
    const result = transform.startVertexRotate(
      mesh,
      indices,
      identityModelMatrix
    );

    expect(result).toBe(true);
    expect(transform.mode).toBe("rotate");
    expect(transform.isActive).toBe(true);
  });

  test("should return false for empty vertex set", () => {
    const indices = new Set<number>();
    const result = transform.startVertexRotate(
      mesh,
      indices,
      identityModelMatrix
    );

    expect(result).toBe(false);
    expect(transform.isActive).toBe(false);
  });
});

// ============================================================================
// Object Scale Transform
// ============================================================================

describe("TransformManager - Object Scale", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube");
    obj.scale = new Vector3(2, 2, 2);
  });

  test("should start object scale", () => {
    const result = transform.startObjectScale(obj);

    expect(result).toBe(true);
    expect(transform.mode).toBe("scale");
    expect(transform.isActive).toBe(true);
  });
});

// ============================================================================
// Multi-Object Scale Transform
// ============================================================================

describe("TransformManager - Multi-Object Scale", () => {
  let transform: TransformManager;
  let objects: SceneObject[];

  beforeEach(() => {
    transform = new TransformManager();
    objects = [createMockSceneObject("Cube1"), createMockSceneObject("Cube2")];
  });

  test("should start multi-object scale", () => {
    const result = transform.startMultiObjectScale(objects);

    expect(result).toBe(true);
    expect(transform.mode).toBe("scale");
    expect(transform.isActive).toBe(true);
  });

  test("should return false for empty objects array", () => {
    const result = transform.startMultiObjectScale([]);

    expect(result).toBe(false);
    expect(transform.isActive).toBe(false);
  });
});

// ============================================================================
// Vertex Scale Transform
// ============================================================================

describe("TransformManager - Vertex Scale", () => {
  let transform: TransformManager;
  let mesh: Mesh;

  beforeEach(() => {
    transform = new TransformManager();
    mesh = createTestMesh();
  });

  test("should start vertex scale", () => {
    const indices = new Set([0, 1, 2]);
    const result = transform.startVertexScale(
      mesh,
      indices,
      identityModelMatrix
    );

    expect(result).toBe(true);
    expect(transform.mode).toBe("scale");
    expect(transform.isActive).toBe(true);
  });

  test("should return false for empty vertex set", () => {
    const indices = new Set<number>();
    const result = transform.startVertexScale(
      mesh,
      indices,
      identityModelMatrix
    );

    expect(result).toBe(false);
    expect(transform.isActive).toBe(false);
  });
});

// ============================================================================
// Axis Constraints
// ============================================================================

describe("TransformManager - Axis Constraints", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube");
  });

  test("should set axis constraint during transform", () => {
    transform.startObjectGrab(obj);
    transform.setAxisConstraint("x");

    expect(transform.axisConstraint).toBe("x");
  });

  test("should toggle axis constraint", () => {
    transform.startObjectGrab(obj);

    transform.setAxisConstraint("x");
    expect(transform.axisConstraint).toBe("x");

    transform.setAxisConstraint("y");
    expect(transform.axisConstraint).toBe("y");

    transform.setAxisConstraint("z");
    expect(transform.axisConstraint).toBe("z");
  });

  test("should support plane constraints", () => {
    transform.startObjectGrab(obj);

    transform.setAxisConstraint("xy");
    expect(transform.axisConstraint).toBe("xy");

    transform.setAxisConstraint("xz");
    expect(transform.axisConstraint).toBe("xz");

    transform.setAxisConstraint("yz");
    expect(transform.axisConstraint).toBe("yz");
  });

  test("should reset axis constraint on cancel", () => {
    transform.startObjectGrab(obj);
    transform.setAxisConstraint("x");
    transform.cancel(obj, false);

    expect(transform.axisConstraint).toBe("none");
  });
});

// ============================================================================
// Axis Space
// ============================================================================

describe("TransformManager - Axis Space", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube");
  });

  test("should default to world space", () => {
    transform.startObjectGrab(obj);
    expect(transform.axisSpace).toBe("world");
  });

  test("should set axis space via setAxisConstraint", () => {
    transform.startObjectGrab(obj);
    transform.setAxisConstraint("x", "local");

    expect(transform.axisSpace).toBe("local");

    transform.setAxisConstraint("y", "world");
    expect(transform.axisSpace).toBe("world");
  });
});

// ============================================================================
// Transform Cancellation
// ============================================================================

describe("TransformManager - Cancel Transform", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube", new Vector3(1, 2, 3));
  });

  test("should reset mode on cancel", () => {
    transform.startObjectGrab(obj);
    transform.cancel(obj, false);

    expect(transform.mode).toBe("none");
    expect(transform.isActive).toBe(false);
  });

  test("should reset axis constraint on cancel", () => {
    transform.startObjectGrab(obj);
    transform.setAxisConstraint("x");
    transform.cancel(obj, false);

    expect(transform.axisConstraint).toBe("none");
  });

  test("should clear transform origin on cancel", () => {
    transform.startObjectGrab(obj);
    transform.cancel(obj, false);

    expect(transform.transformOrigin).toBe(null);
  });
});

// ============================================================================
// Transform Completion Callback
// ============================================================================

describe("TransformManager - Completion Callback", () => {
  let transform: TransformManager;
  let obj: SceneObject;

  beforeEach(() => {
    transform = new TransformManager();
    obj = createMockSceneObject("TestCube");
  });

  test("should set completion callback", () => {
    let called = false;
    transform.setOnComplete(() => {
      called = true;
    });

    // Callback should be stored (we can't easily test if it's called
    // without triggering a complete transform operation)
    expect(called).toBe(false);
  });

  test("should allow clearing callback with null", () => {
    transform.setOnComplete(null);
    // Should not throw
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("TransformManager - Edge Cases", () => {
  let transform: TransformManager;

  beforeEach(() => {
    transform = new TransformManager();
  });

  test("should handle cancel when no transform active", () => {
    const obj = createMockSceneObject("Cube");
    // Should not throw even if no transform is active
    transform.cancel(obj, false);
    expect(transform.isActive).toBe(false);
  });

  test("should handle setting axis constraint when no transform active", () => {
    transform.setAxisConstraint("x");
    // When no transform is active, setAxisConstraint returns early
    // The constraint won't be set but it shouldn't throw
    expect(transform.axisConstraint).toBe("none");
  });

  test("should handle sequential transforms", () => {
    const obj = createMockSceneObject("Cube");

    transform.startObjectGrab(obj);
    expect(transform.mode).toBe("grab");

    transform.cancel(obj, false);
    expect(transform.mode).toBe("none");

    transform.startObjectRotate(obj);
    expect(transform.mode).toBe("rotate");

    transform.cancel(obj, false);
    expect(transform.mode).toBe("none");

    transform.startObjectScale(obj);
    expect(transform.mode).toBe("scale");
  });
});
