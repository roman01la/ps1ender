// Vector3 class for 3D vector operations
export class Vector3 {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0
  ) {}

  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  static one(): Vector3 {
    return new Vector3(1, 1, 1);
  }

  static up(): Vector3 {
    return new Vector3(0, 0, 1);
  }

  static forward(): Vector3 {
    return new Vector3(0, 0, 1);
  }

  static right(): Vector3 {
    return new Vector3(1, 0, 0);
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  mul(scalar: number): Vector3 {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  div(scalar: number): Vector3 {
    return new Vector3(this.x / scalar, this.y / scalar, this.z / scalar);
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): Vector3 {
    const len = this.length();
    if (len === 0) return new Vector3();
    return this.div(len);
  }

  negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  lerp(v: Vector3, t: number): Vector3 {
    return new Vector3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }
}

// Vector4 for homogeneous coordinates
export class Vector4 {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0,
    public w: number = 1
  ) {}

  static fromVector3(v: Vector3, w: number = 1): Vector4 {
    return new Vector4(v.x, v.y, v.z, w);
  }

  toVector3(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  perspectiveDivide(): Vector3 {
    if (this.w === 0) return new Vector3(this.x, this.y, this.z);
    return new Vector3(this.x / this.w, this.y / this.w, this.z / this.w);
  }
}

// Color class for RGBA colors
export class Color {
  constructor(
    public r: number = 0,
    public g: number = 0,
    public b: number = 0,
    public a: number = 255
  ) {}

  static white(): Color {
    return new Color(255, 255, 255, 255);
  }

  static black(): Color {
    return new Color(0, 0, 0, 255);
  }

  static red(): Color {
    return new Color(255, 0, 0, 255);
  }

  static green(): Color {
    return new Color(0, 255, 0, 255);
  }

  static blue(): Color {
    return new Color(0, 0, 255, 255);
  }

  static fromHex(hex: number): Color {
    return new Color((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255);
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b, this.a);
  }

  mul(scalar: number): Color {
    return new Color(
      Math.min(255, Math.max(0, this.r * scalar)),
      Math.min(255, Math.max(0, this.g * scalar)),
      Math.min(255, Math.max(0, this.b * scalar)),
      this.a
    );
  }

  add(c: Color): Color {
    return new Color(
      Math.min(255, this.r + c.r),
      Math.min(255, this.g + c.g),
      Math.min(255, this.b + c.b),
      this.a
    );
  }

  lerp(c: Color, t: number): Color {
    return new Color(
      this.r + (c.r - this.r) * t,
      this.g + (c.g - this.g) * t,
      this.b + (c.b - this.b) * t,
      this.a + (c.a - this.a) * t
    );
  }

  toUint32(): number {
    return (
      ((this.a & 0xff) << 24) |
      ((this.b & 0xff) << 16) |
      ((this.g & 0xff) << 8) |
      (this.r & 0xff)
    );
  }
}

// 4x4 Matrix class for transformations
export class Matrix4 {
  public data: Float32Array;

  constructor() {
    this.data = new Float32Array(16);
    this.identity();
  }

  identity(): Matrix4 {
    this.data.fill(0);
    this.data[0] = 1;
    this.data[5] = 1;
    this.data[10] = 1;
    this.data[15] = 1;
    return this;
  }

  clone(): Matrix4 {
    const m = new Matrix4();
    m.data.set(this.data);
    return m;
  }

  // Matrix inversion (returns null if singular)
  invert(): Matrix4 | null {
    const m = this.data;
    const inv = new Float32Array(16);

    inv[0] =
      m[5] * m[10] * m[15] -
      m[5] * m[11] * m[14] -
      m[9] * m[6] * m[15] +
      m[9] * m[7] * m[14] +
      m[13] * m[6] * m[11] -
      m[13] * m[7] * m[10];
    inv[4] =
      -m[4] * m[10] * m[15] +
      m[4] * m[11] * m[14] +
      m[8] * m[6] * m[15] -
      m[8] * m[7] * m[14] -
      m[12] * m[6] * m[11] +
      m[12] * m[7] * m[10];
    inv[8] =
      m[4] * m[9] * m[15] -
      m[4] * m[11] * m[13] -
      m[8] * m[5] * m[15] +
      m[8] * m[7] * m[13] +
      m[12] * m[5] * m[11] -
      m[12] * m[7] * m[9];
    inv[12] =
      -m[4] * m[9] * m[14] +
      m[4] * m[10] * m[13] +
      m[8] * m[5] * m[14] -
      m[8] * m[6] * m[13] -
      m[12] * m[5] * m[10] +
      m[12] * m[6] * m[9];
    inv[1] =
      -m[1] * m[10] * m[15] +
      m[1] * m[11] * m[14] +
      m[9] * m[2] * m[15] -
      m[9] * m[3] * m[14] -
      m[13] * m[2] * m[11] +
      m[13] * m[3] * m[10];
    inv[5] =
      m[0] * m[10] * m[15] -
      m[0] * m[11] * m[14] -
      m[8] * m[2] * m[15] +
      m[8] * m[3] * m[14] +
      m[12] * m[2] * m[11] -
      m[12] * m[3] * m[10];
    inv[9] =
      -m[0] * m[9] * m[15] +
      m[0] * m[11] * m[13] +
      m[8] * m[1] * m[15] -
      m[8] * m[3] * m[13] -
      m[12] * m[1] * m[11] +
      m[12] * m[3] * m[9];
    inv[13] =
      m[0] * m[9] * m[14] -
      m[0] * m[10] * m[13] -
      m[8] * m[1] * m[14] +
      m[8] * m[2] * m[13] +
      m[12] * m[1] * m[10] -
      m[12] * m[2] * m[9];
    inv[2] =
      m[1] * m[6] * m[15] -
      m[1] * m[7] * m[14] -
      m[5] * m[2] * m[15] +
      m[5] * m[3] * m[14] +
      m[13] * m[2] * m[7] -
      m[13] * m[3] * m[6];
    inv[6] =
      -m[0] * m[6] * m[15] +
      m[0] * m[7] * m[14] +
      m[4] * m[2] * m[15] -
      m[4] * m[3] * m[14] -
      m[12] * m[2] * m[7] +
      m[12] * m[3] * m[6];
    inv[10] =
      m[0] * m[5] * m[15] -
      m[0] * m[7] * m[13] -
      m[4] * m[1] * m[15] +
      m[4] * m[3] * m[13] +
      m[12] * m[1] * m[7] -
      m[12] * m[3] * m[5];
    inv[14] =
      -m[0] * m[5] * m[14] +
      m[0] * m[6] * m[13] +
      m[4] * m[1] * m[14] -
      m[4] * m[2] * m[13] -
      m[12] * m[1] * m[6] +
      m[12] * m[2] * m[5];
    inv[3] =
      -m[1] * m[6] * m[11] +
      m[1] * m[7] * m[10] +
      m[5] * m[2] * m[11] -
      m[5] * m[3] * m[10] -
      m[9] * m[2] * m[7] +
      m[9] * m[3] * m[6];
    inv[7] =
      m[0] * m[6] * m[11] -
      m[0] * m[7] * m[10] -
      m[4] * m[2] * m[11] +
      m[4] * m[3] * m[10] +
      m[8] * m[2] * m[7] -
      m[8] * m[3] * m[6];
    inv[11] =
      -m[0] * m[5] * m[11] +
      m[0] * m[7] * m[9] +
      m[4] * m[1] * m[11] -
      m[4] * m[3] * m[9] -
      m[8] * m[1] * m[7] +
      m[8] * m[3] * m[5];
    inv[15] =
      m[0] * m[5] * m[10] -
      m[0] * m[6] * m[9] -
      m[4] * m[1] * m[10] +
      m[4] * m[2] * m[9] +
      m[8] * m[1] * m[6] -
      m[8] * m[2] * m[5];

    const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (Math.abs(det) < 0.0001) return null;

    const invDet = 1 / det;
    const result = new Matrix4();
    for (let i = 0; i < 16; i++) {
      result.data[i] = inv[i] * invDet;
    }
    return result;
  }

  // Matrix multiplication
  multiply(other: Matrix4): Matrix4 {
    const result = new Matrix4();
    const a = this.data;
    const b = other.data;
    const r = result.data;

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        r[row * 4 + col] =
          a[row * 4 + 0] * b[0 * 4 + col] +
          a[row * 4 + 1] * b[1 * 4 + col] +
          a[row * 4 + 2] * b[2 * 4 + col] +
          a[row * 4 + 3] * b[3 * 4 + col];
      }
    }

    return result;
  }

  // Transform a Vector4
  transformVector4(v: Vector4): Vector4 {
    const d = this.data;
    return new Vector4(
      d[0] * v.x + d[1] * v.y + d[2] * v.z + d[3] * v.w,
      d[4] * v.x + d[5] * v.y + d[6] * v.z + d[7] * v.w,
      d[8] * v.x + d[9] * v.y + d[10] * v.z + d[11] * v.w,
      d[12] * v.x + d[13] * v.y + d[14] * v.z + d[15] * v.w
    );
  }

  // Transform a Vector3 (assumes w=1)
  transformPoint(v: Vector3): Vector3 {
    const v4 = this.transformVector4(Vector4.fromVector3(v, 1));
    return v4.perspectiveDivide();
  }

  // Transform a direction (assumes w=0)
  transformDirection(v: Vector3): Vector3 {
    const v4 = this.transformVector4(Vector4.fromVector3(v, 0));
    return v4.toVector3();
  }

  // Static factory methods
  static identity(): Matrix4 {
    return new Matrix4();
  }

  static translation(x: number, y: number, z: number): Matrix4 {
    const m = new Matrix4();
    m.data[3] = x;
    m.data[7] = y;
    m.data[11] = z;
    return m;
  }

  static scaling(x: number, y: number, z: number): Matrix4 {
    const m = new Matrix4();
    m.data[0] = x;
    m.data[5] = y;
    m.data[10] = z;
    return m;
  }

  static rotationX(angle: number): Matrix4 {
    const m = new Matrix4();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[5] = c;
    m.data[6] = -s;
    m.data[9] = s;
    m.data[10] = c;
    return m;
  }

  static rotationY(angle: number): Matrix4 {
    const m = new Matrix4();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[0] = c;
    m.data[2] = s;
    m.data[8] = -s;
    m.data[10] = c;
    return m;
  }

  static rotationZ(angle: number): Matrix4 {
    const m = new Matrix4();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m.data[0] = c;
    m.data[1] = -s;
    m.data[4] = s;
    m.data[5] = c;
    return m;
  }

  // Look-at matrix for camera
  static lookAt(eye: Vector3, target: Vector3, up: Vector3): Matrix4 {
    const zAxis = eye.sub(target).normalize(); // Forward
    const xAxis = up.cross(zAxis).normalize(); // Right
    const yAxis = zAxis.cross(xAxis); // Up

    const m = new Matrix4();
    const d = m.data;

    d[0] = xAxis.x;
    d[1] = xAxis.y;
    d[2] = xAxis.z;
    d[3] = -xAxis.dot(eye);

    d[4] = yAxis.x;
    d[5] = yAxis.y;
    d[6] = yAxis.z;
    d[7] = -yAxis.dot(eye);

    d[8] = zAxis.x;
    d[9] = zAxis.y;
    d[10] = zAxis.z;
    d[11] = -zAxis.dot(eye);

    d[12] = 0;
    d[13] = 0;
    d[14] = 0;
    d[15] = 1;

    return m;
  }

  // Perspective projection matrix
  static perspective(
    fov: number,
    aspect: number,
    near: number,
    far: number
  ): Matrix4 {
    const m = new Matrix4();
    const d = m.data;
    const tanHalfFov = Math.tan(fov / 2);

    d.fill(0);
    d[0] = 1 / (aspect * tanHalfFov);
    d[5] = 1 / tanHalfFov;
    d[10] = -(far + near) / (far - near);
    d[11] = -(2 * far * near) / (far - near);
    d[14] = -1;

    return m;
  }

  // Orthographic projection matrix
  static orthographic(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number
  ): Matrix4 {
    const m = new Matrix4();
    const d = m.data;

    d[0] = 2 / (right - left);
    d[5] = 2 / (top - bottom);
    d[10] = -2 / (far - near);
    d[3] = -(right + left) / (right - left);
    d[7] = -(top + bottom) / (top - bottom);
    d[11] = -(far + near) / (far - near);

    return m;
  }
}

