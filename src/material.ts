// Material system for shader node graphs
// Simplified for PS1-style graphics (no PBR)

export type NodeType = "output" | "texture" | "flat-color" | "mix";

export type SocketType = "color" | "float";

export type BlendMode = "mix" | "multiply" | "add";

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

// Shader evaluation context (per-pixel data)
export interface ShaderContext {
  u: number; // UV coordinates
  v: number;
  // Future: texture sampler, vertex color, etc.
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

// Check if a texture node is connected to the material output
export function materialUsesTexture(material: Material): boolean {
  // Find the output node
  const outputNode = material.nodes.find((n) => n.type === "output");
  if (!outputNode) return false;

  // Check if there's a connection to the output's color input
  const connection = material.connections.find(
    (c) => c.toNodeId === outputNode.id && c.toSocketId === "color"
  );
  if (!connection) return false;

  // Check if the source is a texture node
  const sourceNode = material.nodes.find((n) => n.id === connection.fromNodeId);
  return sourceNode?.type === "texture";
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
      // TODO: Sample texture at UV coordinates
      // For now, return a checkerboard pattern to indicate "texture here"
      const checker = (Math.floor(ctx.u * 8) + Math.floor(ctx.v * 8)) % 2 === 0;
      return checker
        ? { r: 200, g: 200, b: 200, a: 255 }
        : { r: 100, g: 100, b: 100, a: 255 };
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

    case "output":
      // Output node shouldn't be evaluated as a source
      return { r: 255, g: 0, b: 255, a: 255 };

    default:
      return { r: 255, g: 0, b: 255, a: 255 };
  }
}

// Convert hex color string to RGBA
function hexToRGBA(hex: string): RGBA {
  // Remove # if present
  const h = hex.replace("#", "");

  // Parse hex values
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const a = h.length >= 8 ? parseInt(h.substring(6, 8), 16) : 255;

  return { r, g, b, a };
}

// Blend two colors based on blend mode
function blendColors(
  color1: RGBA,
  color2: RGBA,
  mode: BlendMode,
  factor: number
): RGBA {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

  switch (mode) {
    case "multiply":
      // Multiply: color1 * color2 (common for texture * tint)
      return {
        r: clamp((color1.r * color2.r) / 255),
        g: clamp((color1.g * color2.g) / 255),
        b: clamp((color1.b * color2.b) / 255),
        a: clamp((color1.a * color2.a) / 255),
      };

    case "add":
      // Additive blend
      return {
        r: clamp(color1.r + color2.r * factor),
        g: clamp(color1.g + color2.g * factor),
        b: clamp(color1.b + color2.b * factor),
        a: clamp(color1.a),
      };

    case "mix":
    default:
      // Linear interpolation
      return {
        r: clamp(color1.r * (1 - factor) + color2.r * factor),
        g: clamp(color1.g * (1 - factor) + color2.g * factor),
        b: clamp(color1.b * (1 - factor) + color2.b * factor),
        a: clamp(color1.a * (1 - factor) + color2.a * factor),
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
      x: 500,
      y: 150,
      width: 140,
      height: 80,
      inputs: [{ id: "color", name: "Color", type: "color", isInput: true }],
      outputs: [],
      data: {},
    });

    // If has texture, create texture node and connect it
    if (mtlMaterial.diffuseTexturePath) {
      nodes.push({
        id: "texture-1",
        type: "texture",
        x: 150,
        y: 100,
        width: 160,
        height: 80,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: {
          imagePath: mtlMaterial.diffuseTexturePath,
          textureId: textureRegistry?.get(mtlMaterial.diffuseTexturePath),
        },
      });

      connections.push({
        id: "conn-1",
        fromNodeId: "texture-1",
        fromSocketId: "color",
        toNodeId: "output-1",
        toSocketId: "color",
      });

      // Also add flat color node (not connected) for reference
      if (mtlMaterial.diffuseColor) {
        const colorHex = rgbToHex(mtlMaterial.diffuseColor);
        nodes.push({
          id: "flat-color-1",
          type: "flat-color",
          x: 150,
          y: 220,
          width: 160,
          height: 100,
          inputs: [],
          outputs: [
            { id: "color", name: "Color", type: "color", isInput: false },
          ],
          data: { color: colorHex },
        });
      }
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
