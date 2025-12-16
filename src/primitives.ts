import { Vector3, Color } from "./math";
import { getPositionKey } from "./utils/geometry";

// Vertex structure with position, color, normal, and UV coordinates
export class Vertex {
  constructor(
    public position: Vector3,
    public color: Color = Color.white(),
    public normal: Vector3 = Vector3.zero(),
    public u: number = 0,
    public v: number = 0
  ) {}

  clone(): Vertex {
    return new Vertex(
      this.position.clone(),
      this.color.clone(),
      this.normal.clone(),
      this.u,
      this.v
    );
  }

  // Interpolate between two vertices
  static lerp(v1: Vertex, v2: Vertex, t: number): Vertex {
    return new Vertex(
      v1.position.lerp(v2.position, t),
      v1.color.lerp(v2.color, t),
      v1.normal.lerp(v2.normal, t),
      v1.u + (v2.u - v1.u) * t,
      v1.v + (v2.v - v1.v) * t
    );
  }
}

// Triangle primitive
export class Triangle {
  constructor(public v0: Vertex, public v1: Vertex, public v2: Vertex) {}

  // Calculate face normal
  getFaceNormal(): Vector3 {
    const edge1 = this.v1.position.sub(this.v0.position);
    const edge2 = this.v2.position.sub(this.v0.position);
    return edge1.cross(edge2).normalize();
  }

  // Get the centroid of the triangle
  getCentroid(): Vector3 {
    return new Vector3(
      (this.v0.position.x + this.v1.position.x + this.v2.position.x) / 3,
      (this.v0.position.y + this.v1.position.y + this.v2.position.y) / 3,
      (this.v0.position.z + this.v1.position.z + this.v2.position.z) / 3
    );
  }
}

/**
 * Face - a polygon with any number of vertices (3 = tri, 4 = quad, 5+ = n-gon)
 *
 * This is the primary topology representation. Faces store vertex indices directly.
 * Triangulation for GPU rendering is generated on-demand.
 *
 * Special case: Edge-only faces have 2 vertices and are used for rendering
 * standalone edges (e.g., from vertex extrusion).
 */
export interface Face {
  /** Vertex indices that make up this face (ordered, CCW winding) */
  vertices: number[];
}

// Mesh class to hold geometry
export class Mesh {
  /** Triangle objects for rendering (generated from faces) */
  public triangles: Triangle[] = [];

  /**
   * Enable PS1-style smooth (Gouraud) shading instead of flat shading.
   * When false (default): flat shading - each face has uniform lighting
   * When true: smooth shading - lighting is interpolated across vertices
   */
  public smoothShading: boolean = false;

  /**
   * Primary face data - polygons with any number of vertices.
   * This is the source of truth for topology.
   */
  public faceData: Face[] = [];

  /**
   * Triangulated indices for GPU rendering (generated from faceData)
   */
  public indices: number[] = [];

  constructor(public vertices: Vertex[] = [], indices?: number[]) {
    if (indices && indices.length > 0) {
      // Legacy path: indices provided, need to detect faces
      this.indices = indices;
      this.buildTriangles();
      this.buildFacesFromIndices();
    } else {
      // New path: start with empty faceData
      this.indices = [];
    }
  }

  /**
   * Build Triangle objects from indices (for rendering)
   */
  private buildTriangles(): void {
    this.triangles = [];
    for (let i = 0; i < this.indices.length; i += 3) {
      const v0 = this.vertices[this.indices[i]].clone();
      const v1 = this.vertices[this.indices[i + 1]].clone();
      const v2 = this.vertices[this.indices[i + 2]].clone();
      this.triangles.push(new Triangle(v0, v1, v2));
    }
  }

