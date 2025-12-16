// Material system for shader node graphs
// Simplified for PS1-style graphics (no PBR)

import { Texture } from "./texture";

export type NodeType =
  | "output"
  | "texture"
  | "flat-color"
  | "mix"
  | "color-ramp";

export type SocketType = "color" | "float";

export type BlendMode = "mix" | "multiply" | "add";

// Color stop for color ramp gradients
export interface ColorStop {
  position: number; // 0-1
  color: string; // hex color
}

export interface Socket {
  id: string;
  name: string;
  type: SocketType;
  isInput: boolean;
}

export interface ShaderNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  inputs: Socket[];
  outputs: Socket[];
  data: Record<string, unknown>;
}

export interface NodeConnection {
  id: string;
  fromNodeId: string;
  fromSocketId: string;
  toNodeId: string;
  toSocketId: string;
}

export interface Material {
  id: string;
  name: string;
  nodes: ShaderNode[];
  connections: NodeConnection[];
}

// RGBA color type for evaluation results
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Texture sampler - maps texture node IDs to loaded textures
export type TextureSampler = Map<string, Texture>;

// Shader evaluation context (per-pixel data)
export interface ShaderContext {
  u: number; // UV coordinates
  v: number;
  textures?: TextureSampler; // Optional texture sampler for texture nodes
}

// Evaluate a material's node graph and return the final color
export function evaluateMaterial(material: Material, ctx: ShaderContext): RGBA {
  // Find the output node
  const outputNode = material.nodes.find((n) => n.type === "output");
  if (!outputNode) {
    return { r: 255, g: 0, b: 255, a: 255 }; // Magenta = error
  }

  // Evaluate the color input of the output node
  const colorSocket = outputNode.inputs.find((s) => s.id === "color");
  if (!colorSocket) {
    return { r: 255, g: 0, b: 255, a: 255 };
  }

  return evaluateSocket(material, outputNode.id, colorSocket.id, ctx);
}

// Check if a texture node is connected to the material output (directly or through other nodes)
export function materialUsesTexture(material: Material): boolean {
  // Find the output node
  const outputNode = material.nodes.find((n) => n.type === "output");
  if (!outputNode) return false;

  // Recursively check if any texture node is in the chain leading to output
  const visited = new Set<string>();

  function hasTextureInChain(nodeId: string, socketId: string): boolean {
    const key = `${nodeId}:${socketId}`;
    if (visited.has(key)) return false;
    visited.add(key);

    // Find connection to this socket
    const connection = material.connections.find(
      (c) => c.toNodeId === nodeId && c.toSocketId === socketId
    );
    if (!connection) return false;

    // Find source node
    const sourceNode = material.nodes.find(
      (n) => n.id === connection.fromNodeId
    );
    if (!sourceNode) return false;

    // If it's a texture node, we found it
    if (sourceNode.type === "texture") return true;

    // If it's a mix node, check both inputs
    if (sourceNode.type === "mix") {
      return (
        hasTextureInChain(sourceNode.id, "color1") ||
        hasTextureInChain(sourceNode.id, "color2")
      );
    }

    return false;
  }

  return hasTextureInChain(outputNode.id, "color");
}

/**
 * Bake a material's node graph to a texture
 *
 * This evaluates the entire node graph at every pixel, allowing procedural
 * nodes (noise, gradients, etc.) and texture combinations to be pre-computed.
 * The resulting texture can then be uploaded to the WASM rasterizer.
 *
 * @param material The material to bake
 * @param width Output texture width
 * @param height Output texture height
 * @param textures Map of texture IDs/paths to loaded Texture objects
 * @returns A new Texture containing the baked result
 */
