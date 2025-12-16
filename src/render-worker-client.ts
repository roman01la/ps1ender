/**
 * Render Worker Client - Main thread API for the render worker
 *
 * Provides a clean interface to:
 * - Initialize the worker with an OffscreenCanvas
 * - Send render frames (meshes, transforms, settings)
 * - Receive FPS/timing updates
 */

import {
  WorkerCommand,
  WorkerResponse,
  RenderSettings,
  RenderFrame,
  SerializedMesh,
  RenderObject,
  RenderLines,
  RenderPoints,
  RenderTransparentTris,
  RenderPointNoDepth,
} from "./render-worker";
import { Matrix4, Vector3, Color } from "./math";
import { Mesh, Vertex } from "./primitives";
import { Texture } from "./texture";

export class RenderWorkerClient {
  private worker: Worker;
  private ready: boolean = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (err: Error) => void;

  // Callbacks
  public onFrameStats: ((fps: number, frameTimeMs: number) => void) | null =
    null;

  // Cached texture data to avoid re-sending unchanged textures
  private lastTextureId: number = -1;
  private textureIdCounter: number = 0;

  constructor(workerUrl: string) {
    this.worker = new Worker(workerUrl, { type: "module" });

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const response = e.data;
      switch (response.type) {
        case "ready":
          this.ready = true;
          this.readyResolve();
          break;
        case "frame":
          if (this.onFrameStats) {
            this.onFrameStats(response.fps, response.frameTimeMs);
          }
          break;
        case "error":
          console.error("Render worker error:", response.message);
          if (!this.ready) {
            this.readyReject(new Error(response.message));
          }
          break;
      }
    };

    this.worker.onerror = (e) => {
      console.error("Render worker error:", e);
      if (!this.ready) {
        this.readyReject(new Error(e.message));
      }
    };
  }

  /**
   * Initialize the worker with an OffscreenCanvas
   */
  async init(canvas: HTMLCanvasElement, wasmPath: string): Promise<void> {
    // Transfer canvas control to worker
    const offscreen = canvas.transferControlToOffscreen();

    const cmd: WorkerCommand = {
      type: "init",
      canvas: offscreen,
      wasmPath,
    };
    this.worker.postMessage(cmd, [offscreen]);

    return this.readyPromise;
  }

  /**
   * Wait for worker to be ready
   */
  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Resize the display canvas
   */
  resize(displayWidth: number, displayHeight: number): void {
    const cmd: WorkerCommand = {
      type: "resize",
      displayWidth,
      displayHeight,
    };
    this.worker.postMessage(cmd);
  }

  /**
   * Set the internal render resolution
   */
  setRenderResolution(renderWidth: number, renderHeight: number): void {
    const cmd: WorkerCommand = {
      type: "setRenderResolution",
      renderWidth,
      renderHeight,
    };
    this.worker.postMessage(cmd);
  }

  /**
   * Update render settings
   */
  setSettings(settings: RenderSettings): void {
    const cmd: WorkerCommand = {
      type: "setSettings",
      settings,
    };
    this.worker.postMessage(cmd);
  }

  /**
   * Send a frame to render
   */
  render(frame: RenderFrame): void {
    const cmd: WorkerCommand = {
      type: "render",
      frame,
    };
    this.worker.postMessage(cmd);
  }

  /**
   * Set target FPS
   */
  setTargetFPS(fps: number): void {
    const cmd: WorkerCommand = {
      type: "setTargetFPS",
      fps,
    };
    this.worker.postMessage(cmd);
  }

  /**
   * Start the render loop
   */
  start(): void {
    const cmd: WorkerCommand = { type: "start" };
    this.worker.postMessage(cmd);
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    const cmd: WorkerCommand = { type: "stop" };
    this.worker.postMessage(cmd);
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    this.stop();
    this.worker.terminate();
  }

  // ==========================================================================
  // Helper methods to serialize scene data
  // ==========================================================================

  /**
   * Serialize a Mesh to transferable format
   */
  serializeMesh(mesh: Mesh): SerializedMesh {
    const vertexCount = mesh.vertices.length;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Uint8Array(vertexCount * 4);

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

      colors[c] = v.color.r;
      colors[c + 1] = v.color.g;
      colors[c + 2] = v.color.b;
      colors[c + 3] = v.color.a;
    }

    return {
      positions,
      normals,
      uvs,
      colors,
      indices: new Uint32Array(mesh.indices),
    };
  }

  /**
   * Serialize a Matrix4 to Float32Array
   */
  serializeMatrix(m: Matrix4): Float32Array {
    return new Float32Array(m.data);
  }

  /**
   * Serialize line data from vertices and indices
   */
  serializeLines(
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
      modelMatrix: this.serializeMatrix(modelMatrix),
      depthMode,
    };
  }

  /**
   * Serialize point data
   */
  serializePoints(
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
      modelMatrix: this.serializeMatrix(modelMatrix),
      pointSize,
    };
  }

  /**
   * Serialize transparent triangles
   */
  serializeTransparentTris(
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
      modelMatrix: this.serializeMatrix(modelMatrix),
      alpha,
    };
  }

  /**
   * Serialize a texture (returns null if unchanged)
   */
  serializeTexture(
    texture: Texture | null,
    slot: number = 0,
    forceUpdate: boolean = false
  ): { slot: number; width: number; height: number; data: Uint8Array } | null {
    if (!texture) return null;

    // Simple change detection via texture properties
    const textureId = texture.width * 10000 + texture.height;
    if (!forceUpdate && textureId === this.lastTextureId) {
      return null; // Texture unchanged
    }
    this.lastTextureId = textureId;

    return {
      slot,
      width: texture.width,
      height: texture.height,
      data: new Uint8Array(texture.getData()),
    };
  }
}

// Re-export types
export type {
  RenderSettings,
  RenderFrame,
  SerializedMesh,
  RenderObject,
  RenderLines,
  RenderPoints,
  RenderTransparentTris,
  RenderPointNoDepth,
};