  /**
   * Build logical faces by detecting quads from triangle pairs.
   * Also builds faceData from detected quads/tris.
   *
   * Strategy: OBJ files triangulate quads into consecutive triangle pairs.
   * A quad face [v0, v1, v2, v3] becomes:
   *   - Triangle 1: [v0, v1, v2]
   *   - Triangle 2: [v0, v2, v3]
   *
   * So we check if consecutive triangles share exactly 2 vertex positions
   * (forming the diagonal of the original quad) and are roughly coplanar.
   */
  private buildFacesFromIndices(): void {
    this.faceData = [];
    const numTris = this.triangles.length;

    // Helper to get triangle vertex position keys
    const getTriPosKeys = (triIdx: number): Set<string> => {
      const base = triIdx * 3;
      return new Set([
        getPositionKey(this.vertices[this.indices[base]].position),
        getPositionKey(this.vertices[this.indices[base + 1]].position),
        getPositionKey(this.vertices[this.indices[base + 2]].position),
      ]);
    };

    // Helper to count shared positions between two triangles
    const countSharedPositions = (
      keys1: Set<string>,
      keys2: Set<string>
    ): number => {
      let count = 0;
      for (const key of keys1) {
        if (keys2.has(key)) count++;
      }
      return count;
    };

    // Helper to check if two triangles are coplanar (or if either is degenerate)
    const areCoplanarOrDegenerate = (t1Idx: number, t2Idx: number): boolean => {
      const n1 = this.triangles[t1Idx].getFaceNormal();
      const n2 = this.triangles[t2Idx].getFaceNormal();

      // Check for degenerate triangles (NaN or zero-length normals from zero-area triangles)
      const n1Valid =
        !isNaN(n1.x) &&
        !isNaN(n1.y) &&
        !isNaN(n1.z) &&
        (n1.x !== 0 || n1.y !== 0 || n1.z !== 0);
      const n2Valid =
        !isNaN(n2.x) &&
        !isNaN(n2.y) &&
        !isNaN(n2.z) &&
        (n2.x !== 0 || n2.y !== 0 || n2.z !== 0);

      // If either triangle is degenerate, assume they're part of a quad
      // (this handles freshly extruded quads where vertices haven't moved yet)
      if (!n1Valid || !n2Valid) return true;

      const dot = Math.abs(n1.dot(n2));
      return dot > 0.9;
    };

    // Helper to check if a triangle is an intentional edge-only degenerate triangle
    // These have a repeated vertex INDEX (like [4, 5, 4]) - used for edge rendering
    // This is different from zero-area triangles from extrusion which have different indices
    const isEdgeOnlyTriangle = (triIdx: number): boolean => {
      const base = triIdx * 3;
      const i0 = this.indices[base];
      const i1 = this.indices[base + 1];
      const i2 = this.indices[base + 2];
      // Check if any vertex index is repeated
      return i0 === i1 || i1 === i2 || i0 === i2;
    };

    // Process triangles in pairs (consecutive pairs from OBJ triangulation)
    let i = 0;
    while (i < numTris) {
      // Check if this triangle and the next one form a quad
      if (i + 1 < numTris) {
        const keys1 = getTriPosKeys(i);
        const keys2 = getTriPosKeys(i + 1);
        const sharedCount = countSharedPositions(keys1, keys2);

        // Skip edge-only triangles - they have repeated indices and should not be paired into quads
        const tri1EdgeOnly = isEdgeOnlyTriangle(i);
        const tri2EdgeOnly = isEdgeOnlyTriangle(i + 1);

        // A valid quad pair shares exactly 2 positions (the diagonal edge)
        // and the triangles should be roughly coplanar (or degenerate for freshly extruded)
        // BUT neither triangle should be an edge-only triangle (repeated index)
        if (
          sharedCount === 2 &&
          !tri1EdgeOnly &&
          !tri2EdgeOnly &&
          areCoplanarOrDegenerate(i, i + 1)
        ) {
          // New faceData structure - extract quad vertices from the two triangles
          const base1 = i * 3;
          const base2 = (i + 1) * 3;
          const quadVertices = this.extractQuadVertices(
            [
              this.indices[base1],
              this.indices[base1 + 1],
              this.indices[base1 + 2],
            ],
            [
              this.indices[base2],
              this.indices[base2 + 1],
              this.indices[base2 + 2],
            ]
          );
          this.faceData.push({ vertices: quadVertices });

          i += 2; // Skip both triangles
          continue;
        }
      }

      // Check for edge-only triangles (degenerate with repeated index)
      const base = i * 3;
      const i0 = this.indices[base];
      const i1 = this.indices[base + 1];
      const i2 = this.indices[base + 2];

      if (i0 === i2) {
        // Edge-only face: [v0, v1, v0] -> edge between v0 and v1
        this.faceData.push({ vertices: [i0, i1] }); // 2-vertex edge face
      } else {
        // Regular triangle
        this.faceData.push({ vertices: [i0, i1, i2] });
      }
      i += 1;
    }
  }