export function bakeMaterialToTexture(
  material: Material,
  width: number,
  height: number,
  textures?: TextureSampler
): Texture {
  const result = new Texture(width, height);
  const data = result.getData();

  // Evaluate material at each pixel
  for (let y = 0; y < height; y++) {
    // V coordinate (0 at bottom, 1 at top - OpenGL convention)
    const v = 1 - (y + 0.5) / height;

    for (let x = 0; x < width; x++) {
      // U coordinate (0 at left, 1 at right)
      const u = (x + 0.5) / width;

      // Evaluate material at this UV
      const color = evaluateMaterial(material, { u, v, textures });

      // Write to output texture
      const idx = (y * width + x) * 4;
      data[idx] = color.r;
      data[idx + 1] = color.g;
      data[idx + 2] = color.b;
      data[idx + 3] = color.a;
    }
  }

  result.loaded = true;
  return result;
}

/**
 * Check if a material needs baking (has procedural nodes or texture mixing)
 * Simple materials (just flat color or direct texture) don't need baking
 */
export function materialNeedsBaking(material: Material): boolean {
  // Find the output node
  const outputNode = material.nodes.find((n) => n.type === "output");
  if (!outputNode) return false;

  // Find what's connected to the output
  const connection = material.connections.find(
    (c) => c.toNodeId === outputNode.id && c.toSocketId === "color"
  );
  if (!connection) return false;

  const sourceNode = material.nodes.find((n) => n.id === connection.fromNodeId);
  if (!sourceNode) return false;

  // Simple cases that don't need baking:
  // - Direct flat-color connection
  // - Direct texture connection (rasterizer handles this)
  if (sourceNode.type === "flat-color") return false;
  if (sourceNode.type === "texture") return false;

  // Mix nodes and any other nodes need baking
  return true;
}

// Evaluate a specific socket by tracing connections
function evaluateSocket(
  material: Material,
  nodeId: string,
  socketId: string,
  ctx: ShaderContext
): RGBA {
  // Find connection to this socket
  const connection = material.connections.find(
    (c) => c.toNodeId === nodeId && c.toSocketId === socketId
  );

  if (!connection) {
    // No connection - return default gray
    return { r: 128, g: 128, b: 128, a: 255 };
  }

  // Find the source node
  const sourceNode = material.nodes.find((n) => n.id === connection.fromNodeId);
  if (!sourceNode) {
    return { r: 128, g: 128, b: 128, a: 255 };
  }

  // Evaluate the source node
  return evaluateNode(material, sourceNode, connection.fromSocketId, ctx);
}

// Evaluate a node's output
function evaluateNode(
  material: Material,
  node: ShaderNode,
  outputSocketId: string,
  ctx: ShaderContext
): RGBA {
  switch (node.type) {
    case "flat-color": {
      const colorHex = (node.data.color as string) || "#808080";
      return hexToRGBA(colorHex);
    }

    case "texture": {
      // Get texture from context sampler
      const textureId = node.data.textureId as string | undefined;
      const imagePath = node.data.imagePath as string | undefined;

      // Try to find texture by ID first, then by path
      let texture: Texture | undefined;
      if (ctx.textures) {
        if (textureId) {
          texture = ctx.textures.get(textureId);
        }
        if (!texture && imagePath) {
          texture = ctx.textures.get(imagePath);
        }
      }

      if (texture && texture.loaded) {
        // Sample texture at UV coordinates
        const color = texture.sample(ctx.u, ctx.v);
        return { r: color.r, g: color.g, b: color.b, a: color.a };
      }

      // No texture available - return checkerboard pattern to indicate missing texture
      const checker = (Math.floor(ctx.u * 8) + Math.floor(ctx.v * 8)) % 2 === 0;
      return checker
        ? { r: 255, g: 0, b: 255, a: 255 } // Magenta
        : { r: 0, g: 0, b: 0, a: 255 }; // Black
    }

    case "mix": {
      // Get blend mode and factor
      const blendMode = (node.data.blendMode as BlendMode) || "multiply";
      const factor = (node.data.factor as number) ?? 1.0;

      // Evaluate input colors
      const color1 = evaluateSocket(material, node.id, "color1", ctx);
      const color2 = evaluateSocket(material, node.id, "color2", ctx);

      return blendColors(color1, color2, blendMode, factor);
    }

    case "color-ramp": {
      // Get color stops from node data
      const stops = (node.data.stops as ColorStop[]) || [
        { position: 0, color: "#000000" },
        { position: 1, color: "#ffffff" },
      ];

      // Evaluate the factor input (0-1 value)
      const factorColor = evaluateSocket(material, node.id, "fac", ctx);
      // Use luminance of input color as factor (allows connecting any color output)
      const factor = Math.max(0, Math.min(1, factorColor.r / 255));

      return evaluateColorRamp(stops, factor);
    }

    case "output":
      // Output node shouldn't be evaluated as a source
      return { r: 255, g: 0, b: 255, a: 255 };

    default:
      return { r: 255, g: 0, b: 255, a: 255 };
  }
}

