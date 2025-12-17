/**
 * Render Loop System (Worker Version) - Builds render frames for the worker
 *
 * This system provides:
 * - Frame data serialization for worker transfer
 * - Scene/editor state to RenderFrame conversion
 * - Overlay data generation (gizmo, vertices, edges, faces)
 */

import { Matrix4, Color, Vector3 } from "../math";
import { Vertex, Mesh } from "../primitives";
import { Scene, SceneObject } from "../scene";
import { Editor, ViewMode } from "../editor";
import { RendererSettings } from "./ui-state";
import {
  RenderFrame,
  RenderSettings,
  RenderLines,
  RenderPoints,
  RenderTransparentTris,
  SerializedMesh,
  MaterialBakeRequest,
  TextureUpload,
} from "../render-worker";
import { Texture } from "../texture";
import {
  Material,
  evaluateMaterial,
  materialUsesTexture,
  materialNeedsBaking,
  compileMaterialForWorker,
  TextureSampler,
  RGBA,
} from "../material";

// Track which textures have been sent to the worker (by texture hash)
const sentTextureIds = new Set<string>();

/**
 * Clear the texture cache (call when loading new models or clearing scene)
 */
export function clearTextureCache(): void {
  sentTextureIds.clear();
}

/**
 * Create a simple hash of material state for cache invalidation
 * Note: Node order shouldn't affect the hash (just for z-ordering)
 */