  /**
   * Extract ordered quad vertices from two triangles that share an edge (the diagonal)
   * Preserves the winding order from the original triangles so that fan triangulation
   * produces triangles with the same winding.
   */
  private extractQuadVertices(tri1: number[], tri2: number[]): number[] {
    // Find the shared vertices (diagonal) and unique vertices (corners)
    const tri1Set = new Set(tri1);
    const tri2Set = new Set(tri2);

    const shared: number[] = [];
    const unique1: number[] = [];
    const unique2: number[] = [];

    for (const v of tri1) {
      if (tri2Set.has(v)) {
        if (!shared.includes(v)) shared.push(v);
      } else {
        unique1.push(v);
      }
    }
    for (const v of tri2) {
      if (!tri1Set.has(v)) {
        unique2.push(v);
      }
    }

    if (unique1.length !== 1 || unique2.length !== 1 || shared.length !== 2) {
      // Fallback: just return all unique vertices from both triangles
      const allVerts = new Set([...tri1, ...tri2]);
      return Array.from(allVerts);
    }

    // Fan triangulation of [v0, v1, v2, v3] produces:
    //   - [v0, v1, v2]
    //   - [v0, v2, v3]
    //
    // We need to find v0-v3 such that the fan triangles EXACTLY match
    // the original triangles (same order = same winding).
    //
    // v0 and v2 are the shared (diagonal) vertices
    // v1 and v3 are the unique vertices

    const u1 = unique1[0];
    const u2 = unique2[0];
    const s0 = shared[0];
    const s1 = shared[1];

    // Helper to check if two triangles have same winding (exact rotation match)
    const sameWindingTriangle = (t1: number[], t2: number[]): boolean => {
      // Check if t1 is a rotation of t2 (same winding)
      for (let rot = 0; rot < 3; rot++) {
        if (
          t1[0] === t2[rot] &&
          t1[1] === t2[(rot + 1) % 3] &&
          t1[2] === t2[(rot + 2) % 3]
        ) {
          return true;
        }
      }
      return false;
    };

    // Try all 8 possible quad orderings
    const orderings = [
      [s0, u1, s1, u2],
      [s0, u2, s1, u1],
      [s1, u1, s0, u2],
      [s1, u2, s0, u1],
      [u1, s0, u2, s1],
      [u1, s1, u2, s0],
      [u2, s0, u1, s1],
      [u2, s1, u1, s0],
    ];

    for (let i = 0; i < orderings.length; i++) {
      const quad = orderings[i];
      // Fan triangulation produces [quad[0], quad[1], quad[2]] and [quad[0], quad[2], quad[3]]
      const fanTri1 = [quad[0], quad[1], quad[2]];
      const fanTri2 = [quad[0], quad[2], quad[3]];

      // Check if fan triangles match original triangles WITH SAME WINDING
      if (
        (sameWindingTriangle(fanTri1, tri1) &&
          sameWindingTriangle(fanTri2, tri2)) ||
        (sameWindingTriangle(fanTri1, tri2) &&
          sameWindingTriangle(fanTri2, tri1))
      ) {
        return quad;
      }
    }

    // Fallback - shouldn't happen if triangles are valid
    return [s0, u1, s1, u2];
  }

  /**
   * Generate triangulated indices from faceData.
   * This is called when faceData is the source of truth and we need indices for rendering.
   */
  private triangulateFromFaces(): void {
    this.indices = [];

    for (let fi = 0; fi < this.faceData.length; fi++) {
      const face = this.faceData[fi];
      const verts = face.vertices;

      if (verts.length < 2) {
        // Invalid face, skip
        continue;
      } else if (verts.length === 2) {
        // Edge-only face - create degenerate triangle [v0, v1, v0]
        this.indices.push(verts[0], verts[1], verts[0]);
      } else if (verts.length === 3) {
        // Triangle - add directly
        this.indices.push(verts[0], verts[1], verts[2]);
      } else {
        // N-gon (4+ vertices) - fan triangulation from first vertex
        for (let i = 1; i < verts.length - 1; i++) {
          this.indices.push(verts[0], verts[i], verts[i + 1]);
        }
      }
    }
  }

  /**
   * Add a face to the mesh (new API)
   * @param vertices Vertex indices for the face (3 for tri, 4 for quad, 2 for edge)
   */
  addFace(vertices: number[]): number {
    const faceIndex = this.faceData.length;
    this.faceData.push({ vertices: [...vertices] });
    return faceIndex;
  }

