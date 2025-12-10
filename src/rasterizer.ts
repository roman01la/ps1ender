import { Vector3, Vector4, Matrix4, Color, clamp } from "./math";
import { Vertex, Triangle, Mesh } from "./primitives";
import { Texture } from "./texture";

// Processed vertex after transformation
interface ProcessedVertex {
  position: Vector3; // Screen-space position
  worldPos: Vector3; // World-space position (for lighting)
  color: Color;
  normal: Vector3;
  depth: number; // Z value for depth testing
  u: number; // Texture U coordinate (pre-multiplied by affine for PS1 style)
  v: number; // Texture V coordinate (pre-multiplied by affine for PS1 style)
  affine: number; // Affine factor for PS1-style texture warping
}

// Light structure
export interface Light {
  direction: Vector3;
  color: Color;
  intensity: number;
}

// 8x8 Bayer dither matrix
const DITHER_MATRIX = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

export class Rasterizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Internal render buffer at PS1 resolution
  private renderCanvas: OffscreenCanvas;
  private renderCtx: OffscreenCanvasRenderingContext2D;
  private imageData: ImageData;
  private pixels: Uint32Array;
  private depthBuffer: Uint16Array; // 16-bit fixed-point depth (PS1 style)

  // Internal render resolution (PS1 native, doubled)
  public renderWidth: number = 640;
  public renderHeight: number = 480;

  // Display canvas size
  public width: number;
  public height: number;

  // Rendering settings
  public wireframe: boolean = false;
  public enableLighting: boolean = true;
  public enableBackfaceCulling: boolean = true;
  public ambientLight: number = 0.2;
  public lights: Light[] = [];

  // PS1 style settings
  public enableDithering: boolean = true;
  public enableVertexSnapping: boolean = true;
  public vertexSnapResolution: Vector3 = new Vector3(320, 240, 1); // PS1 resolution
  public colorDepth: number = 15; // PS1 had 15-bit color (5 bits per channel)
  public ditherScale: number = 1;

  // Current texture for rendering
  public currentTexture: Texture | null = null;
  public enableTexturing: boolean = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.width = canvas.width;
    this.height = canvas.height;

    // Create internal render buffer at PS1 resolution
    this.renderCanvas = new OffscreenCanvas(
      this.renderWidth,
      this.renderHeight
    );
    this.renderCtx = this.renderCanvas.getContext("2d")!;
    this.imageData = this.renderCtx.createImageData(
      this.renderWidth,
      this.renderHeight
    );
    this.pixels = new Uint32Array(this.imageData.data.buffer);
    this.depthBuffer = new Uint16Array(this.renderWidth * this.renderHeight); // 16-bit fixed-point

    // Disable image smoothing for pixelated scaling
    this.ctx.imageSmoothingEnabled = false;

    // Add default directional light
    this.lights.push({
      direction: new Vector3(0.5, -1, 0.5).normalize(),
      color: Color.white(),
      intensity: 0.8,
    });
  }

  // Set the current texture for rendering
  setTexture(texture: Texture | null): void {
    this.currentTexture = texture;
  }

  // Clear the framebuffer and depth buffer
  clear(color: Color = Color.black()): void {
    // Precompute color value (ABGR for little-endian)
    const colorValue = 0xff000000 | (color.b << 16) | (color.g << 8) | color.r;
    this.pixels.fill(colorValue);
    this.depthBuffer.fill(0xffff); // Max depth (16-bit)
  }

  // Present the rendered frame to the canvas (scale up from render buffer)
  present(): void {
    // Put pixel data to internal render canvas
    this.renderCtx.putImageData(this.imageData, 0, 0);

    // Scale up to display canvas with nearest-neighbor (pixelated)
    this.ctx.drawImage(
      this.renderCanvas,
      0,
      0,
      this.renderWidth,
      this.renderHeight,
      0,
      0,
      this.width,
      this.height
    );
  }

  // Set a pixel at (x, y) with depth testing
  private setPixel(x: number, y: number, z: number, color: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);

    if (x < 0 || x >= this.renderWidth || y < 0 || y >= this.renderHeight)
      return;

    const index = y * this.renderWidth + x;

    // Depth test
    if (z >= this.depthBuffer[index]) return;

    this.depthBuffer[index] = z;
    this.pixels[index] = color.toUint32();
  }

  // Draw a line using Bresenham's algorithm
  drawLine(x0: number, y0: number, x1: number, y1: number, color: Color): void {
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    x1 = Math.floor(x1);
    y1 = Math.floor(y1);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      if (
        x0 >= 0 &&
        x0 < this.renderWidth &&
        y0 >= 0 &&
        y0 < this.renderHeight
      ) {
        this.pixels[y0 * this.renderWidth + x0] = color.toUint32();
      }

      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // Compute barycentric coordinates
  private barycentric(
    x: number,
    y: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): [number, number, number] | null {
    const v0x = x2 - x0;
    const v0y = y2 - y0;
    const v1x = x1 - x0;
    const v1y = y1 - y0;
    const v2x = x - x0;
    const v2y = y - y0;

    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;

    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    const w = 1 - u - v;

    // Check if point is in triangle
    if (u >= 0 && v >= 0 && w >= 0) {
      return [w, v, u]; // Return in order: v0, v1, v2
    }
    return null;
  }

  // Calculate lighting for a point
  private calculateLighting(normal: Vector3, baseColor: Color): Color {
    if (!this.enableLighting) return baseColor;

    let totalLight = this.ambientLight;

    for (const light of this.lights) {
      // Diffuse lighting (Lambert)
      const ndotl = Math.max(0, -normal.dot(light.direction));
      totalLight += ndotl * light.intensity;
    }

    totalLight = clamp(totalLight, 0, 1);
    return baseColor.mul(totalLight);
  }

  // Rasterize a triangle using scanline algorithm with edge functions (optimized)
  private rasterizeTriangle(
    v0: ProcessedVertex,
    v1: ProcessedVertex,
    v2: ProcessedVertex
  ): void {
    // Get bounding box using integer math (PS1 had no sub-pixel precision)
    const minX = Math.max(
      0,
      Math.min(v0.position.x, v1.position.x, v2.position.x) | 0
    );
    const maxX = Math.min(
      this.renderWidth - 1,
      (Math.max(v0.position.x, v1.position.x, v2.position.x) | 0) + 1
    );
    const minY = Math.max(
      0,
      Math.min(v0.position.y, v1.position.y, v2.position.y) | 0
    );
    const maxY = Math.min(
      this.renderHeight - 1,
      (Math.max(v0.position.y, v1.position.y, v2.position.y) | 0) + 1
    );

    // Cache vertex positions
    const x0 = v0.position.x,
      y0 = v0.position.y;
    const x1 = v1.position.x,
      y1 = v1.position.y;
    const x2 = v2.position.x,
      y2 = v2.position.y;

    // Edge function setup (for incremental barycentric)
    const A01 = y0 - y1,
      B01 = x1 - x0;
    const A12 = y1 - y2,
      B12 = x2 - x1;
    const A20 = y2 - y0,
      B20 = x0 - x2;

    // Area of triangle * 2 (for normalization)
    const area = A01 * (x2 - x0) + B01 * (y2 - y0);
    if (Math.abs(area) < 0.0001) return; // Degenerate triangle
    const invArea = 1 / area;

    // Starting point
    const px = minX + 0.5;
    const py = minY + 0.5;

    // Initial edge values at starting corner
    let w0Row = A12 * (px - x1) + B12 * (py - y1);
    let w1Row = A20 * (px - x2) + B20 * (py - y2);
    let w2Row = A01 * (px - x0) + B01 * (py - y0);

    // Pre-compute per-vertex lighting (Gouraud shading - PS1 style)
    let light0 = 1.0,
      light1 = 1.0,
      light2 = 1.0;
    if (this.enableLighting) {
      light0 = this.ambientLight;
      light1 = this.ambientLight;
      light2 = this.ambientLight;
      for (const light of this.lights) {
        const ndotl0 = Math.max(0, -v0.normal.dot(light.direction));
        const ndotl1 = Math.max(0, -v1.normal.dot(light.direction));
        const ndotl2 = Math.max(0, -v2.normal.dot(light.direction));
        light0 += ndotl0 * light.intensity;
        light1 += ndotl1 * light.intensity;
        light2 += ndotl2 * light.intensity;
      }
      light0 = Math.min(1, light0);
      light1 = Math.min(1, light1);
      light2 = Math.min(1, light2);
    }

    // Pre-multiply vertex colors with lighting
    const r0 = v0.color.r * light0,
      g0 = v0.color.g * light0,
      b0 = v0.color.b * light0;
    const r1 = v1.color.r * light1,
      g1 = v1.color.g * light1,
      b1 = v1.color.b * light1;
    const r2 = v2.color.r * light2,
      g2 = v2.color.g * light2,
      b2 = v2.color.b * light2;

    // Cache texture reference and settings
    const tex = this.enableTexturing ? this.currentTexture : null;
    const dither = this.enableDithering;

    // Cache texture data for inline sampling (avoids property lookups in inner loop)
    let texData: Uint8ClampedArray | null = null;
    let texWidth = 0;
    let texHeight = 0;
    if (tex) {
      texData = (tex as any).data;
      texWidth = tex.width;
      texHeight = tex.height;
    }

    // Cache depth and pixel buffers locally (avoids property lookups)
    const depthBuffer = this.depthBuffer;
    const pixels = this.pixels;
    const renderWidth = this.renderWidth;

    // Iterate over bounding box
    for (let y = minY; y <= maxY; y++) {
      let w0 = w0Row;
      let w1 = w1Row;
      let w2 = w2Row;
      const yOffset = y * renderWidth;

      for (let x = minX; x <= maxX; x++) {
        // Check if inside triangle (all edge functions positive or all negative)
        if (
          (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
          (w0 <= 0 && w1 <= 0 && w2 <= 0)
        ) {
          // Normalize barycentric coordinates
          const bw0 = w0 * invArea;
          const bw1 = w1 * invArea;
          const bw2 = w2 * invArea;

          // Interpolate depth (convert to 16-bit fixed point for PS1-style integer math)
          const depthF = v0.depth * bw0 + v1.depth * bw1 + v2.depth * bw2;
          // Map NDC depth [-1,1] to [0, 65535]
          const depth = ((depthF + 1) * 32767.5) | 0;

          // Early depth test (integer comparison - faster)
          const idx = yOffset + x;
          if (depth >= depthBuffer[idx]) {
            w0 += A12;
            w1 += A20;
            w2 += A01;
            continue;
          }

          // Get base color
          let cr: number, cg: number, cb: number;

          if (texData) {
            // Interpolate UV coordinates with PS1-style affine texture mapping
            const uAffine = v0.u * bw0 + v1.u * bw1 + v2.u * bw2;
            const vAffine = v0.v * bw0 + v1.v * bw1 + v2.v * bw2;
            const affine = v0.affine * bw0 + v1.affine * bw1 + v2.affine * bw2;
            let tu = uAffine / affine;
            let tv = vAffine / affine;

            // Inline texture sampling (avoids function call)
            tu = tu - Math.floor(tu);
            tv = tv - Math.floor(tv);
            const tx = (tu * texWidth) | 0;
            const ty = ((1 - tv) * texHeight) | 0;
            const wx = ((tx % texWidth) + texWidth) % texWidth;
            const wy = ((ty % texHeight) + texHeight) % texHeight;
            const texIdx = (wy * texWidth + wx) << 2; // * 4

            const texR = texData[texIdx];
            const texG = texData[texIdx + 1];
            const texB = texData[texIdx + 2];

            // Modulate with lit vertex colors
            cr = (texR * (r0 * bw0 + r1 * bw1 + r2 * bw2)) / 255;
            cg = (texG * (g0 * bw0 + g1 * bw1 + g2 * bw2)) / 255;
            cb = (texB * (b0 * bw0 + b1 * bw1 + b2 * bw2)) / 255;
          } else {
            // Interpolate lit vertex colors (Gouraud shading)
            cr = r0 * bw0 + r1 * bw1 + r2 * bw2;
            cg = g0 * bw0 + g1 * bw1 + g2 * bw2;
            cb = b0 * bw0 + b1 * bw1 + b2 * bw2;
          } // Apply PS1-style ordered dithering (simple RGB - much faster than YUV)
          if (dither) {
            // Get dither threshold from 8x8 Bayer matrix (0-63 range)
            const ix = x & 7;
            const iy = y & 7;
            const threshold = DITHER_MATRIX[iy][ix];

            // Simple ordered dithering: add threshold scaled to color precision
            // PS1 used 5-bit color (32 levels), so we quantize to that
            // threshold/64 gives 0-1, multiply by step size (255/31 ≈ 8)
            const ditherAmount = (threshold - 32) >> 2; // Range roughly -8 to +8

            // Add dither and quantize to 5-bit (PS1 15-bit color = 5 bits per channel)
            cr = (((cr + ditherAmount) >> 3) << 3) | 0;
            cg = (((cg + ditherAmount) >> 3) << 3) | 0;
            cb = (((cb + ditherAmount) >> 3) << 3) | 0;

            // Clamp
            cr = cr < 0 ? 0 : cr > 255 ? 255 : cr;
            cg = cg < 0 ? 0 : cg > 255 ? 255 : cg;
            cb = cb < 0 ? 0 : cb > 255 ? 255 : cb;
          } else {
            cr = Math.min(255, cr | 0);
            cg = Math.min(255, cg | 0);
            cb = Math.min(255, cb | 0);
          }

          // Write pixel directly (ABGR format for little-endian)
          depthBuffer[idx] = depth;
          pixels[idx] = 0xff000000 | (cb << 16) | (cg << 8) | cr;
        }

        // Increment edge functions
        w0 += A12;
        w1 += A20;
        w2 += A01;
      }

      // Step to next row
      w0Row += B12;
      w1Row += B20;
      w2Row += B01;
    }
  }

  // Draw wireframe triangle
  private drawWireframeTriangle(
    v0: ProcessedVertex,
    v1: ProcessedVertex,
    v2: ProcessedVertex,
    color: Color
  ): void {
    this.drawLine(
      v0.position.x,
      v0.position.y,
      v1.position.x,
      v1.position.y,
      color
    );
    this.drawLine(
      v1.position.x,
      v1.position.y,
      v2.position.x,
      v2.position.y,
      color
    );
    this.drawLine(
      v2.position.x,
      v2.position.y,
      v0.position.x,
      v0.position.y,
      color
    );
  }

  // RGB to YUV conversion for dithering
  private rgbToYuv(r: number, g: number, b: number): [number, number, number] {
    const y = r * 0.2126 + 0.7152 * g + 0.0722 * b;
    const u = (b - y) / 1.8556 + 0.5;
    const v = (r - y) / 1.5748 + 0.5;
    return [y, u, v];
  }

  // YUV to RGB conversion
  private yuvToRgb(y: number, u: number, v: number): [number, number, number] {
    u -= 0.5;
    v -= 0.5;
    return [
      clamp(y + v * 1.5748, 0, 1),
      clamp(y + u * -0.187324 + v * -0.468124, 0, 1),
      clamp(y + u * 1.8556, 0, 1),
    ];
  }

  // Get dither threshold at position
  private getDitherThreshold(x: number, y: number): number {
    const ix = Math.floor(x / this.ditherScale) & 7;
    const iy = Math.floor(y / this.ditherScale) & 7;
    return (DITHER_MATRIX[iy][ix] + 1) / 64;
  }

  // Apply dithering and posterization to a color
  private ditherAndPosterize(x: number, y: number, color: Color): Color {
    if (!this.enableDithering) return color;

    // Normalize color to 0-1 range
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;

    // Convert to YUV
    let [yc, u, v] = this.rgbToYuv(r, g, b);

    // Posterize and dither each channel
    const depth = this.colorDepth;

    // Y channel
    const yMin = Math.floor(yc * depth) / depth;
    const yMax = Math.ceil(yc * depth) / depth;
    const yErr = yMax > yMin ? (yc - yMin) / (yMax - yMin) : 0;
    yc = this.getDitherThreshold(x, y) < yErr ? yMax : yMin;

    // U channel
    const uMin = Math.floor(u * depth) / depth;
    const uMax = Math.ceil(u * depth) / depth;
    const uErr = uMax > uMin ? (u - uMin) / (uMax - uMin) : 0;
    u = this.getDitherThreshold(x + 1, y) < uErr ? uMax : uMin;

    // V channel
    const vMin = Math.floor(v * depth) / depth;
    const vMax = Math.ceil(v * depth) / depth;
    const vErr = vMax > vMin ? (v - vMin) / (vMax - vMin) : 0;
    v = this.getDitherThreshold(x, y + 1) < vErr ? vMax : vMin;

    // Convert back to RGB
    const [nr, ng, nb] = this.yuvToRgb(yc, u, v);

    return new Color(
      Math.floor(nr * 255),
      Math.floor(ng * 255),
      Math.floor(nb * 255),
      color.a
    );
  }

  // Transform vertex through MVP pipeline
  private processVertex(
    vertex: Vertex,
    mvp: Matrix4,
    modelMatrix: Matrix4
  ): ProcessedVertex {
    // Transform position through MVP
    const clipPos = mvp.transformVector4(
      Vector4.fromVector3(vertex.position, 1)
    );

    // Perspective divide
    let ndcPos = clipPos.perspectiveDivide();

    // PS1-style vertex snapping (snap in clip/NDC space before viewport transform)
    if (this.enableVertexSnapping) {
      // Snap to a lower resolution grid (simulating PS1's fixed-point math)
      const snapX = this.vertexSnapResolution.x;
      const snapY = this.vertexSnapResolution.y;
      ndcPos = new Vector3(
        Math.floor(ndcPos.x * snapX) / snapX,
        Math.floor(ndcPos.y * snapY) / snapY,
        ndcPos.z
      );
    }

    // Viewport transform (NDC to render buffer resolution)
    const screenX = (ndcPos.x + 1) * 0.5 * this.renderWidth;
    const screenY = (1 - ndcPos.y) * 0.5 * this.renderHeight; // Flip Y

    // Transform normal to world space
    const worldNormal = modelMatrix
      .transformDirection(vertex.normal)
      .normalize();

    // World position for lighting
    const worldPos = modelMatrix.transformPoint(vertex.position);

    // PS1-style affine texture mapping factor
    // Based on distance from camera, creates the characteristic "warping" effect
    // Formula: affine = dist + (w * 8.0) / dist * 0.5
    const dist = Math.max(0.001, clipPos.w); // Use W (depth) as distance approximation
    const affine = dist + ((clipPos.w * 8.0) / dist) * 0.5;

    return {
      position: new Vector3(screenX, screenY, ndcPos.z),
      worldPos,
      color: vertex.color.clone(),
      normal: worldNormal,
      depth: ndcPos.z,
      // Pre-multiply UVs by affine factor (will divide after interpolation)
      u: vertex.u * affine,
      v: vertex.v * affine,
      affine: affine,
    };
  }

  // Check if triangle is backfacing
  private isBackfacing(
    v0: ProcessedVertex,
    v1: ProcessedVertex,
    v2: ProcessedVertex
  ): boolean {
    // Calculate signed area in screen space
    const edge1x = v1.position.x - v0.position.x;
    const edge1y = v1.position.y - v0.position.y;
    const edge2x = v2.position.x - v0.position.x;
    const edge2y = v2.position.y - v0.position.y;

    const signedArea = edge1x * edge2y - edge1y * edge2x;
    // Positive area = backfacing (due to Y-axis flip in screen space)
    return signedArea > 0;
  }

  // Check if triangle is outside frustum or crosses near plane
  private isOutsideFrustum(
    v0: ProcessedVertex,
    v1: ProcessedVertex,
    v2: ProcessedVertex
  ): boolean {
    // Near plane clipping - reject if ALL behind near plane
    if (v0.depth < -1 && v1.depth < -1 && v2.depth < -1) return true;
    // Far plane clipping
    if (v0.depth > 1 && v1.depth > 1 && v2.depth > 1) return true;

    // PS1-style: reject triangles that cross the near plane
    // This prevents huge/inverted triangles when camera is inside geometry
    const nearPlane = -0.5; // Slightly in front of actual near plane
    const v0Behind = v0.depth < nearPlane;
    const v1Behind = v1.depth < nearPlane;
    const v2Behind = v2.depth < nearPlane;

    // If any vertex crosses the near plane, reject the whole triangle
    // (PS1 didn't do proper clipping, triangles just disappeared)
    if (v0Behind !== v1Behind || v1Behind !== v2Behind) return true;

    // Screen bounds check (use render resolution)
    const allLeft = v0.position.x < 0 && v1.position.x < 0 && v2.position.x < 0;
    const allRight =
      v0.position.x > this.renderWidth &&
      v1.position.x > this.renderWidth &&
      v2.position.x > this.renderWidth;
    const allTop = v0.position.y < 0 && v1.position.y < 0 && v2.position.y < 0;
    const allBottom =
      v0.position.y > this.renderHeight &&
      v1.position.y > this.renderHeight &&
      v2.position.y > this.renderHeight;

    return allLeft || allRight || allTop || allBottom;
  }

  // Render a mesh with given transformation matrices
  renderMesh(
    mesh: Mesh,
    modelMatrix: Matrix4,
    viewMatrix: Matrix4,
    projMatrix: Matrix4
  ): void {
    const mvp = projMatrix.multiply(viewMatrix).multiply(modelMatrix);

    for (const triangle of mesh.triangles) {
      // Process vertices
      const pv0 = this.processVertex(triangle.v0, mvp, modelMatrix);
      const pv1 = this.processVertex(triangle.v1, mvp, modelMatrix);
      const pv2 = this.processVertex(triangle.v2, mvp, modelMatrix);

      // Frustum culling
      if (this.isOutsideFrustum(pv0, pv1, pv2)) continue;

      // Backface culling
      if (this.enableBackfaceCulling && this.isBackfacing(pv0, pv1, pv2))
        continue;

      // Render
      if (this.wireframe) {
        this.drawWireframeTriangle(pv0, pv1, pv2, Color.white());
      } else {
        this.rasterizeTriangle(pv0, pv1, pv2);
      }
    }
  }

  /**
   * Render lines (for grid, gizmos, etc.)
   * Mesh indices should be pairs of vertices defining line segments
   */
  renderLines(
    mesh: {
      vertices: { position: Vector3; color: Color }[];
      indices: number[];
    },
    modelMatrix: Matrix4,
    viewMatrix: Matrix4,
    projMatrix: Matrix4
  ): void {
    const mvp = projMatrix.multiply(viewMatrix).multiply(modelMatrix);

    for (let i = 0; i < mesh.indices.length; i += 2) {
      const v0 = mesh.vertices[mesh.indices[i]];
      const v1 = mesh.vertices[mesh.indices[i + 1]];

      // Transform vertices
      const clip0 = mvp.transformVector4(Vector4.fromVector3(v0.position, 1));
      const clip1 = mvp.transformVector4(Vector4.fromVector3(v1.position, 1));

      // Simple near-plane clipping - skip if both behind
      if (clip0.w < 0.1 && clip1.w < 0.1) continue;

      // Skip if either is behind (simple rejection)
      if (clip0.w < 0.1 || clip1.w < 0.1) continue;

      // Perspective divide
      const ndc0 = clip0.perspectiveDivide();
      const ndc1 = clip1.perspectiveDivide();

      // Viewport transform
      const x0 = (ndc0.x + 1) * 0.5 * this.renderWidth;
      const y0 = (1 - ndc0.y) * 0.5 * this.renderHeight;
      const x1 = (ndc1.x + 1) * 0.5 * this.renderWidth;
      const y1 = (1 - ndc1.y) * 0.5 * this.renderHeight;

      // Simple screen bounds check
      if (
        (x0 < 0 && x1 < 0) ||
        (x0 > this.renderWidth && x1 > this.renderWidth) ||
        (y0 < 0 && y1 < 0) ||
        (y0 > this.renderHeight && y1 > this.renderHeight)
      ) {
        continue;
      }

      this.drawLine(x0, y0, x1, y1, v0.color);
    }
  }

  /**
   * Render points (for vertex visualization in Edit mode)
   * Backface culling is handled by the caller - all vertices passed here are visible
   */
  renderPoints(
    points: {
      vertices: { position: Vector3; color: Color }[];
      indices: number[];
    },
    modelMatrix: Matrix4,
    viewMatrix: Matrix4,
    projMatrix: Matrix4,
    pointSize: number = 2
  ): void {
    const mvp = projMatrix.multiply(viewMatrix).multiply(modelMatrix);

    for (const idx of points.indices) {
      const v = points.vertices[idx];

      // Transform vertex
      const clip = mvp.transformVector4(Vector4.fromVector3(v.position, 1));

      // Skip if behind camera
      if (clip.w < 0.1) continue;

      // Perspective divide
      const ndc = clip.perspectiveDivide();

      // Skip if outside NDC bounds
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) continue;

      // Viewport transform
      const x = Math.floor((ndc.x + 1) * 0.5 * this.renderWidth);
      const y = Math.floor((1 - ndc.y) * 0.5 * this.renderHeight);

      // Draw a square point
      const halfSize = Math.floor(pointSize / 2);
      const color = v.color.toUint32();

      for (let py = -halfSize; py <= halfSize; py++) {
        for (let px = -halfSize; px <= halfSize; px++) {
          const sx = x + px;
          const sy = y + py;
          if (
            sx >= 0 &&
            sx < this.renderWidth &&
            sy >= 0 &&
            sy < this.renderHeight
          ) {
            this.pixels[sy * this.renderWidth + sx] = color;
          }
        }
      }
    }
  }

  /**
   * Render transparent triangles (for face selection highlighting)
   * Uses alpha blending with the existing pixel buffer
   */
  renderTransparentTriangles(
    triangles: {
      vertices: { position: Vector3; color: Color }[];
      indices: number[];
    },
    modelMatrix: Matrix4,
    viewMatrix: Matrix4,
    projMatrix: Matrix4,
    alpha: number = 0.3
  ): void {
    const mvp = projMatrix.multiply(viewMatrix).multiply(modelMatrix);
    const { renderWidth, renderHeight, pixels, depthBuffer } = this;

    for (let i = 0; i < triangles.indices.length; i += 3) {
      const v0 = triangles.vertices[triangles.indices[i]];
      const v1 = triangles.vertices[triangles.indices[i + 1]];
      const v2 = triangles.vertices[triangles.indices[i + 2]];

      // Transform vertices
      const clip0 = mvp.transformVector4(Vector4.fromVector3(v0.position, 1));
      const clip1 = mvp.transformVector4(Vector4.fromVector3(v1.position, 1));
      const clip2 = mvp.transformVector4(Vector4.fromVector3(v2.position, 1));

      // Skip if any behind camera (simple rejection)
      if (clip0.w < 0.1 || clip1.w < 0.1 || clip2.w < 0.1) continue;

      // Perspective divide
      const ndc0 = clip0.perspectiveDivide();
      const ndc1 = clip1.perspectiveDivide();
      const ndc2 = clip2.perspectiveDivide();

      // Viewport transform
      const x0 = (ndc0.x + 1) * 0.5 * renderWidth;
      const y0 = (1 - ndc0.y) * 0.5 * renderHeight;
      const x1 = (ndc1.x + 1) * 0.5 * renderWidth;
      const y1 = (1 - ndc1.y) * 0.5 * renderHeight;
      const x2 = (ndc2.x + 1) * 0.5 * renderWidth;
      const y2 = (1 - ndc2.y) * 0.5 * renderHeight;

      // Compute depths for depth testing
      const z0 = ((ndc0.z + 1) * 32767.5) | 0;
      const z1 = ((ndc1.z + 1) * 32767.5) | 0;
      const z2 = ((ndc2.z + 1) * 32767.5) | 0;

      // Bounding box
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(renderWidth - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(renderHeight - 1, Math.ceil(Math.max(y0, y1, y2)));

      if (minX > maxX || minY > maxY) continue;

      // Edge function coefficients
      const A01 = y0 - y1,
        B01 = x1 - x0;
      const A12 = y1 - y2,
        B12 = x2 - x1;
      const A20 = y2 - y0,
        B20 = x0 - x2;

      // Signed area * 2
      const area = A01 * (x2 - x0) + B01 * (y2 - y0);
      if (Math.abs(area) < 0.001) continue; // Degenerate triangle
      const invArea = 1 / area;

      // Get fill color
      const fillR = v0.color.r;
      const fillG = v0.color.g;
      const fillB = v0.color.b;
      const oneMinusAlpha = 1 - alpha;

      // Rasterize with alpha blending
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          // Edge functions
          const w0 = A12 * (x - x1) + B12 * (y - y1);
          const w1 = A20 * (x - x2) + B20 * (y - y2);
          const w2 = A01 * (x - x0) + B01 * (y - y0);

          // Inside test
          if (
            (w0 >= 0 && w1 >= 0 && w2 >= 0) ||
            (w0 <= 0 && w1 <= 0 && w2 <= 0)
          ) {
            // Interpolate depth
            const bw0 = w0 * invArea;
            const bw1 = w1 * invArea;
            const bw2 = w2 * invArea;
            const depth = (z0 * bw0 + z1 * bw1 + z2 * bw2) | 0;

            const idx = y * renderWidth + x;
            // Only draw if close to or in front of existing geometry (with bias)
            if (depth < depthBuffer[idx] + 200) {
              // Read existing pixel
              const existingPixel = pixels[idx];
              const existingR = existingPixel & 0xff;
              const existingG = (existingPixel >> 8) & 0xff;
              const existingB = (existingPixel >> 16) & 0xff;

              // Alpha blend
              const newR = Math.min(
                255,
                (fillR * alpha + existingR * oneMinusAlpha) | 0
              );
              const newG = Math.min(
                255,
                (fillG * alpha + existingG * oneMinusAlpha) | 0
              );
              const newB = Math.min(
                255,
                (fillB * alpha + existingB * oneMinusAlpha) | 0
              );

              pixels[idx] = 0xff000000 | (newB << 16) | (newG << 8) | newR;
            }
          }
        }
      }
    }
  }

  // Resize display canvas (render buffer stays at fixed PS1 resolution)
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    // Keep image smoothing disabled for pixelated scaling
    this.ctx.imageSmoothingEnabled = false;
  }

  // Change the internal render resolution (and update aspect ratio)
  setRenderResolution(width: number, height: number): void {
    this.renderWidth = width;
    this.renderHeight = height;
    this.renderCanvas = new OffscreenCanvas(width, height);
    this.renderCtx = this.renderCanvas.getContext("2d")!;
    this.imageData = this.renderCtx.createImageData(width, height);
    this.pixels = new Uint32Array(this.imageData.data.buffer);
    this.depthBuffer = new Uint16Array(width * height);
  }

  /**
   * Test if a point at screen coordinates (x, y) with given depth is visible (not occluded).
   * Depth should be in the same 16-bit fixed-point format as the depth buffer.
   * Returns true if the point would be visible (passes depth test).
   */
  isPointVisible(screenX: number, screenY: number, depth: number): boolean {
    const x = Math.floor(screenX);
    const y = Math.floor(screenY);

    if (x < 0 || x >= this.renderWidth || y < 0 || y >= this.renderHeight) {
      return false;
    }

    const index = y * this.renderWidth + x;
    // Add a small bias to avoid z-fighting (point slightly in front of surface)
    return depth < this.depthBuffer[index] + 100;
  }

  /**
   * Get the depth value at a screen coordinate.
   * Returns the 16-bit fixed-point depth value, or 0xFFFF if out of bounds.
   */
  getDepthAt(screenX: number, screenY: number): number {
    const x = Math.floor(screenX);
    const y = Math.floor(screenY);

    if (x < 0 || x >= this.renderWidth || y < 0 || y >= this.renderHeight) {
      return 0xffff;
    }

    return this.depthBuffer[y * this.renderWidth + x];
  }
}
