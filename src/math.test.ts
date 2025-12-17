/**
 * Unit tests for math.ts - Core math utilities for 3D graphics
 *
 * Tests cover:
 * - Vector3: 3D vector operations
 * - Vector4: Homogeneous coordinates
 * - Color: RGBA color operations
 * - Matrix4: 4x4 transformation matrices
 * - Ray: Ray casting and intersections
 * - Utility functions: clamp, lerp, degToRad, radToDeg
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  Vector3,
  Vector4,
  Color,
  Matrix4,
  Ray,
  clamp,
  lerp,
  degToRad,
  radToDeg,
} from "./math";

// ============================================================================
// Vector3 Tests
// ============================================================================

describe("Vector3 - Static Constructors", () => {
  test("zero() should create (0, 0, 0)", () => {
    const v = Vector3.zero();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  test("one() should create (1, 1, 1)", () => {
    const v = Vector3.one();
    expect(v.x).toBe(1);
    expect(v.y).toBe(1);
    expect(v.z).toBe(1);
  });

  test("up() should create (0, 0, 1)", () => {
    const v = Vector3.up();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(1);
  });

  test("right() should create (1, 0, 0)", () => {
    const v = Vector3.right();
    expect(v.x).toBe(1);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });
});

describe("Vector3 - Basic Operations", () => {
  test("constructor should set components", () => {
    const v = new Vector3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  test("default constructor should create zero vector", () => {
    const v = new Vector3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  test("clone() should create independent copy", () => {
    const v1 = new Vector3(1, 2, 3);
    const v2 = v1.clone();
    v2.x = 10;
    expect(v1.x).toBe(1);
    expect(v2.x).toBe(10);
  });
});

describe("Vector3 - Arithmetic", () => {
  test("add() should add vectors", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    const result = a.add(b);
    expect(result.x).toBe(5);
    expect(result.y).toBe(7);
    expect(result.z).toBe(9);
  });

  test("sub() should subtract vectors", () => {
    const a = new Vector3(5, 7, 9);
    const b = new Vector3(1, 2, 3);
    const result = a.sub(b);
    expect(result.x).toBe(4);
    expect(result.y).toBe(5);
    expect(result.z).toBe(6);
  });

  test("mul() should scale vector", () => {
    const v = new Vector3(1, 2, 3);
    const result = v.mul(2);
    expect(result.x).toBe(2);
    expect(result.y).toBe(4);
    expect(result.z).toBe(6);
  });

  test("div() should divide vector", () => {
    const v = new Vector3(4, 6, 8);
    const result = v.div(2);
    expect(result.x).toBe(2);
    expect(result.y).toBe(3);
    expect(result.z).toBe(4);
  });

  test("negate() should negate vector", () => {
    const v = new Vector3(1, -2, 3);
    const result = v.negate();
    expect(result.x).toBe(-1);
    expect(result.y).toBe(2);
    expect(result.z).toBe(-3);
  });
});

describe("Vector3 - Dot and Cross Products", () => {
  test("dot() should compute dot product", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    expect(a.dot(b)).toBe(32); // 1*4 + 2*5 + 3*6 = 32
  });

  test("dot() of perpendicular vectors should be 0", () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 1, 0);
    expect(a.dot(b)).toBe(0);
  });

  test("cross() should compute cross product", () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 1, 0);
    const result = a.cross(b);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(1);
  });

  test("cross() should be anti-commutative", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    const ab = a.cross(b);
    const ba = b.cross(a);
    expect(ab.x).toBeCloseTo(-ba.x);
    expect(ab.y).toBeCloseTo(-ba.y);
    expect(ab.z).toBeCloseTo(-ba.z);
  });
});

describe("Vector3 - Length and Normalization", () => {
  test("length() should compute magnitude", () => {
    const v = new Vector3(3, 4, 0);
    expect(v.length()).toBe(5);
  });

  test("lengthSquared() should compute squared magnitude", () => {
    const v = new Vector3(3, 4, 0);
    expect(v.lengthSquared()).toBe(25);
  });

  test("normalize() should create unit vector", () => {
    const v = new Vector3(3, 4, 0);
    const n = v.normalize();
    expect(n.length()).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
  });

  test("normalize() of zero vector should return zero", () => {
    const v = new Vector3(0, 0, 0);
    const n = v.normalize();
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(n.z).toBe(0);
  });
});

describe("Vector3 - Interpolation", () => {
  test("lerp() at t=0 should return first vector", () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 20, 30);
    const result = a.lerp(b, 0);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  test("lerp() at t=1 should return second vector", () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 20, 30);
    const result = a.lerp(b, 1);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
    expect(result.z).toBe(30);
  });

  test("lerp() at t=0.5 should return midpoint", () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 20, 30);
    const result = a.lerp(b, 0.5);
    expect(result.x).toBe(5);
    expect(result.y).toBe(10);
    expect(result.z).toBe(15);
  });
});

// ============================================================================
// Vector4 Tests
// ============================================================================

describe("Vector4 - Basic Operations", () => {
  test("constructor should set components", () => {
    const v = new Vector4(1, 2, 3, 4);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
    expect(v.w).toBe(4);
  });

  test("default w should be 1", () => {
    const v = new Vector4(1, 2, 3);
    expect(v.w).toBe(1);
  });

  test("fromVector3() should create Vector4", () => {
    const v3 = new Vector3(1, 2, 3);
    const v4 = Vector4.fromVector3(v3, 1);
    expect(v4.x).toBe(1);
    expect(v4.y).toBe(2);
    expect(v4.z).toBe(3);
    expect(v4.w).toBe(1);
  });

  test("toVector3() should drop w", () => {
    const v4 = new Vector4(1, 2, 3, 4);
    const v3 = v4.toVector3();
    expect(v3.x).toBe(1);
    expect(v3.y).toBe(2);
    expect(v3.z).toBe(3);
  });

  test("perspectiveDivide() should divide by w", () => {
    const v = new Vector4(4, 8, 12, 4);
    const result = v.perspectiveDivide();
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
    expect(result.z).toBe(3);
  });

  test("perspectiveDivide() with w=0 should return xyz", () => {
    const v = new Vector4(4, 8, 12, 0);
    const result = v.perspectiveDivide();
    expect(result.x).toBe(4);
    expect(result.y).toBe(8);
    expect(result.z).toBe(12);
  });
});

// ============================================================================
// Color Tests
// ============================================================================

describe("Color - Static Constructors", () => {
  test("white() should create (255, 255, 255, 255)", () => {
    const c = Color.white();
    expect(c.r).toBe(255);
    expect(c.g).toBe(255);
    expect(c.b).toBe(255);
    expect(c.a).toBe(255);
  });

  test("black() should create (0, 0, 0, 255)", () => {
    const c = Color.black();
    expect(c.r).toBe(0);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(c.a).toBe(255);
  });

  test("red() should create (255, 0, 0, 255)", () => {
    const c = Color.red();
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
  });

  test("green() should create (0, 255, 0, 255)", () => {
    const c = Color.green();
    expect(c.r).toBe(0);
    expect(c.g).toBe(255);
    expect(c.b).toBe(0);
  });

  test("blue() should create (0, 0, 255, 255)", () => {
    const c = Color.blue();
    expect(c.r).toBe(0);
    expect(c.g).toBe(0);
    expect(c.b).toBe(255);
  });

  test("fromHex() should parse hex color", () => {
    const c = Color.fromHex(0xff8040);
    expect(c.r).toBe(255);
    expect(c.g).toBe(128);
    expect(c.b).toBe(64);
  });
});

describe("Color - Operations", () => {
  test("clone() should create independent copy", () => {
    const c1 = new Color(100, 150, 200, 255);
    const c2 = c1.clone();
    c2.r = 50;
    expect(c1.r).toBe(100);
    expect(c2.r).toBe(50);
  });

  test("mul() should scale color", () => {
    const c = new Color(100, 100, 100, 255);
    const result = c.mul(0.5);
    expect(result.r).toBe(50);
    expect(result.g).toBe(50);
    expect(result.b).toBe(50);
  });

  test("mul() should clamp to 0-255", () => {
    const c = new Color(200, 100, 50, 255);
    const result = c.mul(2);
    expect(result.r).toBe(255); // Clamped
    expect(result.g).toBe(200);
    expect(result.b).toBe(100);
  });

  test("add() should add colors", () => {
    const a = new Color(100, 100, 100, 255);
    const b = new Color(50, 50, 50, 255);
    const result = a.add(b);
    expect(result.r).toBe(150);
    expect(result.g).toBe(150);
    expect(result.b).toBe(150);
  });

  test("add() should clamp to 255", () => {
    const a = new Color(200, 200, 200, 255);
    const b = new Color(100, 100, 100, 255);
    const result = a.add(b);
    expect(result.r).toBe(255);
    expect(result.g).toBe(255);
    expect(result.b).toBe(255);
  });

  test("lerp() should interpolate colors", () => {
    const a = new Color(0, 0, 0, 255);
    const b = new Color(100, 200, 100, 255);
    const result = a.lerp(b, 0.5);
    expect(result.r).toBe(50);
    expect(result.g).toBe(100);
    expect(result.b).toBe(50);
  });

  test("toUint32() should pack color", () => {
    const c = new Color(255, 128, 64, 255);
    const packed = c.toUint32();
    // ABGR format: alpha << 24 | blue << 16 | green << 8 | red
    // Use >>> 0 to convert to unsigned for comparison
    expect(packed >>> 0).toBe(0xff4080ff >>> 0);
  });
});

// ============================================================================
// Matrix4 Tests
// ============================================================================

describe("Matrix4 - Identity", () => {
  test("constructor should create identity matrix", () => {
    const m = new Matrix4();
    expect(m.data[0]).toBe(1);
    expect(m.data[5]).toBe(1);
    expect(m.data[10]).toBe(1);
    expect(m.data[15]).toBe(1);
    expect(m.data[1]).toBe(0);
    expect(m.data[4]).toBe(0);
  });

  test("identity() should reset to identity", () => {
    const m = new Matrix4();
    m.data[0] = 5;
    m.identity();
    expect(m.data[0]).toBe(1);
  });

  test("static identity() should create identity", () => {
    const m = Matrix4.identity();
    expect(m.data[0]).toBe(1);
    expect(m.data[5]).toBe(1);
    expect(m.data[10]).toBe(1);
    expect(m.data[15]).toBe(1);
  });
});

describe("Matrix4 - Clone", () => {
  test("clone() should create independent copy", () => {
    const m1 = Matrix4.translation(1, 2, 3);
    const m2 = m1.clone();
    m2.data[3] = 100;
    expect(m1.data[3]).toBe(1);
    expect(m2.data[3]).toBe(100);
  });
});

describe("Matrix4 - Translation", () => {
  test("translation() should create translation matrix", () => {
    const m = Matrix4.translation(10, 20, 30);
    expect(m.data[3]).toBe(10);
    expect(m.data[7]).toBe(20);
    expect(m.data[11]).toBe(30);
  });

  test("translation should transform point", () => {
    const m = Matrix4.translation(10, 20, 30);
    const p = new Vector3(1, 2, 3);
    const result = m.transformPoint(p);
    expect(result.x).toBe(11);
    expect(result.y).toBe(22);
    expect(result.z).toBe(33);
  });
});

describe("Matrix4 - Scaling", () => {
  test("scaling() should create scale matrix", () => {
    const m = Matrix4.scaling(2, 3, 4);
    expect(m.data[0]).toBe(2);
    expect(m.data[5]).toBe(3);
    expect(m.data[10]).toBe(4);
  });

  test("scaling should transform point", () => {
    const m = Matrix4.scaling(2, 3, 4);
    const p = new Vector3(1, 2, 3);
    const result = m.transformPoint(p);
    expect(result.x).toBe(2);
    expect(result.y).toBe(6);
    expect(result.z).toBe(12);
  });
});

describe("Matrix4 - Rotation", () => {
  test("rotationX(90°) should rotate Y to Z", () => {
    const m = Matrix4.rotationX(Math.PI / 2);
    const p = new Vector3(0, 1, 0);
    const result = m.transformPoint(p);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });

  test("rotationY(90°) should rotate Z to X", () => {
    const m = Matrix4.rotationY(Math.PI / 2);
    const p = new Vector3(0, 0, 1);
    const result = m.transformPoint(p);
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  test("rotationZ(90°) should rotate X to Y", () => {
    const m = Matrix4.rotationZ(Math.PI / 2);
    const p = new Vector3(1, 0, 0);
    const result = m.transformPoint(p);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(1);
    expect(result.z).toBeCloseTo(0);
  });
});

describe("Matrix4 - Multiplication", () => {
  test("identity * matrix = matrix", () => {
    const identity = Matrix4.identity();
    const translation = Matrix4.translation(1, 2, 3);
    const result = identity.multiply(translation);
    expect(result.data[3]).toBe(1);
    expect(result.data[7]).toBe(2);
    expect(result.data[11]).toBe(3);
  });

  test("translation * scale should combine", () => {
    const t = Matrix4.translation(10, 0, 0);
    const s = Matrix4.scaling(2, 2, 2);
    const combined = t.multiply(s);
    const p = new Vector3(1, 0, 0);
    const result = combined.transformPoint(p);
    // First scale (1*2=2), then translate (2+10=12)
    expect(result.x).toBeCloseTo(12);
  });
});

describe("Matrix4 - Inversion", () => {
  test("identity inverse should be identity", () => {
    const m = Matrix4.identity();
    const inv = m.invert();
    expect(inv).not.toBeNull();
    expect(inv!.data[0]).toBe(1);
    expect(inv!.data[5]).toBe(1);
  });

  test("translation inverse should undo translation", () => {
    const m = Matrix4.translation(10, 20, 30);
    const inv = m.invert();
    expect(inv).not.toBeNull();
    const p = new Vector3(10, 20, 30);
    const result = inv!.transformPoint(p);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  test("m * m^-1 should equal identity", () => {
    const m = Matrix4.translation(5, 10, 15);
    const inv = m.invert();
    expect(inv).not.toBeNull();
    const result = m.multiply(inv!);
    expect(result.data[0]).toBeCloseTo(1);
    expect(result.data[5]).toBeCloseTo(1);
    expect(result.data[10]).toBeCloseTo(1);
    expect(result.data[15]).toBeCloseTo(1);
    expect(result.data[3]).toBeCloseTo(0);
    expect(result.data[7]).toBeCloseTo(0);
    expect(result.data[11]).toBeCloseTo(0);
  });
});

describe("Matrix4 - Transform Operations", () => {
  test("transformPoint() should apply full transform", () => {
    const m = Matrix4.translation(1, 2, 3);
    const p = new Vector3(0, 0, 0);
    const result = m.transformPoint(p);
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
    expect(result.z).toBe(3);
  });

  test("transformDirection() should not apply translation", () => {
    const m = Matrix4.translation(100, 200, 300);
    const dir = new Vector3(1, 0, 0);
    const result = m.transformDirection(dir);
    expect(result.x).toBe(1);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  test("transformVector4() should apply full matrix", () => {
    const m = Matrix4.scaling(2, 2, 2);
    const v = new Vector4(1, 1, 1, 1);
    const result = m.transformVector4(v);
    expect(result.x).toBe(2);
    expect(result.y).toBe(2);
    expect(result.z).toBe(2);
  });
});

describe("Matrix4 - View and Projection", () => {
  test("lookAt() should create view matrix", () => {
    const eye = new Vector3(0, 0, 10);
    const target = new Vector3(0, 0, 0);
    const up = new Vector3(0, 1, 0);
    const m = Matrix4.lookAt(eye, target, up);
    // Should be a valid view matrix (non-zero)
    expect(m.data[15]).toBeCloseTo(1);
  });

  test("perspective() should create projection matrix", () => {
    const m = Matrix4.perspective(Math.PI / 4, 16 / 9, 0.1, 100);
    // Check that it's a valid perspective matrix
    expect(m.data[14]).toBe(-1);
    expect(m.data[0]).toBeGreaterThan(0);
    expect(m.data[5]).toBeGreaterThan(0);
  });

  test("orthographic() should create ortho projection", () => {
    const m = Matrix4.orthographic(-10, 10, -10, 10, 0.1, 100);
    // Check that it's a valid orthographic matrix
    expect(m.data[0]).toBeCloseTo(0.1); // 2/(20) = 0.1
    expect(m.data[5]).toBeCloseTo(0.1);
  });
});

// ============================================================================
// Ray Tests
// ============================================================================

describe("Ray - Basic Operations", () => {
  test("constructor should normalize direction", () => {
    const origin = new Vector3(0, 0, 0);
    const direction = new Vector3(3, 4, 0);
    const ray = new Ray(origin, direction);
    expect(ray.direction.length()).toBeCloseTo(1);
  });

  test("at() should return point along ray", () => {
    const origin = new Vector3(0, 0, 0);
    const direction = new Vector3(1, 0, 0);
    const ray = new Ray(origin, direction);
    const point = ray.at(5);
    expect(point.x).toBe(5);
    expect(point.y).toBe(0);
    expect(point.z).toBe(0);
  });
});

describe("Ray - AABB Intersection", () => {
  let ray: Ray;
  const boxMin = new Vector3(-1, -1, -1);
  const boxMax = new Vector3(1, 1, 1);

  test("should hit box from outside", () => {
    ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    const t = ray.intersectAABB(boxMin, boxMax);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(9);
  });

  test("should miss box when aiming away", () => {
    ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, 1));
    const t = ray.intersectAABB(boxMin, boxMax);
    expect(t).toBeNull();
  });

  test("should miss box when parallel and outside", () => {
    ray = new Ray(new Vector3(5, 0, 0), new Vector3(0, 1, 0));
    const t = ray.intersectAABB(boxMin, boxMax);
    expect(t).toBeNull();
  });

  test("should hit box from different angles", () => {
    // From +X direction
    ray = new Ray(new Vector3(10, 0, 0), new Vector3(-1, 0, 0));
    expect(ray.intersectAABB(boxMin, boxMax)).not.toBeNull();

    // From +Y direction
    ray = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
    expect(ray.intersectAABB(boxMin, boxMax)).not.toBeNull();
  });
});

describe("Ray - Plane Intersection", () => {
  test("should hit plane when facing it", () => {
    const ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    const planeNormal = new Vector3(0, 0, 1);
    const planePoint = new Vector3(0, 0, 0);
    const t = ray.intersectPlane(planeNormal, planePoint);
    expect(t).toBeCloseTo(10);
  });

  test("should return null when parallel to plane", () => {
    const ray = new Ray(new Vector3(0, 0, 10), new Vector3(1, 0, 0));
    const planeNormal = new Vector3(0, 0, 1);
    const planePoint = new Vector3(0, 0, 0);
    const t = ray.intersectPlane(planeNormal, planePoint);
    expect(t).toBeNull();
  });

  test("should return null when plane is behind ray", () => {
    const ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, 1));
    const planeNormal = new Vector3(0, 0, 1);
    const planePoint = new Vector3(0, 0, 0);
    const t = ray.intersectPlane(planeNormal, planePoint);
    expect(t).toBeNull();
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe("Utility Functions", () => {
  test("clamp() should clamp to range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test("lerp() should interpolate", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  test("degToRad() should convert degrees to radians", () => {
    expect(degToRad(0)).toBe(0);
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  test("radToDeg() should convert radians to degrees", () => {
    expect(radToDeg(0)).toBe(0);
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });
});