  /**
   * Get face vertex count (3 = tri, 4 = quad, 2 = edge, 5+ = n-gon)
   */
  getFaceVertexCount(faceIndex: number): number {
    if (faceIndex < 0 || faceIndex >= this.faceData.length) return 0;
    return this.faceData[faceIndex].vertices.length;
  }

  /**
   * Check if a face is a quad
   */
  isQuad(faceIndex: number): boolean {
    return this.getFaceVertexCount(faceIndex) === 4;
  }

  /**
   * Check if a face is an edge-only face
   */
  isEdgeFace(faceIndex: number): boolean {
    return this.getFaceVertexCount(faceIndex) === 2;
  }

  // Public method to rebuild triangles (e.g., after modifying vertices)
  // Does NOT rebuild faces to keep face indices stable during transforms
  rebuildTriangles(): void {
    this.buildTriangles();
  }

  /**
   * Recalculate vertex normals based on current face geometry.
   * Uses flat shading (PS1-style) - each vertex gets the normal of its face.
   * Call this after transforming vertices (rotate, scale, etc.) to update lighting.
   */
  recalculateNormals(): void {
    // PS1-style flat shading: each triangle's vertices get the face normal
    for (let i = 0; i < this.indices.length; i += 3) {
      const i0 = this.indices[i];
      const i1 = this.indices[i + 1];
      const i2 = this.indices[i + 2];

      const v0 = this.vertices[i0].position;
      const v1 = this.vertices[i1].position;
      const v2 = this.vertices[i2].position;

      const edge1 = v1.sub(v0);
      const edge2 = v2.sub(v0);
      const faceNormal = edge1.cross(edge2).normalize();

      // All vertices of this triangle get the same face normal (flat shading)
      this.vertices[i0].normal = faceNormal;
      this.vertices[i1].normal = faceNormal;
      this.vertices[i2].normal = faceNormal;
    }

    // Rebuild triangles to pick up the new normals
    this.buildTriangles();
  }

  // Public method to rebuild both triangles AND faces from indices
  // Use this after legacy operations that modify indices directly
  rebuildMesh(): void {
    this.buildTriangles();
    this.buildFacesFromIndices();
  }

  /**
   * Rebuild indices and triangles from faceData
   * Use this after operations that modify faceData directly (new API)
   * Also recalculates normals to ensure lighting is correct for new geometry
   */
  rebuildFromFaces(): void {
    this.triangulateFromFaces();
    this.buildTriangles();
    // Recalculate normals for correct lighting on new geometry
    this.recalculateNormals();
  }

  /**
   * Get the number of triangles a face generates
   * Edge (2 verts) -> 1 degenerate triangle
   * Triangle (3 verts) -> 1 triangle
   * Quad (4 verts) -> 2 triangles
   * N-gon (n verts) -> n-2 triangles
   */
  private getTriangleCountForFace(faceIdx: number): number {
    if (faceIdx < 0 || faceIdx >= this.faceData.length) return 0;
    const numVerts = this.faceData[faceIdx].vertices.length;
    if (numVerts < 2) return 0;
    if (numVerts === 2) return 1; // Edge face
    return numVerts - 2; // Fan triangulation
  }

  /**
   * Get the starting triangle index for a face
   */
  private getTriangleStartForFace(faceIdx: number): number {
    let triStart = 0;
    for (let i = 0; i < faceIdx && i < this.faceData.length; i++) {
      triStart += this.getTriangleCountForFace(i);
    }
    return triStart;
  }

  /**
   * Get the logical face index that contains a given triangle index
   */
  getFaceForTriangle(triIdx: number): number {
    let triStart = 0;
    for (let i = 0; i < this.faceData.length; i++) {
      const triCount = this.getTriangleCountForFace(i);
      if (triIdx >= triStart && triIdx < triStart + triCount) {
        return i;
      }
      triStart += triCount;
    }
    return -1;
  }

  /**
   * Get all triangle indices for a logical face
   */
  getTrianglesForFace(faceIdx: number): number[] {
    if (faceIdx < 0 || faceIdx >= this.faceData.length) return [];
    const triStart = this.getTriangleStartForFace(faceIdx);
    const triCount = this.getTriangleCountForFace(faceIdx);
    const result: number[] = [];
    for (let i = 0; i < triCount; i++) {
      result.push(triStart + i);
    }
    return result;
  }

