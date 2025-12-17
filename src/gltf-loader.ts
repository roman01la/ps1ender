/**
 * GLTF/GLB Loader
 *
 * Supports:
 * - GLTF 2.0 (.gltf) and GLB binary (.glb) formats
 * - Embedded textures (base64 and GLB binary buffer)
 * - External textures (relative URLs)
 * - Multiple meshes and primitives
 * - Materials: baseColorFactor → vertex tint, baseColorTexture → diffuse (PS1-style)
 * - Vertex positions, normals, UVs, and colors
 * - Scene hierarchy with parent-child relationships
 * - Node transforms (translation, rotation, scale)
 * - Accessor types: SCALAR, VEC2, VEC3, VEC4
 * - Component types: BYTE, UNSIGNED_BYTE, SHORT, UNSIGNED_SHORT, UNSIGNED_INT, FLOAT
 */

import { Vector3, Color, Matrix4 } from "./math";
import { Vertex, Mesh, Face } from "./primitives";
import { Texture } from "./texture";
import { SceneObject } from "./scene";

// ============================================================================
// GLTF Types (subset of spec)
// ============================================================================

interface GLTFAsset {
  version: string;
  generator?: string;
  copyright?: string;
}

interface GLTFBuffer {
  uri?: string;
  byteLength: number;
}

interface GLTFBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

interface GLTFAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4";
  max?: number[];
  min?: number[];
}

interface GLTFImage {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
  name?: string;
}

interface GLTFSampler {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
}

interface GLTFTexture {
  sampler?: number;
  source?: number;
  name?: string;
}

interface GLTFTextureInfo {
  index: number;
  texCoord?: number;
}

interface GLTFPBRMetallicRoughness {
  baseColorFactor?: [number, number, number, number];
  baseColorTexture?: GLTFTextureInfo;
  metallicFactor?: number;
  roughnessFactor?: number;
  metallicRoughnessTexture?: GLTFTextureInfo;
}

interface GLTFMaterial {
  name?: string;
  pbrMetallicRoughness?: GLTFPBRMetallicRoughness;
  normalTexture?: GLTFTextureInfo & { scale?: number };
  occlusionTexture?: GLTFTextureInfo & { strength?: number };
  emissiveTexture?: GLTFTextureInfo;
  emissiveFactor?: [number, number, number];
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  doubleSided?: boolean;
}

interface GLTFPrimitive {
  attributes: {
    POSITION?: number;
    NORMAL?: number;
    TEXCOORD_0?: number;
    TEXCOORD_1?: number;
    COLOR_0?: number;
    JOINTS_0?: number;
    WEIGHTS_0?: number;
  };
  indices?: number;
  material?: number;
  mode?: number; // 0=POINTS, 1=LINES, 2=LINE_LOOP, 3=LINE_STRIP, 4=TRIANGLES, 5=TRIANGLE_STRIP, 6=TRIANGLE_FAN
}

interface GLTFMesh {
  name?: string;
  primitives: GLTFPrimitive[];
}

interface GLTFNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number]; // quaternion
  scale?: [number, number, number];
  matrix?: number[]; // 4x4 column-major matrix
}

interface GLTFScene {
  name?: string;
  nodes?: number[];
}

interface GLTFJSON {
  asset: GLTFAsset;
  scene?: number;
  scenes?: GLTFScene[];
  nodes?: GLTFNode[];
  meshes?: GLTFMesh[];
  accessors?: GLTFAccessor[];
  bufferViews?: GLTFBufferView[];
  buffers?: GLTFBuffer[];
  materials?: GLTFMaterial[];
  textures?: GLTFTexture[];
  images?: GLTFImage[];
  samplers?: GLTFSampler[];
}

// Component type sizes
const COMPONENT_TYPE_SIZE: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

// Type component counts
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

// ============================================================================
// Load Result
// ============================================================================

export interface GLTFMaterialData {
  name: string;
  baseColor: Color;
  texture: Texture | null;
  textureName: string | null;
  metallic: number;
  roughness: number;
  doubleSided: boolean;
}