// Cache for hex to RGBA conversions
const hexToRGBACache = new Map<string, RGBA>();

// Convert hex color string to RGBA (cached)
function hexToRGBA(hex: string): RGBA {
  const cached = hexToRGBACache.get(hex);
  if (cached) return cached;

  // Remove # if present
  const h = hex.replace("#", "");

  // Parse hex values
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const a = h.length >= 8 ? parseInt(h.substring(6, 8), 16) : 255;

  const result = { r, g, b, a };
  hexToRGBACache.set(hex, result);
  return result;
}

// Evaluate color ramp gradient at a given position
// Cache for pre-processed color ramp data
interface ProcessedColorRamp {
  sortedStops: Array<{ position: number; color: RGBA }>;
}
const colorRampCache = new Map<string, ProcessedColorRamp>();

function getProcessedColorRamp(stops: ColorStop[]): ProcessedColorRamp {
  // Create cache key from stops
  const key = stops.map((s) => `${s.position}:${s.color}`).join("|");
  const cached = colorRampCache.get(key);
  if (cached) return cached;

  // Pre-process: sort and convert colors to RGBA
  const sortedStops = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ position: s.position, color: hexToRGBA(s.color) }));

  const result = { sortedStops };
  colorRampCache.set(key, result);
  return result;
}

