import { Vector3, Color } from "./math";
import { Vertex, Mesh, Face } from "./primitives";
import { Texture, Material, MTLLoader } from "./texture";

/**
 * OBJ file loader
 * Supports:
 * - Vertex positions (v)
 * - Texture coordinates (vt)
 * - Vertex normals (vn)
 * - Faces (f) with various formats: v, v/vt, v/vt/vn, v//vn
 * - Groups (g) - creates separate meshes
 * - Material library (mtllib)
 * - Material usage (usemtl)
 * - Comments (#)
 */

export interface OBJLoadResult {
  meshes: Map<string, Mesh>;
  defaultMesh: Mesh;
  materials: Map<string, Material>;
  defaultTexture: Texture | null;
  mtlFile: string | null;
}

export class OBJLoader {
  /**
   * Parse OBJ file content and return mesh(es)
   */
  static parse(
    objContent: string,
    defaultColor: Color = Color.white()
  ): OBJLoadResult {
    const lines = objContent.split("\n");

    // Raw data from OBJ
    const positions: Vector3[] = [];
    const texCoords: [number, number][] = [];
    const normals: Vector3[] = [];

    // Current group data
    let currentGroupName = "default";
    let mtlFile: string | null = null;
    let currentMaterial: string | null = null;
    const groups: Map<
      string,
      {
        vertices: Vertex[];
        indices: number[];
        faceData: Face[];
        material: string | null;
      }
    > = new Map();
    groups.set(currentGroupName, {
      vertices: [],
      indices: [],
      faceData: [],
      material: null,
    });

    // Vertex cache for deduplication (OBJ uses indices into separate arrays)
    const vertexCache: Map<string, number> = new Map();

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();

      // Skip empty lines and comments
      if (line.length === 0 || line.startsWith("#")) {
        continue;
      }

      const parts = line.split(/\s+/);
      const command = parts[0];

      switch (command) {
        case "v": // Vertex position
          positions.push(
            new Vector3(
              parseFloat(parts[1]) || 0,
              parseFloat(parts[2]) || 0,
              parseFloat(parts[3]) || 0
            )
          );
          break;

        case "vt": // Texture coordinate
          texCoords.push([
            parseFloat(parts[1]) || 0,
            parseFloat(parts[2]) || 0,
          ]);
          break;

        case "vn": // Vertex normal
          normals.push(
            new Vector3(
              parseFloat(parts[1]) || 0,
              parseFloat(parts[2]) || 0,
              parseFloat(parts[3]) || 0
            ).normalize()
          );
          break;

        case "g": // Group
        case "o": // Object
          currentGroupName = parts[1] || "default";
          if (!groups.has(currentGroupName)) {
            groups.set(currentGroupName, {
              vertices: [],
              indices: [],
              faceData: [],
              material: currentMaterial,
            });
            vertexCache.clear(); // Reset cache for new group
          }
          break;

        case "mtllib": // Material library
          mtlFile = parts.slice(1).join(" "); // Handle filenames with spaces
          break;

        case "usemtl": // Use material
          currentMaterial = parts.slice(1).join(" ");
          // Update current group's material
          const currentGroup = groups.get(currentGroupName);
          if (currentGroup && !currentGroup.material) {
            currentGroup.material = currentMaterial;
          }
          break;

        case "f": // Face
          const group = groups.get(currentGroupName)!;
          const faceVertices: number[] = [];

          // Parse each vertex of the face
          for (let i = 1; i < parts.length; i++) {
            const vertexData = parts[i];
            const cacheKey = `${currentGroupName}:${vertexData}`;

            if (vertexCache.has(cacheKey)) {
              faceVertices.push(vertexCache.get(cacheKey)!);
            } else {
              // Parse vertex indices (format: v/vt/vn or v//vn or v/vt or v)
              const indices = vertexData.split("/");
              const posIdx = parseInt(indices[0]) - 1; // OBJ indices are 1-based
              const texIdx = indices[1] ? parseInt(indices[1]) - 1 : -1;
              const normIdx = indices[2] ? parseInt(indices[2]) - 1 : -1;

              // Handle negative indices (relative to current position)
              const actualPosIdx =
                posIdx < 0 ? positions.length + posIdx + 1 : posIdx;
              const actualTexIdx =
                texIdx < 0 ? texCoords.length + texIdx + 1 : texIdx;
              const actualNormIdx =
                normIdx < 0 ? normals.length + normIdx + 1 : normIdx;

              // Create vertex
              const position = positions[actualPosIdx] || Vector3.zero();
              const uv =
                actualTexIdx >= 0 && texCoords[actualTexIdx]
                  ? texCoords[actualTexIdx]
                  : [0, 0];
              const normal =
                actualNormIdx >= 0 && normals[actualNormIdx]
                  ? normals[actualNormIdx]
                  : Vector3.zero();

              const vertex = new Vertex(
                position.clone(),
                defaultColor.clone(),
                normal.clone(),
                uv[0],
                uv[1]
              );

              const vertexIndex = group.vertices.length;
              group.vertices.push(vertex);
              vertexCache.set(cacheKey, vertexIndex);
              faceVertices.push(vertexIndex);
            }
          }

          // Store face data (BMesh-style - preserves quads/n-gons)
          group.faceData.push({ vertices: [...faceVertices] });

          // Triangulate face (fan triangulation for convex polygons)
          for (let i = 1; i < faceVertices.length - 1; i++) {
            group.indices.push(faceVertices[0]);
            group.indices.push(faceVertices[i]);
            group.indices.push(faceVertices[i + 1]);
          }
          break;

        case "s": // Smoothing group (not implemented)
          // Silently ignore
          break;

        default:
          // Unknown command, skip
          break;
      }
    }