export interface GLTFLoadResult {
  meshes: Map<string, Mesh>;
  defaultMesh: Mesh;
  materials: Map<string, GLTFMaterialData>;
  textures: Map<number, Texture>;
  /** Maps mesh name to material name */
  meshMaterials: Map<string, string>;
  /** Scene objects with hierarchy preserved */
  sceneObjects: SceneObject[];
  /** Root objects (no parent) */
  rootObjects: SceneObject[];
}

// ============================================================================
// GLTF Loader Class
// ============================================================================

export class GLTFLoader {
  private json: GLTFJSON;
  private buffers: ArrayBuffer[] = [];
  private baseUrl: string = "";

  private constructor(json: GLTFJSON) {
    this.json = json;
  }

  /**
   * Load GLTF or GLB from URL
   */
  static async load(url: string): Promise<GLTFLoadResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load GLTF: ${response.statusText}`);
    }

    // Determine base URL for external resources
    const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);

    // Always fetch as ArrayBuffer first to check magic bytes
    const arrayBuffer = await response.arrayBuffer();

    // Check for GLB magic number "glTF" (0x46546C67 in little-endian)
    const magic = new Uint32Array(arrayBuffer, 0, 1)[0];
    const isGLB = magic === 0x46546c67;

    if (isGLB) {
      return GLTFLoader.parseGLB(arrayBuffer, baseUrl);
    } else {
      // Decode ArrayBuffer as UTF-8 text for JSON parsing
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(arrayBuffer);
      const json = JSON.parse(text) as GLTFJSON;
      const loader = new GLTFLoader(json);
      loader.baseUrl = baseUrl;
      return loader.parse();
    }
  }

  /**
   * Load from ArrayBuffer (for GLB or pre-fetched data)
   */
  static async loadFromArrayBuffer(
    data: ArrayBuffer,
    baseUrl: string = ""
  ): Promise<GLTFLoadResult> {
    // Check magic number for GLB
    const magic = new Uint32Array(data, 0, 1)[0];
    if (magic === 0x46546c67) {
      // "glTF" in little-endian
      return GLTFLoader.parseGLB(data, baseUrl);
    } else {
      // Assume JSON
      const decoder = new TextDecoder();
      const json = JSON.parse(decoder.decode(data)) as GLTFJSON;
      const loader = new GLTFLoader(json);
      loader.baseUrl = baseUrl;
      return loader.parse();
    }
  }

  /**
   * Parse GLB binary format
   */
  private static async parseGLB(
    data: ArrayBuffer,
    baseUrl: string
  ): Promise<GLTFLoadResult> {
    const dataView = new DataView(data);

    // GLB Header (12 bytes)
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546c67) {
      throw new Error("Invalid GLB magic number");
    }

    const version = dataView.getUint32(4, true);
    if (version !== 2) {
      throw new Error(`Unsupported GLB version: ${version}`);
    }

    const length = dataView.getUint32(8, true);
    if (length > data.byteLength) {
      throw new Error("GLB length exceeds buffer size");
    }

    // Parse chunks
    let offset = 12;
    let json: GLTFJSON | null = null;
    let binaryBuffer: ArrayBuffer | null = null;

    while (offset < length) {
      const chunkLength = dataView.getUint32(offset, true);
      const chunkType = dataView.getUint32(offset + 4, true);
      const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);

      if (chunkType === 0x4e4f534a) {
        // "JSON"
        const decoder = new TextDecoder();
        json = JSON.parse(decoder.decode(chunkData));
      } else if (chunkType === 0x004e4942) {
        // "BIN\0"
        binaryBuffer = chunkData;
      }

      offset += 8 + chunkLength;
      // Align to 4-byte boundary
      offset = (offset + 3) & ~3;
    }

    if (!json) {
      throw new Error("GLB missing JSON chunk");
    }

    const loader = new GLTFLoader(json);
    loader.baseUrl = baseUrl;

    // Store binary buffer as first buffer
    if (binaryBuffer) {
      loader.buffers[0] = binaryBuffer;
    }

    return loader.parse();
  }

  /**
   * Main parse method
   */
  private async parse(): Promise<GLTFLoadResult> {
    // Load all buffers
    await this.loadBuffers();

    // Load textures
    const { textures, textureNames } = await this.loadTextures();

    // Parse materials
    const materials = this.parseMaterials(textures, textureNames);

    // Parse meshes
    const { meshes, meshMaterials } = this.parseMeshes(materials);

    // Build scene hierarchy
    const { sceneObjects, rootObjects } = this.buildSceneHierarchy(
      meshes,
      meshMaterials,
      materials
    );

    // Get default mesh
    let defaultMesh: Mesh = new Mesh([], []);
    if (meshes.size > 0) {
      defaultMesh = meshes.values().next().value!;
    }

    return {
      meshes,
      defaultMesh,
      materials,
      textures,
      meshMaterials,
      sceneObjects,
      rootObjects,
    };
  }

  /**
   * Build scene hierarchy from GLTF nodes
   */
  private buildSceneHierarchy(
    meshes: Map<string, Mesh>,
    meshMaterials: Map<string, string>,
    materials: Map<string, GLTFMaterialData>
  ): { sceneObjects: SceneObject[]; rootObjects: SceneObject[] } {
    const sceneObjects: SceneObject[] = [];
    const nodeToObject = new Map<number, SceneObject>();
    const gltfNodes = this.json.nodes || [];
    const gltfMeshes = this.json.meshes || [];

    // First pass: create all scene objects
    for (let i = 0; i < gltfNodes.length; i++) {
      const node = gltfNodes[i];
      const nodeName = node.name || `Node_${i}`;

      // Get mesh if this node has one
      let mesh: Mesh | null = null;
      let materialName: string | null = null;

      if (node.mesh !== undefined) {
        const gltfMesh = gltfMeshes[node.mesh];
        const meshName = gltfMesh?.name || `Mesh_${node.mesh}`;
        mesh = meshes.get(meshName) || null;
        materialName = meshMaterials.get(meshName) || null;
      }

      // Create scene object (with empty mesh if node has no mesh)
      const objMesh = mesh || new Mesh([], []);
      const obj = new SceneObject(nodeName, objMesh);

      // Apply node transform
      this.applyNodeTransform(obj, node);

      // Store mapping
      nodeToObject.set(i, obj);
      sceneObjects.push(obj);
    }

    // Second pass: set up parent-child relationships
    for (let i = 0; i < gltfNodes.length; i++) {
      const node = gltfNodes[i];
      const parentObj = nodeToObject.get(i)!;

      if (node.children) {
        for (const childIndex of node.children) {
          const childObj = nodeToObject.get(childIndex);
          if (childObj) {
            childObj.parent = parentObj;
          }
        }
      }
    }

    // Find root objects (no parent)
    const rootObjects = sceneObjects.filter((obj) => obj.parent === null);

    // If scene specifies root nodes, use those
    const defaultScene = this.json.scene ?? 0;
    const scenes = this.json.scenes || [];
    if (scenes[defaultScene]?.nodes) {
      const sceneRootIndices = scenes[defaultScene].nodes!;
      const sceneRoots = sceneRootIndices
        .map((i) => nodeToObject.get(i))
        .filter((obj): obj is SceneObject => obj !== undefined);
      if (sceneRoots.length > 0) {
        return { sceneObjects, rootObjects: sceneRoots };
      }
    }

    return { sceneObjects, rootObjects };
  }

  /**
   * Apply GLTF node transform to SceneObject
   */
  private applyNodeTransform(obj: SceneObject, node: GLTFNode): void {
    // Handle matrix transform
    if (node.matrix) {
      // GLTF matrix is column-major, decompose to TRS
      const m = node.matrix;
      // Extract translation (last column)
      // Convert Y-up to Z-up: X stays X, Y becomes Z, Z becomes -Y
      obj.position = new Vector3(m[12], -m[14], m[13]);

      // Extract scale from matrix columns
      const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
      const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
      const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
      obj.scale = new Vector3(sx, sz, sy); // Swap Y/Z for coordinate conversion

      // Extract rotation (simplified - assumes no shear)
      // This is approximate; full quaternion decomposition would be better
      const rotY = Math.atan2(m[8] / sz, m[0] / sx);
      const rotX = Math.atan2(-m[6] / sy, m[5] / sy);
      const rotZ = Math.atan2(m[1] / sx, m[0] / sx);
      obj.rotation = new Vector3(rotX, rotZ, rotY);
    } else {
      // Handle TRS transform
      if (node.translation) {
        // Convert Y-up to Z-up
        obj.position = new Vector3(
          node.translation[0],
          -node.translation[2],
          node.translation[1]
        );
      }

      if (node.scale) {
        // Swap Y/Z for coordinate conversion
        obj.scale = new Vector3(node.scale[0], node.scale[2], node.scale[1]);
      }

      if (node.rotation) {
        // Convert quaternion to Euler angles
        // GLTF quaternion is [x, y, z, w]
        const euler = this.quaternionToEuler(node.rotation);
        // Convert Y-up to Z-up rotation
        obj.rotation = new Vector3(euler.x, -euler.z, euler.y);
      }
    }
  }

  /**
   * Convert quaternion [x, y, z, w] to Euler angles (radians)
   */
  private quaternionToEuler(q: [number, number, number, number]): Vector3 {
    const [x, y, z, w] = q;

    // Roll (X)
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    // Pitch (Y)
    const sinp = 2 * (w * y - z * x);
    let pitch: number;
    if (Math.abs(sinp) >= 1) {
      pitch = (Math.PI / 2) * Math.sign(sinp); // Gimbal lock
    } else {
      pitch = Math.asin(sinp);
    }

    // Yaw (Z)
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return new Vector3(roll, pitch, yaw);
  }

  /**
   * Load all buffer data
   */
  private async loadBuffers(): Promise<void> {
    const buffers = this.json.buffers || [];

    for (let i = 0; i < buffers.length; i++) {
      // Skip if already loaded (e.g., GLB binary chunk)
      if (this.buffers[i]) continue;

      const buffer = buffers[i];
      if (buffer.uri) {
        const data = await this.loadBufferURI(buffer.uri);
        this.buffers[i] = data;
      }
    }
  }

  /**
   * Load buffer from URI (base64 or URL)
   */
  private async loadBufferURI(uri: string): Promise<ArrayBuffer> {
    // Check for base64 data URI
    if (uri.startsWith("data:")) {
      const base64Match = uri.match(/^data:[^;]*;base64,(.*)$/);
      if (base64Match) {
        return this.base64ToArrayBuffer(base64Match[1]);
      }
      throw new Error("Unsupported data URI format");
    }

    // Load from URL
    const url = this.baseUrl + uri;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load buffer: ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  /**
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    // Handle both browser and Node.js environments
    if (typeof atob === "function") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    } else {
      // Node.js
      const buffer = Buffer.from(base64, "base64");
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    }
  }

  /**
   * Load all textures
   */
  private async loadTextures(): Promise<{
    textures: Map<number, Texture>;
    textureNames: Map<number, string>;
  }> {
    const textures = new Map<number, Texture>();
    const textureNames = new Map<number, string>();
    const images = this.json.images || [];
    const gltfTextures = this.json.textures || [];

    for (let i = 0; i < gltfTextures.length; i++) {
      const gltfTex = gltfTextures[i];
      if (gltfTex.source === undefined) continue;

      const image = images[gltfTex.source];
      if (!image) continue;

      // Determine texture name from: texture name > image name > uri filename > fallback
      let texName = gltfTex.name || image.name;
      if (!texName && image.uri && !image.uri.startsWith("data:")) {
        // Extract filename from URI
        const parts = image.uri.split("/");
        texName = parts[parts.length - 1].replace(/\.[^.]+$/, ""); // Remove extension
      }
      if (!texName) {
        texName = `Texture_${i}`;
      }
      textureNames.set(i, texName);

      try {
        const texture = await this.loadImage(image);
        textures.set(i, texture);
      } catch (e) {
        console.warn(`Failed to load texture ${i}:`, e);
        // Create placeholder texture
        textures.set(i, this.createPlaceholderTexture());
      }
    }

    return { textures, textureNames };
  }

  /**
   * Load image from GLTF image definition
   */
  private async loadImage(image: GLTFImage): Promise<Texture> {
    // Image from buffer view (embedded in GLB)
    if (image.bufferView !== undefined) {
      const data = this.getBufferViewData(image.bufferView);
      return this.loadTextureFromBuffer(data, image.mimeType || "image/png");
    }

    // Image from URI
    if (image.uri) {
      // Check for base64 data URI
      if (image.uri.startsWith("data:")) {
        const match = image.uri.match(/^data:([^;]*);base64,(.*)$/);
        if (match) {
          const mimeType = match[1];
          const base64Data = match[2];
          const buffer = this.base64ToArrayBuffer(base64Data);
          return this.loadTextureFromBuffer(
            new Uint8Array(buffer),
            mimeType || "image/png"
          );
        }
      }

      // Load from URL
      const url = this.baseUrl + image.uri;
      return Texture.load(url);
    }

    throw new Error("Image has no valid source");
  }

  /**
   * Load texture from raw buffer data
   */
  private async loadTextureFromBuffer(
    data: Uint8Array,
    mimeType: string
  ): Promise<Texture> {
    // Create blob and object URL - copy to ensure ArrayBuffer
    const copy = new Uint8Array(data);
    const blob = new Blob([copy], { type: mimeType });
    const url = URL.createObjectURL(blob);

    try {
      const texture = await Texture.load(url);
      return texture;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Create placeholder texture for missing images
   */
  private createPlaceholderTexture(): Texture {
    const texture = new Texture(2, 2);
    texture.setPixel(0, 0, new Color(255, 0, 255)); // Magenta
    texture.setPixel(1, 0, new Color(0, 0, 0));
    texture.setPixel(0, 1, new Color(0, 0, 0));
    texture.setPixel(1, 1, new Color(255, 0, 255));
    return texture;
  }

  /**
   * Get raw data from a buffer view
   */
  private getBufferViewData(bufferViewIndex: number): Uint8Array {
    const bufferViews = this.json.bufferViews || [];
    const bufferView = bufferViews[bufferViewIndex];
    if (!bufferView) {
      throw new Error(`Buffer view ${bufferViewIndex} not found`);
    }

    const buffer = this.buffers[bufferView.buffer];
    if (!buffer) {
      throw new Error(`Buffer ${bufferView.buffer} not loaded`);
    }

    const byteOffset = bufferView.byteOffset || 0;
    return new Uint8Array(buffer, byteOffset, bufferView.byteLength);
  }

  /**
   * Parse materials
   */
  private parseMaterials(
    textures: Map<number, Texture>,
    textureNames: Map<number, string>
  ): Map<string, GLTFMaterialData> {
    const materials = new Map<string, GLTFMaterialData>();
    const gltfMaterials = this.json.materials || [];

    for (let i = 0; i < gltfMaterials.length; i++) {
      const gltfMat = gltfMaterials[i];
      const name = gltfMat.name || `Material_${i}`;

      const pbr = gltfMat.pbrMetallicRoughness || {};

      // Base color (default white)
      const baseColorFactor = pbr.baseColorFactor || [1, 1, 1, 1];
      const baseColor = new Color(
        Math.floor(baseColorFactor[0] * 255),
        Math.floor(baseColorFactor[1] * 255),
        Math.floor(baseColorFactor[2] * 255),
        Math.floor(baseColorFactor[3] * 255)
      );

      // Base color texture
      let texture: Texture | null = null;
      let textureName: string | null = null;
      if (pbr.baseColorTexture) {
        texture = textures.get(pbr.baseColorTexture.index) || null;
        textureName = textureNames.get(pbr.baseColorTexture.index) || null;
      }

      materials.set(name, {
        name,
        baseColor,
        texture,
        textureName,
        metallic: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        doubleSided: gltfMat.doubleSided ?? false,
      });
    }

    // Add default material if none defined
    if (materials.size === 0) {
      materials.set("Default", {
        name: "Default",
        baseColor: Color.white(),
        texture: null,
        textureName: null,
        metallic: 0,
        roughness: 1,
        doubleSided: false,
      });
    }

    return materials;
  }

  /**
   * Parse all meshes
   */
  private parseMeshes(materials: Map<string, GLTFMaterialData>): {
    meshes: Map<string, Mesh>;
    meshMaterials: Map<string, string>;
  } {
    const meshes = new Map<string, Mesh>();
    const meshMaterials = new Map<string, string>();
    const gltfMeshes = this.json.meshes || [];
    const gltfMaterials = this.json.materials || [];

    for (let i = 0; i < gltfMeshes.length; i++) {
      const gltfMesh = gltfMeshes[i];
      const meshName = gltfMesh.name || `Mesh_${i}`;

      // Combine all primitives into one mesh
      // (PS1ender doesn't support sub-meshes)
      const allVertices: Vertex[] = [];
      const allIndices: number[] = [];
      const allFaces: Face[] = [];
      let primaryMaterial: string | null = null;

      for (const primitive of gltfMesh.primitives) {
        const baseVertexIndex = allVertices.length;

        // Parse primitive
        const { vertices, indices, faces } = this.parsePrimitive(primitive);

        // Offset indices
        for (const index of indices) {
          allIndices.push(index + baseVertexIndex);
        }

        // Offset face indices
        for (const face of faces) {
          allFaces.push({
            vertices: face.vertices.map((v) => v + baseVertexIndex),
          });
        }

        allVertices.push(...vertices);

        // Track material
        if (primitive.material !== undefined && !primaryMaterial) {
          const matDef = gltfMaterials[primitive.material];
          primaryMaterial = matDef?.name || `Material_${primitive.material}`;
        }
      }

      if (allVertices.length > 0) {
        const mesh = new Mesh(allVertices, allIndices);
        mesh.faceData = allFaces;

        // Calculate normals if not provided
        this.calculateNormalsIfMissing(mesh);

        meshes.set(meshName, mesh);

        if (primaryMaterial) {
          meshMaterials.set(meshName, primaryMaterial);
        }
      }
    }

    return { meshes, meshMaterials };
  }

  /**
   * Parse a single primitive
   */
  private parsePrimitive(primitive: GLTFPrimitive): {
    vertices: Vertex[];
    indices: number[];
    faces: Face[];
  } {
    const vertices: Vertex[] = [];
    const indices: number[] = [];
    const faces: Face[] = [];

    // Get attribute data
    const positions =
      primitive.attributes.POSITION !== undefined
        ? this.getAccessorData(primitive.attributes.POSITION)
        : null;
    const normals =
      primitive.attributes.NORMAL !== undefined
        ? this.getAccessorData(primitive.attributes.NORMAL)
        : null;
    const texCoords =
      primitive.attributes.TEXCOORD_0 !== undefined
        ? this.getAccessorData(primitive.attributes.TEXCOORD_0)
        : null;
    const colors =
      primitive.attributes.COLOR_0 !== undefined
        ? this.getAccessorData(primitive.attributes.COLOR_0)
        : null;

    if (!positions) {
      return { vertices, indices, faces };
    }

    // Get position accessor for count
    const posAccessor = this.json.accessors![primitive.attributes.POSITION!];
    const vertexCount = posAccessor.count;

    // Create vertices
    for (let i = 0; i < vertexCount; i++) {
      // Position (GLTF is right-handed Y-up, PS1ender is Z-up)
      // Convert: X stays X, Y becomes Z, Z becomes -Y
      const px = positions[i * 3 + 0];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const position = new Vector3(px, -pz, py);

      // Normal (same conversion)
      let normal = Vector3.zero();
      if (normals) {
        const nx = normals[i * 3 + 0];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        normal = new Vector3(nx, -nz, ny);
      }

      // UV (GLTF has V=0 at top, flip to V=0 at bottom)
      let u = 0,
        v = 0;
      if (texCoords) {
        u = texCoords[i * 2 + 0];
        v = 1.0 - texCoords[i * 2 + 1]; // Flip V coordinate
      }

      // Color
      let color = Color.white();
      if (colors) {
        const colorAccessor =
          this.json.accessors![primitive.attributes.COLOR_0!];
        const components = TYPE_COMPONENTS[colorAccessor.type] || 3;
        const normalized = colorAccessor.normalized ?? false;
        const componentType = colorAccessor.componentType;

        let r = colors[i * components + 0];
        let g = colors[i * components + 1];
        let b = colors[i * components + 2];
        let a = components >= 4 ? colors[i * components + 3] : 1;

        // Normalize if needed
        if (!normalized && componentType !== 5126) {
          // Not FLOAT
          const maxVal =
            componentType === 5121 ? 255 : componentType === 5123 ? 65535 : 1;
          r /= maxVal;
          g /= maxVal;
          b /= maxVal;
          a /= maxVal;
        }

        color = new Color(
          Math.floor(r * 255),
          Math.floor(g * 255),
          Math.floor(b * 255),
          Math.floor(a * 255)
        );
      }

      vertices.push(new Vertex(position, color, normal, u, v));
    }

    // Get indices
    const mode = primitive.mode ?? 4; // Default to TRIANGLES

    if (primitive.indices !== undefined) {
      const indexData = this.getAccessorData(primitive.indices);
      const indexAccessor = this.json.accessors![primitive.indices];

      // Process based on primitive mode
      if (mode === 4) {
        // TRIANGLES
        for (let i = 0; i < indexAccessor.count; i++) {
          indices.push(indexData[i]);
        }
        // Create faces (triangles)
        for (let i = 0; i < indexAccessor.count; i += 3) {
          faces.push({
            vertices: [indexData[i], indexData[i + 1], indexData[i + 2]],
          });
        }
      } else if (mode === 5) {
        // TRIANGLE_STRIP
        for (let i = 0; i < indexAccessor.count - 2; i++) {
          if (i % 2 === 0) {
            indices.push(indexData[i], indexData[i + 1], indexData[i + 2]);
            faces.push({
              vertices: [indexData[i], indexData[i + 1], indexData[i + 2]],
            });
          } else {
            indices.push(indexData[i], indexData[i + 2], indexData[i + 1]);
            faces.push({
              vertices: [indexData[i], indexData[i + 2], indexData[i + 1]],
            });
          }
        }
      } else if (mode === 6) {
        // TRIANGLE_FAN
        for (let i = 1; i < indexAccessor.count - 1; i++) {
          indices.push(indexData[0], indexData[i], indexData[i + 1]);
          faces.push({
            vertices: [indexData[0], indexData[i], indexData[i + 1]],
          });
        }
      }
    } else {
      // Non-indexed geometry
      if (mode === 4) {
        // TRIANGLES
        for (let i = 0; i < vertexCount; i++) {
          indices.push(i);
        }
        for (let i = 0; i < vertexCount; i += 3) {
          faces.push({
            vertices: [i, i + 1, i + 2],
          });
        }
      } else if (mode === 5) {
        // TRIANGLE_STRIP
        for (let i = 0; i < vertexCount - 2; i++) {
          if (i % 2 === 0) {
            indices.push(i, i + 1, i + 2);
            faces.push({ vertices: [i, i + 1, i + 2] });
          } else {
            indices.push(i, i + 2, i + 1);
            faces.push({ vertices: [i, i + 2, i + 1] });
          }
        }
      } else if (mode === 6) {
        // TRIANGLE_FAN
        for (let i = 1; i < vertexCount - 1; i++) {
          indices.push(0, i, i + 1);
          faces.push({ vertices: [0, i, i + 1] });
        }
      }
    }

    return { vertices, indices, faces };
  }

  /**
   * Get accessor data as Float32Array
   */
  private getAccessorData(accessorIndex: number): Float32Array {
    const accessors = this.json.accessors || [];
    const accessor = accessors[accessorIndex];
    if (!accessor) {
      throw new Error(`Accessor ${accessorIndex} not found`);
    }

    // Handle sparse accessors (not implemented)
    if ((accessor as any).sparse) {
      console.warn("Sparse accessors not supported");
    }

    // Get buffer view
    if (accessor.bufferView === undefined) {
      // Accessor with no buffer view - return zeros
      const count = accessor.count * (TYPE_COMPONENTS[accessor.type] || 1);
      return new Float32Array(count);
    }

    const bufferViews = this.json.bufferViews || [];
    const bufferView = bufferViews[accessor.bufferView];
    if (!bufferView) {
      throw new Error(`Buffer view ${accessor.bufferView} not found`);
    }

    const buffer = this.buffers[bufferView.buffer];
    if (!buffer) {
      throw new Error(`Buffer ${bufferView.buffer} not loaded`);
    }

    // Calculate offsets
    const byteOffset =
      (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const componentSize = COMPONENT_TYPE_SIZE[accessor.componentType] || 4;
    const componentCount = TYPE_COMPONENTS[accessor.type] || 1;
    const byteStride = bufferView.byteStride || componentSize * componentCount;
    const elementCount = accessor.count * componentCount;

    // Create result array
    const result = new Float32Array(elementCount);

    // Read data based on component type
    const dataView = new DataView(buffer);

    for (let i = 0; i < accessor.count; i++) {
      const elementOffset = byteOffset + i * byteStride;

      for (let j = 0; j < componentCount; j++) {
        const offset = elementOffset + j * componentSize;
        let value: number;

        switch (accessor.componentType) {
          case 5120: // BYTE
            value = dataView.getInt8(offset);
            if (accessor.normalized) value /= 127;
            break;
          case 5121: // UNSIGNED_BYTE
            value = dataView.getUint8(offset);
            if (accessor.normalized) value /= 255;
            break;
          case 5122: // SHORT
            value = dataView.getInt16(offset, true);
            if (accessor.normalized) value /= 32767;
            break;
          case 5123: // UNSIGNED_SHORT
            value = dataView.getUint16(offset, true);
            if (accessor.normalized) value /= 65535;
            break;
          case 5125: // UNSIGNED_INT
            value = dataView.getUint32(offset, true);
            break;
          case 5126: // FLOAT
            value = dataView.getFloat32(offset, true);
            break;
          default:
            value = 0;
        }

        result[i * componentCount + j] = value;
      }
    }

    return result;
  }

  /**
   * Calculate vertex normals if missing
   */
  private calculateNormalsIfMissing(mesh: Mesh): void {
    // Check if normals are missing
    let hasNormals = false;
    for (const vertex of mesh.vertices) {
      if (vertex.normal.lengthSquared() > 0.001) {
        hasNormals = true;
        break;
      }
    }

    if (hasNormals) return;

    // PS1-style flat shading
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];

      const v0 = mesh.vertices[i0].position;
      const v1 = mesh.vertices[i1].position;
      const v2 = mesh.vertices[i2].position;

      const edge1 = v1.sub(v0);
      const edge2 = v2.sub(v0);
      const faceNormal = edge1.cross(edge2).normalize();

      mesh.vertices[i0].normal = faceNormal;
      mesh.vertices[i1].normal = faceNormal;
      mesh.vertices[i2].normal = faceNormal;
    }

    mesh.rebuildTriangles();
  }
}