function hashMaterial(material: Material): string {
  // Include node data and connections in hash, sorted by ID for order-independence
  const nodeData = material.nodes
    .map((n) => ({
      id: n.id,
      type: n.type,
      data: n.data,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const connections = material.connections
    .map((c) => ({
      from: `${c.fromNodeId}:${c.fromSocketId}`,
      to: `${c.toNodeId}:${c.toSocketId}`,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return JSON.stringify({ nodes: nodeData, connections });
}

/**
 * Create a simple hash of texture for cache invalidation
 */
function hashTexture(texture: Texture | null): string {
  if (!texture) return "none";
  // Use size and a sample of pixels as hash (full data would be too slow)
  const data = texture.getData();
  const sample = [
    data[0],
    data[1],
    data[2],
    data[data.length - 3],
    data[data.length - 2],
    data[data.length - 1],
  ];
  return `${texture.width}x${texture.height}:${sample.join(",")}`;
}

/**
 * Grid data for rendering
 */
export interface GridData {
  vertices: Vertex[];
  lineIndices: number[];
}

/**
 * Render context for building frames
 */
export interface WorkerRenderContext {
  scene: Scene;
  editor: Editor;
  gridData: GridData | null;
  settings: RendererSettings;
  renderWidth: number;
  renderHeight: number;
  currentTexture: Texture | null;
}

// ============================================================================
// Serialization Helpers
// ============================================================================

function serializeMatrix(m: Matrix4): Float32Array {
  return new Float32Array(m.data);
}

function serializeMesh(
  mesh: Mesh,
  material?: Material,
  textureSampler?: TextureSampler,
  useWhiteColors: boolean = false
): SerializedMesh {
  const vertexCount = mesh.vertices.length;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Uint8Array(vertexCount * 4);

  // Pre-evaluate material if provided (for flat color, we only need one evaluation)
  // Skip if using white colors (for baked/textured rendering)
  let materialColor: RGBA | null = null;
  if (material && !useWhiteColors) {
    // Evaluate at UV 0,0 with texture sampler context
    materialColor = evaluateMaterial(material, {
      u: 0,
      v: 0,
      textures: textureSampler,
    });
  }

  for (let i = 0; i < vertexCount; i++) {
    const v = mesh.vertices[i];
    const p = i * 3;
    const uv = i * 2;
    const c = i * 4;

    positions[p] = v.position.x;
    positions[p + 1] = v.position.y;
    positions[p + 2] = v.position.z;

    normals[p] = v.normal.x;
    normals[p + 1] = v.normal.y;
    normals[p + 2] = v.normal.z;

    uvs[uv] = v.u;
    uvs[uv + 1] = v.v;

    // Apply material color if available, otherwise use vertex color
    // For textured/baked rendering, use white so texture color is preserved
    if (useWhiteColors) {
      colors[c] = 255;
      colors[c + 1] = 255;
      colors[c + 2] = 255;
      colors[c + 3] = 255;
    } else if (materialColor) {
      colors[c] = materialColor.r;
      colors[c + 1] = materialColor.g;
      colors[c + 2] = materialColor.b;
      colors[c + 3] = materialColor.a;
    } else {
      colors[c] = v.color.r;
      colors[c + 1] = v.color.g;
      colors[c + 2] = v.color.b;
      colors[c + 3] = v.color.a;
    }
  }

  return {
    positions,
    normals,
    uvs,
    colors,
    indices: new Uint32Array(mesh.indices),
  };
}

function serializeLines(
  vertices: Vertex[],
  indices: number[],
  modelMatrix: Matrix4,
  depthMode: number = -1
): RenderLines {
  const positions = new Float32Array(vertices.length * 3);
  const colors = new Uint8Array(vertices.length * 4);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    positions[i * 3] = v.position.x;
    positions[i * 3 + 1] = v.position.y;
    positions[i * 3 + 2] = v.position.z;
    colors[i * 4] = v.color.r;
    colors[i * 4 + 1] = v.color.g;
    colors[i * 4 + 2] = v.color.b;
    colors[i * 4 + 3] = v.color.a;
  }

  return {
    positions,
    colors,
    indices: new Uint32Array(indices),
    modelMatrix: serializeMatrix(modelMatrix),
    depthMode,
  };
}

function serializePoints(
  vertices: Vertex[],
  indices: number[],
  modelMatrix: Matrix4,
  pointSize: number
): RenderPoints {
  const positions = new Float32Array(vertices.length * 3);
  const colors = new Uint8Array(vertices.length * 4);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    positions[i * 3] = v.position.x;
    positions[i * 3 + 1] = v.position.y;
    positions[i * 3 + 2] = v.position.z;
    colors[i * 4] = v.color.r;
    colors[i * 4 + 1] = v.color.g;
    colors[i * 4 + 2] = v.color.b;
    colors[i * 4 + 3] = v.color.a;
  }

  return {
    positions,
    colors,
    indices: new Int32Array(indices),
    modelMatrix: serializeMatrix(modelMatrix),
    pointSize,
  };
}

function serializeTransparentTris(
  vertices: { position: Vector3; color: Color }[],
  indices: number[],
  modelMatrix: Matrix4,
  alpha: number
): RenderTransparentTris {
  const positions = new Float32Array(vertices.length * 3);
  const colors = new Uint8Array(vertices.length * 4);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    positions[i * 3] = v.position.x;
    positions[i * 3 + 1] = v.position.y;
    positions[i * 3 + 2] = v.position.z;
    colors[i * 4] = v.color.r;
    colors[i * 4 + 1] = v.color.g;
    colors[i * 4 + 2] = v.color.b;
    colors[i * 4 + 3] = v.color.a;
  }

  return {
    positions,
    colors,
    indices: new Uint32Array(indices),
    modelMatrix: serializeMatrix(modelMatrix),
    alpha,
  };
}

// ============================================================================
// View Mode to Settings
// ============================================================================

export function viewModeToSettings(
  viewMode: ViewMode,
  baseSettings: RendererSettings
): Partial<RenderSettings> {
  switch (viewMode) {
    case "wireframe":
      return {
        wireframe: true,
        enableLighting: false,
        enableTexturing: false,
      };
    case "solid":
      return {
        wireframe: false,
        enableLighting: true,
        enableTexturing: false,
      };
    case "material":
      return {
        wireframe: false,
        enableLighting: true,
        enableTexturing: baseSettings.texturing,
      };
  }
}

export function buildRenderSettings(
  baseSettings: RendererSettings,
  viewMode: ViewMode
): RenderSettings {
  const modeSettings = viewModeToSettings(viewMode, baseSettings);

  return {
    wireframe: modeSettings.wireframe ?? baseSettings.wireframe,
    enableLighting: modeSettings.enableLighting ?? baseSettings.lighting,
    enableDithering: true,
    enableTexturing: modeSettings.enableTexturing ?? baseSettings.texturing,
    enableBackfaceCulling: true,
    enableVertexSnapping: true,
    enableSmoothShading: false,
    ambientLight: 0.2,
    snapResolutionX: 320,
    snapResolutionY: 240,
    lightDirection: [0.5, 0.5, -1],
    lightColor: [1, 1, 1],
    lightIntensity: 0.8,
  };
}

// ============================================================================
// Frame Building
// ============================================================================

/**
 * Check if mesh is edge-only (degenerate triangles)
 */
function isEdgeOnlyMesh(mesh: Mesh): boolean {
  if (mesh.indices.length === 0) return false;

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i];
    const i1 = mesh.indices[i + 1];
    const i2 = mesh.indices[i + 2];
    if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
      return false;
    }
  }
  return true;
}