function evaluateColorRamp(stops: ColorStop[], position: number): RGBA {
  const { sortedStops } = getProcessedColorRamp(stops);

  if (sortedStops.length === 0) {
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  // Clamp position to 0-1
  position = Math.max(0, Math.min(1, position));

  // Find surrounding stops
  let lowStop = sortedStops[0];
  let highStop = sortedStops[sortedStops.length - 1];

  for (let i = 0; i < sortedStops.length - 1; i++) {
    if (
      position >= sortedStops[i].position &&
      position <= sortedStops[i + 1].position
    ) {
      lowStop = sortedStops[i];
      highStop = sortedStops[i + 1];
      break;
    }
  }

  // If position is before first or after last stop
  if (position <= lowStop.position) {
    return lowStop.color;
  }
  if (position >= highStop.position) {
    return highStop.color;
  }

  // Interpolate between stops
  const range = highStop.position - lowStop.position;
  const t = range > 0 ? (position - lowStop.position) / range : 0;

  const lowColor = lowStop.color;
  const highColor = highStop.color;

  return {
    r: Math.round(lowColor.r + (highColor.r - lowColor.r) * t),
    g: Math.round(lowColor.g + (highColor.g - lowColor.g) * t),
    b: Math.round(lowColor.b + (highColor.b - lowColor.b) * t),
    a: Math.round(lowColor.a + (highColor.a - lowColor.a) * t),
  };
}

// Helper to clamp color values (defined once, not per call)
const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

// Blend two colors based on blend mode
function blendColors(
  color1: RGBA,
  color2: RGBA,
  mode: BlendMode,
  factor: number
): RGBA {
  switch (mode) {
    case "multiply":
      // Multiply: color1 * color2 (common for texture * tint)
      return {
        r: clamp255((color1.r * color2.r) / 255),
        g: clamp255((color1.g * color2.g) / 255),
        b: clamp255((color1.b * color2.b) / 255),
        a: clamp255((color1.a * color2.a) / 255),
      };

    case "add":
      // Additive blend
      return {
        r: clamp255(color1.r + color2.r * factor),
        g: clamp255(color1.g + color2.g * factor),
        b: clamp255(color1.b + color2.b * factor),
        a: clamp255(color1.a),
      };

    case "mix":
    default:
      // Linear interpolation
      return {
        r: clamp255(color1.r * (1 - factor) + color2.r * factor),
        g: clamp255(color1.g * (1 - factor) + color2.g * factor),
        b: clamp255(color1.b * (1 - factor) + color2.b * factor),
        a: clamp255(color1.a * (1 - factor) + color2.a * factor),
      };
  }
}

// Global material registry
export class MaterialRegistry {
  private materials: Map<string, Material> = new Map();
  private nextId: number = 1;

  constructor() {
    // Create default material
    const defaultMat = this.createMaterial("Material");
    this.materials.set(defaultMat.id, defaultMat);
  }

  // Create a new material and add to registry
  createMaterial(name: string = "Material"): Material {
    // Generate unique name if needed
    let finalName = name;
    let counter = 1;
    while (this.getByName(finalName)) {
      finalName = `${name}.${String(counter).padStart(3, "0")}`;
      counter++;
    }

    const material = createDefaultMaterialData(
      `mat-${this.nextId++}`,
      finalName
    );
    this.materials.set(material.id, material);
    return material;
  }

  // Get material by ID
  get(id: string): Material | undefined {
    return this.materials.get(id);
  }

  // Get material by name
  getByName(name: string): Material | undefined {
    for (const mat of this.materials.values()) {
      if (mat.name === name) return mat;
    }
    return undefined;
  }

  // Get all materials
  getAll(): Material[] {
    return Array.from(this.materials.values());
  }

  // Update a material
  update(material: Material): void {
    if (this.materials.has(material.id)) {
      this.materials.set(material.id, material);
    }
  }

  // Delete a material (can't delete last one)
  delete(id: string): boolean {
    if (this.materials.size <= 1) return false;
    return this.materials.delete(id);
  }

  // Get default material (first one)
  getDefault(): Material {
    return this.materials.values().next().value!;
  }

  // Duplicate a material
  duplicate(id: string): Material | undefined {
    const source = this.materials.get(id);
    if (!source) return undefined;

    const newMaterial = this.createMaterial(source.name);
    newMaterial.nodes = JSON.parse(JSON.stringify(source.nodes));
    newMaterial.connections = JSON.parse(JSON.stringify(source.connections));
    this.materials.set(newMaterial.id, newMaterial);
    return newMaterial;
  }

  // Create material from MTL data (OBJ file import)
  createFromMTL(
    mtlMaterial: {
      name: string;
      diffuseColor?: { r: number; g: number; b: number };
      diffuseTexturePath?: string;
      textureWidth?: number;
      textureHeight?: number;
    },
    textureRegistry?: Map<string, string> // texturePath -> textureId mapping
  ): Material {
    const name = mtlMaterial.name || "Imported Material";
    const id = `mat-${this.nextId++}`;

    const nodes: ShaderNode[] = [];
    const connections: NodeConnection[] = [];

    // Output node (always present)
    nodes.push({
      id: "output-1",
      type: "output",
      x: 600,
      y: 150,
      width: 140,
      height: 80,
      inputs: [{ id: "color", name: "Color", type: "color", isInput: true }],
      outputs: [],
      data: {},
    });

    // If has both texture AND color, use Mix node (Multiply mode - PS1 style)
    if (mtlMaterial.diffuseTexturePath && mtlMaterial.diffuseColor) {
      const colorHex = rgbToHex(mtlMaterial.diffuseColor);

      // Texture node
      nodes.push({
        id: "texture-1",
        type: "texture",
        x: 100,
        y: 80,
        width: 180,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: {
          imagePath: mtlMaterial.diffuseTexturePath,
          textureId: textureRegistry?.get(mtlMaterial.diffuseTexturePath),
          textureWidth: mtlMaterial.textureWidth || 0,
          textureHeight: mtlMaterial.textureHeight || 0,
        },
      });

      // Flat color node
      nodes.push({
        id: "flat-color-1",
        type: "flat-color",
        x: 100,
        y: 200,
        width: 160,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { color: colorHex },
      });

      // Mix node (Multiply mode)
      nodes.push({
        id: "mix-1",
        type: "mix",
        x: 350,
        y: 130,
        width: 160,
        height: 120,
        inputs: [
          { id: "color1", name: "Color1", type: "color", isInput: true },
          { id: "color2", name: "Color2", type: "color", isInput: true },
        ],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { blendMode: "multiply", factor: 1.0 },
      });

      // Connect: Texture -> Mix.Color1, FlatColor -> Mix.Color2, Mix -> Output
      connections.push(
        {
          id: "conn-1",
          fromNodeId: "texture-1",
          fromSocketId: "color",
          toNodeId: "mix-1",
          toSocketId: "color1",
        },
        {
          id: "conn-2",
          fromNodeId: "flat-color-1",
          fromSocketId: "color",
          toNodeId: "mix-1",
          toSocketId: "color2",
        },
        {
          id: "conn-3",
          fromNodeId: "mix-1",
          fromSocketId: "color",
          toNodeId: "output-1",
          toSocketId: "color",
        }
      );
    } else if (mtlMaterial.diffuseTexturePath) {
      // Only texture, no color
      nodes.push({
        id: "texture-1",
        type: "texture",
        x: 150,
        y: 100,
        width: 180,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: {
          imagePath: mtlMaterial.diffuseTexturePath,
          textureId: textureRegistry?.get(mtlMaterial.diffuseTexturePath),
          textureWidth: mtlMaterial.textureWidth || 0,
          textureHeight: mtlMaterial.textureHeight || 0,
        },
      });

      connections.push({
        id: "conn-1",
        fromNodeId: "texture-1",
        fromSocketId: "color",
        toNodeId: "output-1",
        toSocketId: "color",
      });
    } else if (mtlMaterial.diffuseColor) {
      // No texture, just flat color
      const colorHex = rgbToHex(mtlMaterial.diffuseColor);
      nodes.push({
        id: "flat-color-1",
        type: "flat-color",
        x: 150,
        y: 150,
        width: 160,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { color: colorHex },
      });

      connections.push({
        id: "conn-1",
        fromNodeId: "flat-color-1",
        fromSocketId: "color",
        toNodeId: "output-1",
        toSocketId: "color",
      });
    } else {
      // No color or texture, use default gray
      nodes.push({
        id: "flat-color-1",
        type: "flat-color",
        x: 150,
        y: 150,
        width: 160,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { color: "#808080" },
      });

      connections.push({
        id: "conn-1",
        fromNodeId: "flat-color-1",
        fromSocketId: "color",
        toNodeId: "output-1",
        toSocketId: "color",
      });
    }

    const material: Material = {
      id,
      name,
      nodes,
      connections,
    };

    this.materials.set(id, material);
    return material;
  }
}

// Convert RGB object to hex string
function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const r = Math.min(255, Math.max(0, Math.round(rgb.r)))
    .toString(16)
    .padStart(2, "0");
  const g = Math.min(255, Math.max(0, Math.round(rgb.g)))
    .toString(16)
    .padStart(2, "0");
  const b = Math.min(255, Math.max(0, Math.round(rgb.b)))
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

// Create default material data with Flat Color connected to output
function createDefaultMaterialData(id: string, name: string): Material {
  return {
    id,
    name,
    nodes: [
      {
        id: "output-1",
        type: "output",
        x: 400,
        y: 150,
        width: 140,
        height: 80,
        inputs: [{ id: "color", name: "Color", type: "color", isInput: true }],
        outputs: [],
        data: {},
      },
      {
        id: "flat-color-1",
        type: "flat-color",
        x: 150,
        y: 150,
        width: 160,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { color: "#808080" },
      },
    ],
    connections: [
      {
        id: "conn-1",
        fromNodeId: "flat-color-1",
        fromSocketId: "color",
        toNodeId: "output-1",
        toSocketId: "color",
      },
    ],
  };
}

// Legacy function for backwards compatibility - creates standalone material
export function createDefaultMaterial(name: string = "Material"): Material {
  return createDefaultMaterialData(`mat-standalone-${Date.now()}`, name);
}
