/**
 * Render Loop System - Manages the animation frame loop and rendering orchestration
 *
 * This system provides:
 * - FPS-limited animation frame management
 * - Frame timing and FPS calculation
 * - Render orchestration for scene, editor, and overlays
 */

import { Matrix4, Color } from "../math";
import { Vertex } from "../primitives";
import { Rasterizer } from "../rasterizer";
import { Scene } from "../scene";
import { Editor, ViewMode } from "../editor";
import { InputManager } from "./input";
import { RendererSettings } from "./ui-state";

/**
 * Timing configuration for the render loop
 */
export interface TimingConfig {
  targetFPS: number;
}

/**
 * Internal timing state
 */
export interface TimingState {
  lastTime: number;
  lastRenderTime: number;
  frameCount: number;
  fpsTime: number;
  frameInterval: number;
}

/**
 * Grid data for rendering
 */
export interface GridData {
  vertices: Vertex[];
  lineIndices: number[];
}

/**
 * Render context containing all references needed for rendering
 */
export interface RenderContext {
  rasterizer: Rasterizer;
  scene: Scene;
  editor: Editor;
  inputManager: InputManager;
  gridData: GridData | null;
  settings: RendererSettings;
}

/**
 * Callbacks for the render loop
 */
export interface RenderCallbacks {
  onFpsUpdate: (fps: number, frameTimeMs: number) => void;
  onUIUpdate: () => void;
}

/**
 * Create initial timing state
 */
export function createTimingState(targetFPS: number = 24): TimingState {
  const now = performance.now();
  return {
    lastTime: now,
    lastRenderTime: now,
    frameCount: 0,
    fpsTime: 0,
    frameInterval: 1000 / targetFPS,
  };
}

/**
 * Apply view mode settings to rasterizer
 */
export function applyViewMode(
  rasterizer: Rasterizer,
  viewMode: ViewMode
): void {
  switch (viewMode) {
    case "wireframe":
      rasterizer.wireframe = true;
      rasterizer.enableLighting = false;
      rasterizer.enableTexturing = false;
      break;
    case "solid":
      rasterizer.wireframe = false;
      rasterizer.enableLighting = true;
      rasterizer.enableTexturing = false;
      break;
    case "material":
      rasterizer.wireframe = false;
      rasterizer.enableLighting = true;
      rasterizer.enableTexturing = true;
      break;
  }
}

/**
 * Render the scene including all objects, grid, and editor overlays
 */