  /**
   * Get all internal diagonal edges (edges inside quads that should be hidden)
   * Returns position-based edge keys to handle duplicate vertices
   *
   * With faceData, quads store 4 vertices [v0, v1, v2, v3].
   * Fan triangulation creates triangles [v0,v1,v2] and [v0,v2,v3].
   * So the diagonal is always v0-v2.
   */
  getQuadDiagonalEdges(): Set<string> {
    const diagonals = new Set<string>();

    for (const face of this.faceData) {
      if (face.vertices.length === 4) {
        // Quad: diagonal is between vertices[0] and vertices[2]
        const v0 = face.vertices[0];
        const v2 = face.vertices[2];
        const pos0 = getPositionKey(this.vertices[v0].position);
        const pos2 = getPositionKey(this.vertices[v2].position);
        const diagonalKey = [pos0, pos2].sort().join("|");
        diagonals.add(diagonalKey);
      }
    }

    return diagonals;
  }

  // Get bounding box of the mesh
  getBounds(): { min: Vector3; max: Vector3 } {
    if (this.vertices.length === 0) {
      return { min: Vector3.zero(), max: Vector3.zero() };
    }

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);

    for (const vertex of this.vertices) {
      min.x = Math.min(min.x, vertex.position.x);
      min.y = Math.min(min.y, vertex.position.y);
      min.z = Math.min(min.z, vertex.position.z);
      max.x = Math.max(max.x, vertex.position.x);
      max.y = Math.max(max.y, vertex.position.y);
      max.z = Math.max(max.z, vertex.position.z);
    }

    return { min, max };
  }

  // Get center of the mesh
  getCenter(): Vector3 {
    const bounds = this.getBounds();
    return new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2
    );
  }

  // Get the size of the mesh
  getSize(): Vector3 {
    const bounds = this.getBounds();
    return new Vector3(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z
    );
  }
}

/**
 * Create a plane mesh (single quad, 2 triangles)
 */
export function createPlaneMesh(size: number = 2): Mesh {
  const half = size / 2;
  const color = Color.white();
  const normal = new Vector3(0, 0, 1); // Z-up

  const vertices: Vertex[] = [
    new Vertex(new Vector3(-half, -half, 0), color, normal, 0, 0),
    new Vertex(new Vector3(half, -half, 0), color, normal, 1, 0),
    new Vertex(new Vector3(half, half, 0), color, normal, 1, 1),
    new Vertex(new Vector3(-half, half, 0), color, normal, 0, 1),
  ];

  // Two triangles forming a quad
  const indices = [0, 2, 1, 0, 3, 2];

  return new Mesh(vertices, indices);
}

/**
 * Create a cube mesh
 */
export function createCubeMesh(size: number = 2): Mesh {
  const half = size / 2;
  const color = Color.white();

  // Define 8 corner positions
  const positions = [
    new Vector3(-half, -half, -half), // 0: front-bottom-left
    new Vector3(half, -half, -half), // 1: front-bottom-right
    new Vector3(half, half, -half), // 2: front-top-right
    new Vector3(-half, half, -half), // 3: front-top-left
    new Vector3(-half, -half, half), // 4: back-bottom-left
    new Vector3(half, -half, half), // 5: back-bottom-right
    new Vector3(half, half, half), // 6: back-top-right
    new Vector3(-half, half, half), // 7: back-top-left
  ];

  // Face normals (Z-up coordinate system)
  const normals = {
    front: new Vector3(0, -1, 0), // -Y face
    back: new Vector3(0, 1, 0), // +Y face
    top: new Vector3(0, 0, 1), // +Z face (top in Z-up)
    bottom: new Vector3(0, 0, -1), // -Z face (bottom in Z-up)
    right: new Vector3(1, 0, 0),
    left: new Vector3(-1, 0, 0),
  };

  const vertices: Vertex[] = [];
  const indices: number[] = [];

  // Helper to add a face (quad = 2 triangles)
  const addFace = (
    p0: number,
    p1: number,
    p2: number,
    p3: number,
    normal: Vector3
  ) => {
    const baseIndex = vertices.length;

    vertices.push(
      new Vertex(positions[p0], color, normal, 0, 0),
      new Vertex(positions[p1], color, normal, 1, 0),
      new Vertex(positions[p2], color, normal, 1, 1),
      new Vertex(positions[p3], color, normal, 0, 1)
    );

    // Two triangles: 0-2-1, 0-3-2
    indices.push(
      baseIndex,
      baseIndex + 2,
      baseIndex + 1,
      baseIndex,
      baseIndex + 3,
      baseIndex + 2
    );
  };

  // Add all 6 faces
  addFace(0, 1, 2, 3, normals.front); // Front
  addFace(5, 4, 7, 6, normals.back); // Back
  addFace(3, 2, 6, 7, normals.top); // Top
  addFace(4, 5, 1, 0, normals.bottom); // Bottom
  addFace(1, 5, 6, 2, normals.right); // Right
  addFace(4, 0, 3, 7, normals.left); // Left

  return new Mesh(vertices, indices);
}