    // Create meshes from groups
    const meshes = new Map<string, Mesh>();
    let defaultMesh: Mesh | null = null;

    for (const [name, data] of groups) {
      if (data.vertices.length > 0 && data.indices.length > 0) {
        const mesh = new Mesh(data.vertices, data.indices);

        // Set faceData from OBJ (preserves quads/n-gons)
        mesh.faceData = data.faceData;

        // Calculate normals if not provided
        OBJLoader.calculateNormalsIfMissing(mesh);

        meshes.set(name, mesh);
        if (!defaultMesh) {
          defaultMesh = mesh;
        }
      }
    }

    // If no meshes were created, return an empty mesh
    if (!defaultMesh) {
      defaultMesh = new Mesh([], []);
    }

    return {
      meshes,
      defaultMesh,
      materials: new Map(),
      defaultTexture: null,
      mtlFile,
    };
  }

  /**
   * Calculate vertex normals if they are all zero (not provided in OBJ)
   */
  private static calculateNormalsIfMissing(mesh: Mesh): void {
    // Check if normals are missing
    let hasNormals = false;
    for (const vertex of mesh.vertices) {
      if (vertex.normal.lengthSquared() > 0.001) {
        hasNormals = true;
        break;
      }
    }

    if (hasNormals) return;

    // Calculate face normals and accumulate for smooth shading
    const normalAccum: Vector3[] = mesh.vertices.map(() => Vector3.zero());

    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];

      const v0 = mesh.vertices[i0].position;
      const v1 = mesh.vertices[i1].position;
      const v2 = mesh.vertices[i2].position;

      const edge1 = v1.sub(v0);
      const edge2 = v2.sub(v0);
      const faceNormal = edge1.cross(edge2);

      // Accumulate (weighted by face area, which is proportional to cross product magnitude)
      normalAccum[i0] = normalAccum[i0].add(faceNormal);
      normalAccum[i1] = normalAccum[i1].add(faceNormal);
      normalAccum[i2] = normalAccum[i2].add(faceNormal);
    }

    // Normalize and assign
    for (let i = 0; i < mesh.vertices.length; i++) {
      const normal = normalAccum[i].normalize();
      mesh.vertices[i].normal = normal;
    }

    // Rebuild triangles with updated normals
    mesh.rebuildTriangles();
  }

  /**
   * Load OBJ file from URL, including MTL and textures
   */
  static async load(
    url: string,
    defaultColor: Color = Color.white()
  ): Promise<OBJLoadResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load OBJ file: ${response.statusText}`);
    }
    const content = await response.text();
    const result = OBJLoader.parse(content, defaultColor);

    // Load MTL file if specified
    if (result.mtlFile) {
      try {
        // Get base URL for relative paths
        const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
        const mtlUrl = baseUrl + result.mtlFile;

        const materials = await MTLLoader.load(mtlUrl, baseUrl);
        result.materials = materials;

        // Get the first texture as default
        for (const material of materials.values()) {
          if (material.diffuseTexture) {
            result.defaultTexture = material.diffuseTexture;
            break;
          }
        }
      } catch (e) {
        console.warn(`Failed to load MTL file: ${e}`);
      }
    }

    return result;
  }

  /**
   * Assign random colors to mesh vertices based on face
   */
  static assignRandomFaceColors(mesh: Mesh): void {
    for (const triangle of mesh.triangles) {
      const color = new Color(
        Math.floor(Math.random() * 200) + 55,
        Math.floor(Math.random() * 200) + 55,
        Math.floor(Math.random() * 200) + 55
      );
      triangle.v0.color = color.clone();
      triangle.v1.color = color.clone();
      triangle.v2.color = color.clone();
    }
  }

  /**
   * Assign gradient colors based on vertex Y position
   */
  static assignHeightGradient(mesh: Mesh, colorA: Color, colorB: Color): void {
    // Find Y bounds
    let minY = Infinity;
    let maxY = -Infinity;
    for (const vertex of mesh.vertices) {
      minY = Math.min(minY, vertex.position.y);
      maxY = Math.max(maxY, vertex.position.y);
    }

    const range = maxY - minY || 1;

    for (const triangle of mesh.triangles) {
      for (const v of [triangle.v0, triangle.v1, triangle.v2]) {
        const t = (v.position.y - minY) / range;
        v.color = colorA.lerp(colorB, t);
      }
    }
  }
}