export function renderFrame(ctx: RenderContext): void {
  const { rasterizer, scene, editor, gridData, settings } = ctx;

  // Setup matrices
  const viewMatrix = scene.camera.getViewMatrix();
  const projectionMatrix = scene.camera.getProjectionMatrix(
    rasterizer.renderWidth / rasterizer.renderHeight
  );

  // Apply view mode settings
  applyViewMode(rasterizer, editor.viewMode);

  // Clear
  rasterizer.clear(new Color(40, 40, 50));

  // Render grid first (behind everything)
  if (settings.showGrid && gridData) {
    rasterizer.renderLines(
      {
        vertices: gridData.vertices,
        indices: gridData.lineIndices,
      },
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix
    );
  }

  // Render all scene objects
  for (const obj of scene.objects) {
    if (!obj.visible) continue;

    const modelMatrix = obj.getModelMatrix();

    // Check if mesh is edge-only by detecting degenerate triangles
    // A degenerate triangle has at least 2 vertices at the same position
    const isEdgeOnly =
      obj.mesh.indices.length > 0 &&
      (() => {
        for (let i = 0; i < obj.mesh.indices.length; i += 3) {
          const i0 = obj.mesh.indices[i];
          const i1 = obj.mesh.indices[i + 1];
          const i2 = obj.mesh.indices[i + 2];
          // If any triangle has 3 distinct vertices, it's not edge-only
          if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
            return false;
          }
        }
        return true;
      })();

    if (isEdgeOnly) {
      // Render as edges with dark color for faceless meshes
      const edgeVertices: Vertex[] = [];
      const edgeIndices: number[] = [];
      const edgeColor = new Color(32, 32, 32); // Dark gray

      // Build edge data from mesh indices
      for (let i = 0; i < obj.mesh.indices.length; i += 3) {
        const i0 = obj.mesh.indices[i];
        const i1 = obj.mesh.indices[i + 1];

        // Transform vertices by model matrix
        const p0 = modelMatrix.transformPoint(obj.mesh.vertices[i0].position);
        const p1 = modelMatrix.transformPoint(obj.mesh.vertices[i1].position);

        const baseIdx = edgeVertices.length;
        edgeVertices.push(new Vertex(p0, edgeColor), new Vertex(p1, edgeColor));
        edgeIndices.push(baseIdx, baseIdx + 1);
      }

      rasterizer.renderLines(
        {
          vertices: edgeVertices,
          indices: edgeIndices,
        },
        Matrix4.identity(), // Already transformed
        viewMatrix,
        projectionMatrix
      );
    } else {
      // Normal mesh rendering
      rasterizer.renderMesh(
        obj.mesh,
        modelMatrix,
        viewMatrix,
        projectionMatrix
      );
    }
  }

  // Render editor overlays (gizmo, edit mode visualizations)
  renderEditorOverlays(rasterizer, editor, viewMatrix, projectionMatrix);

  rasterizer.present();
}
export function renderEditorOverlays(
  rasterizer: Rasterizer,
  editor: Editor,
  viewMatrix: Matrix4,
  projectionMatrix: Matrix4
): void {
  // IMPORTANT: Render depth-tested elements FIRST (before gizmo which uses depth=0)
  // These use actual depth values with bias, so they must be rendered while
  // depth buffer still contains mesh geometry depth values

  // Render vertex points in Edit mode (vertex selection mode)
  const vertexData = editor.createVertexPointData(
    rasterizer,
    viewMatrix,
    projectionMatrix
  );
  if (vertexData) {
    // Render unselected vertices (smaller)
    if (vertexData.unselected.vertices.length > 0) {
      rasterizer.renderPoints(
        {
          vertices: vertexData.unselected.vertices,
          indices: vertexData.unselected.pointIndices,
        },
        Matrix4.identity(),
        viewMatrix,
        projectionMatrix,
        2 // Smaller point size for unselected
      );
    }
    // Render selected vertices (larger, on top)
    if (vertexData.selected.vertices.length > 0) {
      rasterizer.renderPoints(
        {
          vertices: vertexData.selected.vertices,
          indices: vertexData.selected.pointIndices,
        },
        Matrix4.identity(),
        viewMatrix,
        projectionMatrix,
        4 // Larger point size for selected
      );
    }
  }

  // Render wireframe in vertex edit mode (with depth testing)
  const vertexWireframe = editor.createVertexWireframeData(
    rasterizer,
    viewMatrix,
    projectionMatrix
  );
  if (vertexWireframe) {
    rasterizer.renderLines(
      {
        vertices: vertexWireframe.vertices,
        indices: vertexWireframe.lineIndices,
      },
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix,
      -1 // Use actual depth from vertex positions
    );
  }

  // Render edge lines in Edit mode (edge selection mode, with depth testing)
  const edgeData = editor.createEdgeLineData(
    rasterizer,
    viewMatrix,
    projectionMatrix
  );
  if (edgeData) {
    rasterizer.renderLines(
      {
        vertices: edgeData.vertices,
        indices: edgeData.lineIndices,
      },
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix,
      -1 // Use actual depth from vertex positions
    );
  }

  // Render transparent fill for selected faces (with depth testing)
  const faceFillData = editor.createSelectedFaceFillData(
    rasterizer,
    viewMatrix,
    projectionMatrix
  );
  if (faceFillData) {
    rasterizer.renderTransparentTriangles(
      {
        vertices: faceFillData.vertices,
        indices: faceFillData.triangleIndices,
      },
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix,
      0.3 // 30% opacity
    );
  }

  // Render face highlights in Edit mode (face selection mode, with depth testing)
  const faceData = editor.createFaceHighlightData(
    rasterizer,
    viewMatrix,
    projectionMatrix
  );
  if (faceData) {
    rasterizer.renderLines(
      {
        vertices: faceData.vertices,
        indices: faceData.lineIndices,
      },
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix,
      -1 // Use actual depth from vertex positions
    );
  }

  // Render gizmo for selected object LAST (depth 0 = always on top of everything)
  const gizmoData = editor.createGizmoData();
  if (gizmoData) {
    rasterizer.renderLines(
      {
        vertices: gizmoData.vertices,
        indices: gizmoData.lineIndices,
      },
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix,
      0 // Gizmo always on top
    );
  }

  // Render origin point for selected object (orange circle, always on top)
  const originPos = editor.getSelectedObjectOrigin();
  if (originPos) {
    const originColor = new Color(255, 128, 0); // Orange
    rasterizer.renderPointNoDepth(
      originPos,
      originColor,
      Matrix4.identity(),
      viewMatrix,
      projectionMatrix,
      4 // Point size
    );
  }
}

/**
 * RenderLoop class - manages the animation frame loop
 */
export class RenderLoop {
  private animationId: number = 0;
  private timing: TimingState;
  private running: boolean = false;

  constructor(targetFPS: number = 24) {
    this.timing = createTimingState(targetFPS);
  }

  /**
   * Start the render loop
   */
  start(ctx: RenderContext, callbacks: RenderCallbacks): void {
    if (this.running) return;
    this.running = true;
    this.timing = createTimingState(1000 / this.timing.frameInterval);

    const tick = (currentTime: number) => {
      if (!this.running) return;
      this.animationId = requestAnimationFrame(tick);

      // FPS limiting
      const elapsed = currentTime - this.timing.lastRenderTime;
      if (elapsed < this.timing.frameInterval) {
        return;
      }
      this.timing.lastRenderTime =
        currentTime - (elapsed % this.timing.frameInterval);

      const deltaTime = currentTime - this.timing.lastTime;
      this.timing.lastTime = currentTime;

      // Update UI state
      callbacks.onUIUpdate();

      // Render the frame and measure time
      const renderStart = performance.now();
      renderFrame(ctx);
      const frameTimeMs = performance.now() - renderStart;

      // Update FPS counter (do this after render so we have frame time)
      this.timing.frameCount++;
      this.timing.fpsTime += deltaTime;
      if (this.timing.fpsTime >= 1000) {
        callbacks.onFpsUpdate(this.timing.frameCount, frameTimeMs);
        this.timing.frameCount = 0;
        this.timing.fpsTime = 0;
      }
    };

    this.animationId = requestAnimationFrame(tick);
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  /**
   * Check if the loop is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