/**
 * Build edge lines for an edge-only mesh
 */
function buildEdgeOnlyLines(
  obj: SceneObject,
  modelMatrix: Matrix4
): RenderLines {
  const edgeVertices: Vertex[] = [];
  const edgeIndices: number[] = [];
  const edgeColor = new Color(32, 32, 32);

  for (let i = 0; i < obj.mesh.indices.length; i += 3) {
    const i0 = obj.mesh.indices[i];
    const i1 = obj.mesh.indices[i + 1];

    const p0 = modelMatrix.transformPoint(obj.mesh.vertices[i0].position);
    const p1 = modelMatrix.transformPoint(obj.mesh.vertices[i1].position);

    const baseIdx = edgeVertices.length;
    edgeVertices.push(new Vertex(p0, edgeColor), new Vertex(p1, edgeColor));
    edgeIndices.push(baseIdx, baseIdx + 1);
  }

  return serializeLines(edgeVertices, edgeIndices, Matrix4.identity(), 0xffff);
}

/**
 * Build wireframe lines for a mesh (renders all edges)
 */
function buildWireframeLines(
  obj: SceneObject,
  modelMatrix: Matrix4
): RenderLines {
  const wireVertices: Vertex[] = [];
  const wireIndices: number[] = [];
  const wireColor = new Color(200, 200, 200); // Light gray for wireframe

  // Use unique edges to avoid drawing shared edges twice
  const edgeSet = new Set<string>();

  for (let i = 0; i < obj.mesh.indices.length; i += 3) {
    const i0 = obj.mesh.indices[i];
    const i1 = obj.mesh.indices[i + 1];
    const i2 = obj.mesh.indices[i + 2];

    // Three edges per triangle
    const edges = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];

    for (const [a, b] of edges) {
      // Create canonical edge key (smaller index first)
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);

      const p0 = obj.mesh.vertices[a].position;
      const p1 = obj.mesh.vertices[b].position;

      const baseIdx = wireVertices.length;
      wireVertices.push(new Vertex(p0, wireColor), new Vertex(p1, wireColor));
      wireIndices.push(baseIdx, baseIdx + 1);
    }
  }

  // Use -1 depth mode to use actual vertex depth (proper occlusion)
  return serializeLines(wireVertices, wireIndices, modelMatrix, -1);
}

/**
 * Build a complete RenderFrame from the current scene state
 */