/**
 * Create a circle mesh (ring/wireframe - edges only, no fill)
 */
export function createCircleMesh(
  radius: number = 1,
  segments: number = 32
): Mesh {
  const color = Color.white();
  const normal = new Vector3(0, 0, 1); // Z-up

  const vertices: Vertex[] = [];
  const indices: number[] = [];

  // Create vertices around the circle (XY plane)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    // UV mapping: map circle to 0-1 range
    const u = (Math.cos(angle) + 1) / 2;
    const v = (Math.sin(angle) + 1) / 2;

    vertices.push(new Vertex(new Vector3(x, y, 0), color, normal, u, v));
  }

  // Create degenerate triangles for each edge segment
  // This creates edges that can be rendered in wireframe mode
  for (let i = 0; i < segments; i++) {
    const current = i;
    const next = (i + 1) % segments;

    // Degenerate triangle: two vertices on the edge, third is same as first
    // This gives us edges without filling
    indices.push(current, next, current);
  }

  return new Mesh(vertices, indices);
}

/**
 * Create a UV sphere mesh
 */
export function createUVSphereMesh(
  radius: number = 1,
  segments: number = 32,
  rings: number = 16
): Mesh {
  const color = Color.white();
  const vertices: Vertex[] = [];
  const indices: number[] = [];

  // Generate vertices
  for (let ring = 0; ring <= rings; ring++) {
    const phi = (ring / rings) * Math.PI; // 0 to PI (top to bottom)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let seg = 0; seg <= segments; seg++) {
      const theta = (seg / segments) * Math.PI * 2; // 0 to 2PI
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      // Position (Z-up: x = right, y = forward, z = up)
      const x = radius * sinPhi * cosTheta;
      const y = radius * sinPhi * sinTheta;
      const z = radius * cosPhi;

      // Normal (same as position for a sphere, normalized)
      const normal = new Vector3(sinPhi * cosTheta, sinPhi * sinTheta, cosPhi);

      // UV
      const u = seg / segments;
      const v = ring / rings;

      vertices.push(new Vertex(new Vector3(x, y, z), color, normal, u, v));
    }
  }

  // Generate indices (quads as two triangles)
  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const current = ring * (segments + 1) + seg;
      const next = current + segments + 1;

      // Two triangles per quad
      indices.push(current, next, current + 1);
      indices.push(current + 1, next, next + 1);
    }
  }

  return new Mesh(vertices, indices);
}

/**
 * Create an icosphere mesh (subdivided icosahedron)
 */
export function createIcoSphereMesh(
  radius: number = 1,
  subdivisions: number = 2
): Mesh {
  const color = Color.white();

  // Golden ratio
  const t = (1 + Math.sqrt(5)) / 2;

  // Initial icosahedron vertices (normalized)
  const initialPositions = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(([x, y, z]) => {
    const len = Math.sqrt(x * x + y * y + z * z);
    return new Vector3(x / len, y / len, z / len);
  });

  // Initial icosahedron faces (20 triangles)
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  let positions = [...initialPositions];

  // Subdivision
  const midpointCache = new Map<string, number>();

  const getMidpoint = (i1: number, i2: number): number => {
    const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
    if (midpointCache.has(key)) {
      return midpointCache.get(key)!;
    }

    const p1 = positions[i1];
    const p2 = positions[i2];
    const mid = new Vector3(
      (p1.x + p2.x) / 2,
      (p1.y + p2.y) / 2,
      (p1.z + p2.z) / 2
    ).normalize();

    const idx = positions.length;
    positions.push(mid);
    midpointCache.set(key, idx);
    return idx;
  };

  for (let i = 0; i < subdivisions; i++) {
    const newFaces: [number, number, number][] = [];

    for (const [v0, v1, v2] of faces) {
      const a = getMidpoint(v0, v1);
      const b = getMidpoint(v1, v2);
      const c = getMidpoint(v2, v0);

      newFaces.push([v0, a, c], [v1, b, a], [v2, c, b], [a, b, c]);
    }

    faces = newFaces;
    midpointCache.clear();
  }

  // Create mesh vertices with proper normals and UVs
  const vertices: Vertex[] = [];
  const indices: number[] = [];

  for (const [i0, i1, i2] of faces) {
    const baseIdx = vertices.length;

    for (const idx of [i0, i1, i2]) {
      const pos = positions[idx].mul(radius);
      const normal = positions[idx]; // Normal points outward (same as normalized position)

      // Spherical UV mapping
      const u = 0.5 + Math.atan2(normal.y, normal.x) / (2 * Math.PI);
      const v = 0.5 - Math.asin(normal.z) / Math.PI;

      vertices.push(new Vertex(pos, color, normal, u, v));
    }

    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
  }

  return new Mesh(vertices, indices);
}