// Ray class for picking/selection
export class Ray {
  constructor(public origin: Vector3, public direction: Vector3) {
    this.direction = direction.normalize();
  }

  /**
   * Get point along ray at distance t
   */
  at(t: number): Vector3 {
    return this.origin.add(this.direction.mul(t));
  }

  /**
   * Test intersection with axis-aligned bounding box
   * Returns distance to intersection or null if no hit
   */
  intersectAABB(min: Vector3, max: Vector3): number | null {
    let tmin = -Infinity;
    let tmax = Infinity;

    // X slab
    if (Math.abs(this.direction.x) > 0.0001) {
      const t1 = (min.x - this.origin.x) / this.direction.x;
      const t2 = (max.x - this.origin.x) / this.direction.x;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (this.origin.x < min.x || this.origin.x > max.x) {
      return null;
    }

    // Y slab
    if (Math.abs(this.direction.y) > 0.0001) {
      const t1 = (min.y - this.origin.y) / this.direction.y;
      const t2 = (max.y - this.origin.y) / this.direction.y;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (this.origin.y < min.y || this.origin.y > max.y) {
      return null;
    }

    // Z slab
    if (Math.abs(this.direction.z) > 0.0001) {
      const t1 = (min.z - this.origin.z) / this.direction.z;
      const t2 = (max.z - this.origin.z) / this.direction.z;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (this.origin.z < min.z || this.origin.z > max.z) {
      return null;
    }

    if (tmax < tmin || tmax < 0) return null;
    return tmin > 0 ? tmin : tmax;
  }

  /**
   * Test intersection with a plane
   * Returns distance to intersection or null if parallel
   */
  intersectPlane(planeNormal: Vector3, planePoint: Vector3): number | null {
    const denom = planeNormal.dot(this.direction);
    if (Math.abs(denom) < 0.0001) return null;

    const t = planePoint.sub(this.origin).dot(planeNormal) / denom;
    return t > 0 ? t : null;
  }
}

// Utility functions
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}