export function buildRenderFrame(
  ctx: WorkerRenderContext,
  textureChanged: boolean = false
): RenderFrame {
  const { scene, editor, gridData, settings, renderWidth, renderHeight } = ctx;

  // Setup matrices
  const viewMatrix = scene.camera.getViewMatrix();
  const projectionMatrix = scene.camera.getProjectionMatrix(
    renderWidth / renderHeight
  );

  // Build frame
  const frame: RenderFrame = {
    clearColor: [40, 40, 50],
    viewMatrix: serializeMatrix(viewMatrix),
    projectionMatrix: serializeMatrix(projectionMatrix),
    objects: [],
    sceneLines: [],
    grid: null,
    overlays: {
      unselectedVertices: null,
      selectedVertices: null,
      vertexWireframe: null,
      edgeLines: null,
      faceFill: null,
      faceHighlight: null,
      gizmo: null,
      originPoint: null,
    },
    texture: null,
    textures: [], // New textures to upload
    enableTexturing: false,
  };

  // Grid
  if (settings.showGrid && gridData) {
    frame.grid = serializeLines(
      gridData.vertices,
      gridData.lineIndices,
      Matrix4.identity(),
      0xffff // Far depth
    );
  }

  // Check if wireframe mode is active
  const isWireframeMode = editor.viewMode === "wireframe";

  // Build texture sampler map for material evaluation
  const textureSampler: TextureSampler = new Map();
  if (ctx.currentTexture) {
    // Add texture by common paths/IDs that materials might reference
    textureSampler.set("default", ctx.currentTexture);
  }

  // Track baked texture for the frame (replaces source texture when baking is needed)
  let bakedTexture: Texture | null = null;
  // Track object texture for non-baked textured objects
  let objectTexture: Texture | null = null;

  // Scene objects
  for (const obj of scene.objects) {
    if (!obj.visible) continue;

    const modelMatrix = obj.getModelMatrix();

    // Get object's material from registry
    const material = obj.materialId
      ? scene.materials.get(obj.materialId)
      : undefined;

    // Add object's texture to sampler if available
    if (obj.texture) {
      textureSampler.set("default", obj.texture);
      objectTexture = obj.texture; // Track for later use
      // Also add by any texture node paths in the material
      if (material) {
        for (const node of material.nodes) {
          if (node.type === "texture" && node.data.imagePath) {
            textureSampler.set(node.data.imagePath as string, obj.texture);
          }
        }
      }
    }

    if (isEdgeOnlyMesh(obj.mesh)) {
      frame.sceneLines.push(buildEdgeOnlyLines(obj, modelMatrix));
    } else if (isWireframeMode) {
      // In wireframe mode, render as lines instead of solid triangles
      frame.sceneLines.push(buildWireframeLines(obj, modelMatrix));
    } else {
      // Check if material needs baking (has mix nodes, procedural nodes, etc.)
      const needsBaking = material ? materialNeedsBaking(material) : false;

      // Check if material uses texture (texture node connected to output)
      let useTexture = material
        ? materialUsesTexture(material) && !!obj.texture
        : false;

      // Build material bake request if needed (worker will do the baking)
      let materialBake: MaterialBakeRequest | undefined;
      if (needsBaking && material) {
        // Compile material to bytecode for worker
        const compiled = compileMaterialForWorker(material);

        // Include source texture if the material uses texture and object has one
        let sourceTexture: MaterialBakeRequest["sourceTexture"];
        if (compiled.hasTexture && obj.texture && obj.texture.loaded) {
          sourceTexture = {
            data: new Uint8Array(obj.texture.getData()),
            width: obj.texture.width,
            height: obj.texture.height,
          };
        }

        materialBake = {
          materialId: material.id + ":" + hashMaterial(material),
          program: compiled.program,
          colorRampData: compiled.colorRampData,
          colorRampCount: compiled.colorRampCount,
          bakeWidth: obj.texture?.width || 256,
          bakeHeight: obj.texture?.height || 256,
          sourceTexture,
        };

        useTexture = true; // Baked result is always a texture
      }

      // Generate texture ID for non-baked textured objects
      let textureId: string | undefined;
      if (useTexture && !needsBaking && obj.texture && obj.texture.loaded) {
        textureId = hashTexture(obj.texture);

        // Only send texture data if not already sent to worker
        if (!sentTextureIds.has(textureId)) {
          frame.textures.push({
            id: textureId,
            width: obj.texture.width,
            height: obj.texture.height,
            data: new Uint8Array(obj.texture.getData()),
          });
          sentTextureIds.add(textureId);
        }
      }

      frame.objects.push({
        mesh: serializeMesh(obj.mesh, material, textureSampler, useTexture),
        modelMatrix: serializeMatrix(modelMatrix),
        isEdgeOnly: false,
        smoothShading: obj.mesh.smoothShading,
        hasTexture: useTexture,
        materialBake,
        textureId,
      });
    }
  }

  // Build editor overlays using a minimal context
  // The visualization system needs renderWidth/renderHeight for screen-space calculations
  const vizContext = {
    renderWidth,
    renderHeight,
    viewMatrix,
    projectionMatrix,
  };

  // Vertex points
  const vertexData = editor.createVertexPointDataForWorker(vizContext);
  if (vertexData) {
    if (vertexData.unselected.vertices.length > 0) {
      frame.overlays.unselectedVertices = serializePoints(
        vertexData.unselected.vertices,
        vertexData.unselected.pointIndices,
        Matrix4.identity(),
        2
      );
    }
    if (vertexData.selected.vertices.length > 0) {
      frame.overlays.selectedVertices = serializePoints(
        vertexData.selected.vertices,
        vertexData.selected.pointIndices,
        Matrix4.identity(),
        4
      );
    }
  }

  // Vertex wireframe
  const vertexWireframe = editor.createVertexWireframeDataForWorker(vizContext);
  if (vertexWireframe) {
    frame.overlays.vertexWireframe = serializeLines(
      vertexWireframe.vertices,
      vertexWireframe.lineIndices,
      Matrix4.identity(),
      -1
    );
  }

  // Edge lines
  const edgeData = editor.createEdgeLineDataForWorker();
  if (edgeData) {
    frame.overlays.edgeLines = serializeLines(
      edgeData.vertices,
      edgeData.lineIndices,
      Matrix4.identity(),
      -1
    );
  }

  // Face fill (transparent)
  const faceFillData = editor.createSelectedFaceFillDataForWorker(vizContext);
  if (faceFillData) {
    frame.overlays.faceFill = serializeTransparentTris(
      faceFillData.vertices,
      faceFillData.triangleIndices,
      Matrix4.identity(),
      0.3
    );
  }

  // Face highlight
  const faceData = editor.createFaceHighlightDataForWorker(vizContext);
  if (faceData) {
    frame.overlays.faceHighlight = serializeLines(
      faceData.vertices,
      faceData.lineIndices,
      Matrix4.identity(),
      -1
    );
  }

  // Gizmo (always on top)
  const gizmoData = editor.createGizmoData();
  if (gizmoData) {
    frame.overlays.gizmo = serializeLines(
      gizmoData.vertices,
      gizmoData.lineIndices,
      Matrix4.identity(),
      0
    );
  }

  // Origin point
  const originPos = editor.getSelectedObjectOrigin();
  if (originPos) {
    frame.overlays.originPoint = {
      position: [originPos.x, originPos.y, originPos.z],
      color: [255, 128, 0, 255], // Orange
      modelMatrix: serializeMatrix(Matrix4.identity()),
      pointSize: 4,
    };
  }

  // Global texture (only used as fallback when per-object texture isn't set)
  // Per-object textures are now sent with each RenderObject
  const texturingEnabled = editor.viewMode === "material";

  // Only send global texture if we have one and no per-object textures
  // (for backwards compatibility with single-texture OBJ files)
  if (ctx.currentTexture && texturingEnabled && !objectTexture) {
    frame.texture = {
      slot: 0,
      width: ctx.currentTexture.width,
      height: ctx.currentTexture.height,
      data: new Uint8Array(ctx.currentTexture.getData()),
    };
  }

  // Set per-frame texturing flag based on view mode only
  frame.enableTexturing = texturingEnabled;

  return frame;
}

// Re-export types
export type { RenderFrame, RenderSettings };