/**
 * Create a cylinder mesh
 */
export function createCylinderMesh(
  radius: number = 1,
  depth: number = 2,
  vertices_count: number = 32
): Mesh {
  const color = Color.white();
  const vertices: Vertex[] = [];
  const indices: number[] = [];

  const halfDepth = depth / 2;

  // Create top and bottom cap centers
  const topCenterIdx = 0;
  const bottomCenterIdx = 1;

  vertices.push(
    new Vertex(
      new Vector3(0, 0, halfDepth),
      color,
      new Vector3(0, 0, 1),
      0.5,
      0.5
    ),
    new Vertex(
      new Vector3(0, 0, -halfDepth),
      color,
      new Vector3(0, 0, -1),
      0.5,
      0.5
    )
  );

  // Create ring vertices for top, bottom, and side
  for (let i = 0; i <= vertices_count; i++) {
    const angle = (i / vertices_count) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = radius * cos;
    const y = radius * sin;

    // UV for caps
    const capU = (cos + 1) / 2;
    const capV = (sin + 1) / 2;

    // UV for sides
    const sideU = i / vertices_count;

    // Top cap vertex
    vertices.push(
      new Vertex(
        new Vector3(x, y, halfDepth),
        color,
        new Vector3(0, 0, 1),
        capU,
        capV
      )
    );

    // Bottom cap vertex
    vertices.push(
      new Vertex(
        new Vector3(x, y, -halfDepth),
        color,
        new Vector3(0, 0, -1),
        capU,
        capV
      )
    );

    // Side top vertex
    vertices.push(
      new Vertex(
        new Vector3(x, y, halfDepth),
        color,
        new Vector3(cos, sin, 0),
        sideU,
        0
      )
    );

    // Side bottom vertex
    vertices.push(
      new Vertex(
        new Vector3(x, y, -halfDepth),
        color,
        new Vector3(cos, sin, 0),
        sideU,
        1
      )
    );
  }

  // Create faces
  for (let i = 0; i < vertices_count; i++) {
    const base = 2 + i * 4;
    const nextBase = 2 + ((i + 1) % (vertices_count + 1)) * 4;

    // Top cap triangle
    indices.push(topCenterIdx, base, nextBase);

    // Bottom cap triangle (reversed winding)
    indices.push(bottomCenterIdx, nextBase + 1, base + 1);

    // Side quad (two triangles)
    indices.push(base + 2, base + 3, nextBase + 2);
    indices.push(nextBase + 2, base + 3, nextBase + 3);
  }

  return new Mesh(vertices, indices);
}

/**
 * Create a cone mesh (can also be a truncated cone with radius2 > 0)
 */
export function createConeMesh(
  radius1: number = 1,
  radius2: number = 0,
  depth: number = 2,
  vertices_count: number = 32
): Mesh {
  const color = Color.white();
  const vertices: Vertex[] = [];
  const indices: number[] = [];

  const halfDepth = depth / 2;
  const hasTopCap = radius2 > 0.001;

  // Calculate side normal angle
  const sideAngle = Math.atan2(radius1 - radius2, depth);
  const cosAngle = Math.cos(sideAngle);
  const sinAngle = Math.sin(sideAngle);

  // Create cap centers
  let topCenterIdx = -1;
  let bottomCenterIdx = -1;

  // Bottom cap center
  bottomCenterIdx = vertices.length;
  vertices.push(
    new Vertex(
      new Vector3(0, 0, -halfDepth),
      color,
      new Vector3(0, 0, -1),
      0.5,
      0.5
    )
  );

  // Top cap center (or apex)
  topCenterIdx = vertices.length;
  if (hasTopCap) {
    vertices.push(
      new Vertex(
        new Vector3(0, 0, halfDepth),
        color,
        new Vector3(0, 0, 1),
        0.5,
        0.5
      )
    );
  } else {
    // Apex point
    vertices.push(
      new Vertex(
        new Vector3(0, 0, halfDepth),
        color,
        new Vector3(0, 0, 1),
        0.5,
        0.5
      )
    );
  }

  // Create ring vertices
  for (let i = 0; i <= vertices_count; i++) {
    const angle = (i / vertices_count) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const bottomX = radius1 * cos;
    const bottomY = radius1 * sin;
    const topX = radius2 * cos;
    const topY = radius2 * sin;

    // UV for caps
    const capU = (cos + 1) / 2;
    const capV = (sin + 1) / 2;

    // UV for sides
    const sideU = i / vertices_count;

    // Side normal (perpendicular to side surface)
    const sideNormal = new Vector3(cos * cosAngle, sin * cosAngle, sinAngle);

    // Bottom cap vertex
    vertices.push(
      new Vertex(
        new Vector3(bottomX, bottomY, -halfDepth),
        color,
        new Vector3(0, 0, -1),
        capU,
        capV
      )
    );

    // Top cap/apex vertex
    if (hasTopCap) {
      vertices.push(
        new Vertex(
          new Vector3(topX, topY, halfDepth),
          color,
          new Vector3(0, 0, 1),
          capU,
          capV
        )
      );
    }

    // Side bottom vertex
    vertices.push(
      new Vertex(
        new Vector3(bottomX, bottomY, -halfDepth),
        color,
        sideNormal,
        sideU,
        1
      )
    );

    // Side top vertex
    vertices.push(
      new Vertex(
        new Vector3(topX, topY, halfDepth),
        color,
        sideNormal,
        sideU,
        0
      )
    );
  }

  // Create faces
  const verticesPerRing = hasTopCap ? 4 : 3;

  for (let i = 0; i < vertices_count; i++) {
    const base = 2 + i * verticesPerRing;
    const nextBase = 2 + ((i + 1) % (vertices_count + 1)) * verticesPerRing;

    // Bottom cap triangle (reversed winding)
    indices.push(bottomCenterIdx, nextBase, base);

    if (hasTopCap) {
      // Top cap triangle
      indices.push(topCenterIdx, base + 1, nextBase + 1);

      // Side quad
      const sideBase = base + 2;
      const sideNextBase = nextBase + 2;
      indices.push(sideBase, sideBase + 1, sideNextBase);
      indices.push(sideNextBase, sideBase + 1, sideNextBase + 1);
    } else {
      // Side triangle (cone point)
      const sideBase = base + 1;
      const sideNextBase = nextBase + 1;
      indices.push(sideBase, sideBase + 1, sideNextBase);
    }
  }

  return new Mesh(vertices, indices);
}

/**
 * Create a torus mesh
 */
export function createTorusMesh(
  majorRadius: number = 1,
  minorRadius: number = 0.25,
  majorSegments: number = 48,
  minorSegments: number = 12
): Mesh {
  const color = Color.white();
  const vertices: Vertex[] = [];
  const indices: number[] = [];

  // Generate vertices
  for (let i = 0; i <= majorSegments; i++) {
    const majorAngle = (i / majorSegments) * Math.PI * 2;
    const cosMajor = Math.cos(majorAngle);
    const sinMajor = Math.sin(majorAngle);

    for (let j = 0; j <= minorSegments; j++) {
      const minorAngle = (j / minorSegments) * Math.PI * 2;
      const cosMinor = Math.cos(minorAngle);
      const sinMinor = Math.sin(minorAngle);

      // Position
      const x = (majorRadius + minorRadius * cosMinor) * cosMajor;
      const y = (majorRadius + minorRadius * cosMinor) * sinMajor;
      const z = minorRadius * sinMinor;

      // Normal (points from center of tube)
      const normal = new Vector3(
        cosMinor * cosMajor,
        cosMinor * sinMajor,
        sinMinor
      );

      // UV
      const u = i / majorSegments;
      const v = j / minorSegments;

      vertices.push(new Vertex(new Vector3(x, y, z), color, normal, u, v));
    }
  }

  // Generate indices
  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      const current = i * (minorSegments + 1) + j;
      const next = current + minorSegments + 1;

      // Two triangles per quad
      indices.push(current, next, current + 1);
      indices.push(current + 1, next, next + 1);
    }
  }

  return new Mesh(vertices, indices);
}
