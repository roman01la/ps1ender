#!/usr/bin/env npx tsx
/**
 * PS1ender MCP Server - Model Context Protocol server for headless rendering
 *
 * This server exposes the PS1ender headless renderer and editor functionality
 * to AI agents for visual debugging and scene manipulation.
 *
 * Run with: npx tsx src/mcp-server.ts
 *
 * Tools provided:
 * - render_scene: Render current scene to PNG
 * - add_primitive: Add a primitive mesh (cube, sphere, etc.)
 * - delete_object: Remove an object from the scene
 * - list_objects: List all objects in the scene
 * - transform_object: Move/rotate/scale an object
 * - select_object: Select an object by name
 * - deselect_all: Deselect all objects
 * - set_camera: Configure camera position/target
 * - set_view: Set predefined camera view (front, top, etc.)
 * - get_scene_info: Get detailed scene information
 * - set_render_settings: Configure rendering options
 * - create_material: Create a new material
 * - set_object_material: Assign material to object
 * - set_material_color: Set material flat color
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  HeadlessRenderer,
  HeadlessRenderSettings,
} from "./headless-rasterizer";
import { Scene, SceneObject, Camera } from "./scene";
import { Vector3, Color } from "./math";
import {
  createPlaneMesh,
  createCubeMesh,
  createCircleMesh,
  createUVSphereMesh,
  createIcoSphereMesh,
  createCylinderMesh,
  createConeMesh,
  createTorusMesh,
  Mesh,
} from "./primitives";

// ============================================================================
// Types
// ============================================================================

interface Vector3Input {
  x: number;
  y: number;
  z: number;
}

interface PrimitiveSettings {
  size?: number;
  radius?: number;
  depth?: number;
  segments?: number;
  rings?: number;
  capFill?: "none" | "ngon" | "trifan";
  majorRadius?: number;
  minorRadius?: number;
  majorSegments?: number;
  minorSegments?: number;
}

// ============================================================================
// Scene Manager - Maintains state between tool calls
// ============================================================================

class SceneManager {
  public scene: Scene;
  public renderer: HeadlessRenderer | null = null;
  public renderWidth: number = 640;
  public renderHeight: number = 480;

  constructor() {
    this.scene = new Scene();
  }

  async ensureRenderer(): Promise<HeadlessRenderer> {
    if (!this.renderer) {
      this.renderer = await HeadlessRenderer.create(
        this.renderWidth,
        this.renderHeight,
        "wasm/rasterizer.wasm"
      );
    }
    return this.renderer;
  }

  getObjectByName(name: string): SceneObject | undefined {
    return this.scene.objects.find((obj) => obj.name === name);
  }

  generateUniqueName(baseName: string): string {
    let name = baseName;
    let counter = 1;
    while (this.getObjectByName(name)) {
      name = `${baseName}.${String(counter).padStart(3, "0")}`;
      counter++;
    }
    return name;
  }
}

// Global scene manager
const sceneManager = new SceneManager();

// ============================================================================
// Primitive Factory
// ============================================================================

function createPrimitive(
  type: string,
  settings: PrimitiveSettings = {}
): Mesh | null {
  switch (type.toLowerCase()) {
    case "plane":
      return createPlaneMesh(settings.size ?? 2);

    case "cube":
      return createCubeMesh(settings.size ?? 2);

    case "circle":
      return createCircleMesh(settings.radius ?? 1, settings.segments ?? 32);

    case "uvsphere":
    case "sphere":
      return createUVSphereMesh(
        settings.radius ?? 1,
        settings.segments ?? 32,
        settings.rings ?? 16
      );

    case "icosphere":
      return createIcoSphereMesh(settings.radius ?? 1, settings.segments ?? 2);

    case "cylinder":
      return createCylinderMesh(
        settings.radius ?? 1,
        settings.depth ?? 2,
        settings.segments ?? 32
      );

    case "cone":
      return createConeMesh(
        settings.radius ?? 1,
        0, // radius2 (tip)
        settings.depth ?? 2,
        settings.segments ?? 32
      );

    case "torus":
      return createTorusMesh(
        settings.majorRadius ?? 1,
        settings.minorRadius ?? 0.25,
        settings.majorSegments ?? 48,
        settings.minorSegments ?? 12
      );

    default:
      return null;
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

const tools: Tool[] = [
  {
    name: "render_scene",
    description:
      "Render the current scene to a PNG image and return it as base64. Useful for visual debugging and verification.",
    inputSchema: {
      type: "object" as const,
      properties: {
        width: {
          type: "number",
          description: "Render width in pixels (default: 640)",
        },
        height: {
          type: "number",
          description: "Render height in pixels (default: 480)",
        },
        savePath: {
          type: "string",
          description:
            "Optional file path to save the PNG (e.g., 'output.png')",
        },
      },
    },
  },
  {
    name: "add_primitive",
    description:
      "Add a primitive mesh to the scene. Supported types: plane, cube, circle, sphere (uvsphere), icosphere, cylinder, cone, torus.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          description:
            "Primitive type: plane, cube, circle, sphere, icosphere, cylinder, cone, torus",
          enum: [
            "plane",
            "cube",
            "circle",
            "sphere",
            "icosphere",
            "cylinder",
            "cone",
            "torus",
          ],
        },
        name: {
          type: "string",
          description: "Name for the object (auto-generated if not provided)",
        },
        position: {
          type: "object",
          description: "Position in 3D space {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        rotation: {
          type: "object",
          description: "Rotation in radians {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        scale: {
          type: "object",
          description: "Scale {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        settings: {
          type: "object",
          description: "Primitive-specific settings",
          properties: {
            size: { type: "number", description: "Size for cube/plane" },
            radius: {
              type: "number",
              description: "Radius for sphere/cylinder/cone/circle",
            },
            depth: { type: "number", description: "Depth for cylinder/cone" },
            segments: {
              type: "number",
              description: "Number of segments (radial divisions)",
            },
            rings: {
              type: "number",
              description: "Number of rings (for UV sphere)",
            },
            capFill: {
              type: "string",
              enum: ["none", "ngon", "trifan"],
              description: "Cap fill type for cylinder/cone/circle",
            },
            majorRadius: {
              type: "number",
              description: "Major radius for torus",
            },
            minorRadius: {
              type: "number",
              description: "Minor radius for torus",
            },
            majorSegments: {
              type: "number",
              description: "Major segments for torus",
            },
            minorSegments: {
              type: "number",
              description: "Minor segments for torus",
            },
          },
        },
      },
      required: ["type"],
    },
  },
  {
    name: "delete_object",
    description: "Remove an object from the scene by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the object to delete",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_objects",
    description: "List all objects in the scene with their properties.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "transform_object",
    description: "Transform an object (move, rotate, scale).",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the object to transform",
        },
        position: {
          type: "object",
          description: "New position {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        rotation: {
          type: "object",
          description: "New rotation in radians {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        scale: {
          type: "object",
          description: "New scale {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        relative: {
          type: "boolean",
          description:
            "If true, apply transforms relative to current values (default: false)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "select_object",
    description: "Select an object by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the object to select",
        },
        addToSelection: {
          type: "boolean",
          description:
            "If true, add to current selection instead of replacing it",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "deselect_all",
    description: "Deselect all objects in the scene.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "set_camera",
    description: "Configure camera position and target.",
    inputSchema: {
      type: "object" as const,
      properties: {
        position: {
          type: "object",
          description: "Camera position {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        target: {
          type: "object",
          description: "Camera look-at target {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        fov: {
          type: "number",
          description: "Field of view in degrees (default: 60)",
        },
        orthographic: {
          type: "boolean",
          description: "Use orthographic projection",
        },
        orthoSize: {
          type: "number",
          description: "Orthographic view half-height",
        },
      },
    },
  },
  {
    name: "set_view",
    description:
      "Set camera to a predefined viewpoint (Blender-style numpad views).",
    inputSchema: {
      type: "object" as const,
      properties: {
        view: {
          type: "string",
          description: "Viewpoint name",
          enum: ["front", "back", "right", "left", "top", "bottom", "persp"],
        },
      },
      required: ["view"],
    },
  },
  {
    name: "get_scene_info",
    description:
      "Get detailed information about the scene, objects, camera, and materials.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "set_render_settings",
    description: "Configure rendering options (PS1-style effects).",
    inputSchema: {
      type: "object" as const,
      properties: {
        enableLighting: {
          type: "boolean",
          description: "Enable directional lighting",
        },
        enableDithering: {
          type: "boolean",
          description: "Enable PS1-style dithering",
        },
        enableBackfaceCulling: {
          type: "boolean",
          description: "Enable backface culling",
        },
        enableVertexSnapping: {
          type: "boolean",
          description: "Enable PS1-style vertex snapping",
        },
        enableSmoothShading: {
          type: "boolean",
          description: "Enable Gouraud (smooth) shading",
        },
        ambientLight: {
          type: "number",
          description: "Ambient light intensity (0-1)",
        },
        snapResolutionX: {
          type: "number",
          description: "Vertex snap resolution X (PS1: 320)",
        },
        snapResolutionY: {
          type: "number",
          description: "Vertex snap resolution Y (PS1: 240)",
        },
        lightDirection: {
          type: "object",
          description: "Light direction vector {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        lightIntensity: {
          type: "number",
          description: "Light intensity (0-1)",
        },
        clearColor: {
          type: "object",
          description: "Background color {r, g, b} (0-255)",
          properties: {
            r: { type: "number" },
            g: { type: "number" },
            b: { type: "number" },
          },
        },
      },
    },
  },
  {
    name: "create_material",
    description: "Create a new material and return its ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Material name",
        },
        color: {
          type: "object",
          description: "Flat color {r, g, b} (0-255)",
          properties: {
            r: { type: "number" },
            g: { type: "number" },
            b: { type: "number" },
          },
        },
      },
    },
  },
  {
    name: "set_object_material",
    description: "Assign a material to an object.",
    inputSchema: {
      type: "object" as const,
      properties: {
        objectName: {
          type: "string",
          description: "Name of the object",
        },
        materialId: {
          type: "string",
          description: "Material ID to assign",
        },
      },
      required: ["objectName", "materialId"],
    },
  },
  {
    name: "set_object_color",
    description:
      "Set vertex colors for an object (flat shading without materials).",
    inputSchema: {
      type: "object" as const,
      properties: {
        objectName: {
          type: "string",
          description: "Name of the object",
        },
        color: {
          type: "object",
          description: "Color {r, g, b} (0-255) or {r, g, b, a}",
          properties: {
            r: { type: "number" },
            g: { type: "number" },
            b: { type: "number" },
            a: { type: "number" },
          },
          required: ["r", "g", "b"],
        },
      },
      required: ["objectName", "color"],
    },
  },
  {
    name: "clear_scene",
    description: "Remove all objects from the scene.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "duplicate_object",
    description: "Duplicate an object with optional new position.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the object to duplicate",
        },
        newName: {
          type: "string",
          description:
            "Name for the duplicate (auto-generated if not provided)",
        },
        offset: {
          type: "object",
          description: "Position offset for duplicate {x, y, z}",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
      },
      required: ["name"],
    },
  },
  {
    name: "set_object_visibility",
    description: "Show or hide an object.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the object",
        },
        visible: {
          type: "boolean",
          description: "Whether the object should be visible",
        },
      },
      required: ["name", "visible"],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleRenderScene(args: {
  width?: number;
  height?: number;
  savePath?: string;
}): Promise<{
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
}> {
  const width = args.width ?? 640;
  const height = args.height ?? 480;

  // Update render dimensions if changed
  if (
    width !== sceneManager.renderWidth ||
    height !== sceneManager.renderHeight
  ) {
    sceneManager.renderWidth = width;
    sceneManager.renderHeight = height;
    if (sceneManager.renderer) {
      sceneManager.renderer.resize(width, height);
    }
  }

  const renderer = await sceneManager.ensureRenderer();
  renderer.renderScene(sceneManager.scene.objects, sceneManager.scene.camera);

  const png = renderer.toPNG();

  if (args.savePath) {
    await renderer.savePNG(args.savePath);
  }

  // Return as base64 image
  const base64 = Buffer.from(png).toString("base64");

  return {
    content: [
      {
        type: "image",
        data: base64,
        mimeType: "image/png",
      },
      {
        type: "text",
        text: `Rendered ${width}x${height} image with ${
          sceneManager.scene.objects.length
        } objects.${args.savePath ? ` Saved to ${args.savePath}` : ""}`,
      },
    ],
  };
}

function handleAddPrimitive(args: {
  type: string;
  name?: string;
  position?: Vector3Input;
  rotation?: Vector3Input;
  scale?: Vector3Input;
  settings?: PrimitiveSettings;
}): { content: Array<{ type: string; text: string }> } {
  const mesh = createPrimitive(args.type, args.settings ?? {});
  if (!mesh) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Unknown primitive type '${args.type}'. Supported: plane, cube, circle, sphere, icosphere, cylinder, cone, torus.`,
        },
      ],
    };
  }

  // Generate name based on type
  const baseName = args.type.charAt(0).toUpperCase() + args.type.slice(1);
  const name = args.name ?? sceneManager.generateUniqueName(baseName);

  const obj = new SceneObject(name, mesh);

  // Apply transforms
  if (args.position) {
    obj.position = new Vector3(
      args.position.x,
      args.position.y,
      args.position.z
    );
  }
  if (args.rotation) {
    obj.rotation = new Vector3(
      args.rotation.x,
      args.rotation.y,
      args.rotation.z
    );
  }
  if (args.scale) {
    obj.scale = new Vector3(args.scale.x, args.scale.y, args.scale.z);
  }

  sceneManager.scene.addObject(obj);

  return {
    content: [
      {
        type: "text",
        text: `Added ${
          args.type
        } '${name}' at position (${obj.position.x.toFixed(
          2
        )}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)}).`,
      },
    ],
  };
}

function handleDeleteObject(args: { name: string }): {
  content: Array<{ type: string; text: string }>;
} {
  const obj = sceneManager.getObjectByName(args.name);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.name}' not found.`,
        },
      ],
    };
  }

  sceneManager.scene.removeObject(obj);

  return {
    content: [
      {
        type: "text",
        text: `Deleted object '${args.name}'.`,
      },
    ],
  };
}

function handleListObjects(): {
  content: Array<{ type: string; text: string }>;
} {
  const objects = sceneManager.scene.objects;

  if (objects.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "Scene is empty (no objects).",
        },
      ],
    };
  }

  const list = objects
    .map((obj, i) => {
      const pos = obj.position;
      const rot = obj.rotation;
      const scale = obj.scale;
      return (
        `${i + 1}. ${obj.name}${obj.selected ? " [selected]" : ""}${
          !obj.visible ? " [hidden]" : ""
        }\n` +
        `   Position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(
          2
        )}, ${pos.z.toFixed(2)})\n` +
        `   Rotation: (${rot.x.toFixed(2)}, ${rot.y.toFixed(
          2
        )}, ${rot.z.toFixed(2)})\n` +
        `   Scale: (${scale.x.toFixed(2)}, ${scale.y.toFixed(
          2
        )}, ${scale.z.toFixed(2)})\n` +
        `   Vertices: ${obj.mesh.vertices.length}, Faces: ${obj.mesh.faceData.length}`
      );
    })
    .join("\n\n");

  return {
    content: [
      {
        type: "text",
        text: `Scene Objects (${objects.length}):\n\n${list}`,
      },
    ],
  };
}

function handleTransformObject(args: {
  name: string;
  position?: Vector3Input;
  rotation?: Vector3Input;
  scale?: Vector3Input;
  relative?: boolean;
}): { content: Array<{ type: string; text: string }> } {
  const obj = sceneManager.getObjectByName(args.name);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.name}' not found.`,
        },
      ],
    };
  }

  const relative = args.relative ?? false;

  if (args.position) {
    const newPos = new Vector3(
      args.position.x,
      args.position.y,
      args.position.z
    );
    obj.position = relative ? obj.position.add(newPos) : newPos;
  }
  if (args.rotation) {
    const newRot = new Vector3(
      args.rotation.x,
      args.rotation.y,
      args.rotation.z
    );
    obj.rotation = relative ? obj.rotation.add(newRot) : newRot;
  }
  if (args.scale) {
    const newScale = new Vector3(args.scale.x, args.scale.y, args.scale.z);
    if (relative) {
      obj.scale = new Vector3(
        obj.scale.x * newScale.x,
        obj.scale.y * newScale.y,
        obj.scale.z * newScale.z
      );
    } else {
      obj.scale = newScale;
    }
  }

  return {
    content: [
      {
        type: "text",
        text:
          `Transformed '${args.name}':\n` +
          `  Position: (${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(
            2
          )}, ${obj.position.z.toFixed(2)})\n` +
          `  Rotation: (${obj.rotation.x.toFixed(2)}, ${obj.rotation.y.toFixed(
            2
          )}, ${obj.rotation.z.toFixed(2)})\n` +
          `  Scale: (${obj.scale.x.toFixed(2)}, ${obj.scale.y.toFixed(
            2
          )}, ${obj.scale.z.toFixed(2)})`,
      },
    ],
  };
}

function handleSelectObject(args: { name: string; addToSelection?: boolean }): {
  content: Array<{ type: string; text: string }>;
} {
  const obj = sceneManager.getObjectByName(args.name);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.name}' not found.`,
        },
      ],
    };
  }

  sceneManager.scene.selectObject(obj, args.addToSelection ?? false);

  return {
    content: [
      {
        type: "text",
        text: `Selected '${args.name}'.`,
      },
    ],
  };
}

function handleDeselectAll(): {
  content: Array<{ type: string; text: string }>;
} {
  sceneManager.scene.deselectAll();

  return {
    content: [
      {
        type: "text",
        text: "Deselected all objects.",
      },
    ],
  };
}

function handleSetCamera(args: {
  position?: Vector3Input;
  target?: Vector3Input;
  fov?: number;
  orthographic?: boolean;
  orthoSize?: number;
}): { content: Array<{ type: string; text: string }> } {
  const camera = sceneManager.scene.camera;

  if (args.position) {
    camera.position = new Vector3(
      args.position.x,
      args.position.y,
      args.position.z
    );
  }
  if (args.target) {
    camera.target = new Vector3(args.target.x, args.target.y, args.target.z);
  }
  if (args.fov !== undefined) {
    camera.fov = args.fov;
  }
  if (args.orthographic !== undefined) {
    camera.orthographic = args.orthographic;
  }
  if (args.orthoSize !== undefined) {
    camera.orthoSize = args.orthoSize;
  }

  return {
    content: [
      {
        type: "text",
        text:
          `Camera updated:\n` +
          `  Position: (${camera.position.x.toFixed(
            2
          )}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(
            2
          )})\n` +
          `  Target: (${camera.target.x.toFixed(2)}, ${camera.target.y.toFixed(
            2
          )}, ${camera.target.z.toFixed(2)})\n` +
          `  FOV: ${camera.fov}°\n` +
          `  Mode: ${
            camera.orthographic
              ? `Orthographic (size: ${camera.orthoSize})`
              : "Perspective"
          }`,
      },
    ],
  };
}

function handleSetView(args: {
  view: "front" | "back" | "right" | "left" | "top" | "bottom" | "persp";
}): { content: Array<{ type: string; text: string }> } {
  sceneManager.scene.camera.setViewpoint(args.view);

  const viewNames: Record<string, string> = {
    front: "Front (Numpad 1)",
    back: "Back (Ctrl+Numpad 1)",
    right: "Right (Numpad 3)",
    left: "Left (Ctrl+Numpad 3)",
    top: "Top (Numpad 7)",
    bottom: "Bottom (Ctrl+Numpad 7)",
    persp: "Perspective (Numpad 0)",
  };

  return {
    content: [
      {
        type: "text",
        text: `Set view to: ${viewNames[args.view]}`,
      },
    ],
  };
}

function handleGetSceneInfo(): {
  content: Array<{ type: string; text: string }>;
} {
  const scene = sceneManager.scene;
  const camera = scene.camera;
  const objects = scene.objects;

  const info = {
    objectCount: objects.length,
    selectedObjects: objects.filter((o) => o.selected).map((o) => o.name),
    activeObject: scene.activeObject?.name ?? null,
    camera: {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      target: {
        x: camera.target.x,
        y: camera.target.y,
        z: camera.target.z,
      },
      fov: camera.fov,
      orthographic: camera.orthographic,
      orthoSize: camera.orthoSize,
    },
    materials: scene.materials.getAll().map((m) => ({
      id: m.id,
      name: m.name,
      nodeCount: m.nodes.length,
    })),
    renderDimensions: {
      width: sceneManager.renderWidth,
      height: sceneManager.renderHeight,
    },
  };

  return {
    content: [
      {
        type: "text",
        text: "Scene Info:\n" + JSON.stringify(info, null, 2),
      },
    ],
  };
}

async function handleSetRenderSettings(args: {
  enableLighting?: boolean;
  enableDithering?: boolean;
  enableBackfaceCulling?: boolean;
  enableVertexSnapping?: boolean;
  enableSmoothShading?: boolean;
  ambientLight?: number;
  snapResolutionX?: number;
  snapResolutionY?: number;
  lightDirection?: Vector3Input;
  lightIntensity?: number;
  clearColor?: { r: number; g: number; b: number };
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const renderer = await sceneManager.ensureRenderer();

  const settings: Partial<HeadlessRenderSettings> = {};

  if (args.enableLighting !== undefined)
    settings.enableLighting = args.enableLighting;
  if (args.enableDithering !== undefined)
    settings.enableDithering = args.enableDithering;
  if (args.enableBackfaceCulling !== undefined)
    settings.enableBackfaceCulling = args.enableBackfaceCulling;
  if (args.enableVertexSnapping !== undefined)
    settings.enableVertexSnapping = args.enableVertexSnapping;
  if (args.enableSmoothShading !== undefined)
    settings.enableSmoothShading = args.enableSmoothShading;
  if (args.ambientLight !== undefined)
    settings.ambientLight = args.ambientLight;
  if (args.snapResolutionX !== undefined)
    settings.snapResolutionX = args.snapResolutionX;
  if (args.snapResolutionY !== undefined)
    settings.snapResolutionY = args.snapResolutionY;
  if (args.lightDirection) {
    settings.lightDirection = [
      args.lightDirection.x,
      args.lightDirection.y,
      args.lightDirection.z,
    ];
  }
  if (args.lightIntensity !== undefined)
    settings.lightIntensity = args.lightIntensity;
  if (args.clearColor) {
    settings.clearColor = [
      args.clearColor.r,
      args.clearColor.g,
      args.clearColor.b,
    ];
  }

  renderer.setSettings(settings);

  return {
    content: [
      {
        type: "text",
        text: "Render settings updated: " + JSON.stringify(settings, null, 2),
      },
    ],
  };
}

function handleCreateMaterial(args: {
  name?: string;
  color?: { r: number; g: number; b: number };
}): { content: Array<{ type: string; text: string }> } {
  const material = sceneManager.scene.materials.createMaterial(
    args.name ?? "Material"
  );

  // If color provided, update the flat-color node
  if (args.color) {
    const flatColorNode = material.nodes.find((n) => n.type === "flat-color");
    if (flatColorNode && flatColorNode.data) {
      const hex =
        "#" +
        args.color.r.toString(16).padStart(2, "0") +
        args.color.g.toString(16).padStart(2, "0") +
        args.color.b.toString(16).padStart(2, "0");
      flatColorNode.data.color = hex;
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Created material '${material.name}' with ID: ${material.id}`,
      },
    ],
  };
}

function handleSetObjectMaterial(args: {
  objectName: string;
  materialId: string;
}): { content: Array<{ type: string; text: string }> } {
  const obj = sceneManager.getObjectByName(args.objectName);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.objectName}' not found.`,
        },
      ],
    };
  }

  const material = sceneManager.scene.materials.get(args.materialId);
  if (!material) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Material '${args.materialId}' not found.`,
        },
      ],
    };
  }

  obj.materialId = args.materialId;

  return {
    content: [
      {
        type: "text",
        text: `Assigned material '${material.name}' to object '${obj.name}'.`,
      },
    ],
  };
}

function handleSetObjectColor(args: {
  objectName: string;
  color: { r: number; g: number; b: number; a?: number };
}): { content: Array<{ type: string; text: string }> } {
  const obj = sceneManager.getObjectByName(args.objectName);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.objectName}' not found.`,
        },
      ],
    };
  }

  const color = new Color(
    args.color.r / 255,
    args.color.g / 255,
    args.color.b / 255,
    (args.color.a ?? 255) / 255
  );

  // Set vertex colors on all vertices
  for (const vertex of obj.mesh.vertices) {
    vertex.color = color.clone();
  }

  // Rebuild triangles to update rendering
  obj.mesh.rebuildTriangles();

  return {
    content: [
      {
        type: "text",
        text: `Set color of '${obj.name}' to RGB(${args.color.r}, ${args.color.g}, ${args.color.b}).`,
      },
    ],
  };
}

function handleClearScene(): {
  content: Array<{ type: string; text: string }>;
} {
  const count = sceneManager.scene.objects.length;
  sceneManager.scene.objects = [];
  sceneManager.scene.activeObject = null;

  return {
    content: [
      {
        type: "text",
        text: `Cleared scene (removed ${count} objects).`,
      },
    ],
  };
}

function handleDuplicateObject(args: {
  name: string;
  newName?: string;
  offset?: Vector3Input;
}): { content: Array<{ type: string; text: string }> } {
  const obj = sceneManager.getObjectByName(args.name);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.name}' not found.`,
        },
      ],
    };
  }

  // Clone mesh
  const newMesh = new (obj.mesh.constructor as typeof Mesh)(
    obj.mesh.vertices.map((v) => v.clone()),
    [...obj.mesh.indices]
  );
  newMesh.faceData = JSON.parse(JSON.stringify(obj.mesh.faceData));
  newMesh.rebuildTriangles();

  // Create new object
  const newName = args.newName ?? sceneManager.generateUniqueName(obj.name);
  const newObj = new SceneObject(newName, newMesh);
  newObj.position = obj.position.clone();
  newObj.rotation = obj.rotation.clone();
  newObj.scale = obj.scale.clone();
  newObj.materialId = obj.materialId;

  // Apply offset
  if (args.offset) {
    newObj.position = newObj.position.add(
      new Vector3(args.offset.x, args.offset.y, args.offset.z)
    );
  }

  sceneManager.scene.addObject(newObj);

  return {
    content: [
      {
        type: "text",
        text: `Duplicated '${obj.name}' as '${newName}'.`,
      },
    ],
  };
}

function handleSetObjectVisibility(args: { name: string; visible: boolean }): {
  content: Array<{ type: string; text: string }>;
} {
  const obj = sceneManager.getObjectByName(args.name);
  if (!obj) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Object '${args.name}' not found.`,
        },
      ],
    };
  }

  obj.visible = args.visible;

  return {
    content: [
      {
        type: "text",
        text: `Set '${obj.name}' visibility to ${
          args.visible ? "visible" : "hidden"
        }.`,
      },
    ],
  };
}

// ============================================================================
// Main Server Setup
// ============================================================================

async function main() {
  const server = new Server(
    {
      name: "ps1ender-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "render_scene":
          return await handleRenderScene(
            args as Parameters<typeof handleRenderScene>[0]
          );

        case "add_primitive":
          return handleAddPrimitive(
            args as Parameters<typeof handleAddPrimitive>[0]
          );

        case "delete_object":
          return handleDeleteObject(
            args as Parameters<typeof handleDeleteObject>[0]
          );

        case "list_objects":
          return handleListObjects();

        case "transform_object":
          return handleTransformObject(
            args as Parameters<typeof handleTransformObject>[0]
          );

        case "select_object":
          return handleSelectObject(
            args as Parameters<typeof handleSelectObject>[0]
          );

        case "deselect_all":
          return handleDeselectAll();

        case "set_camera":
          return handleSetCamera(args as Parameters<typeof handleSetCamera>[0]);

        case "set_view":
          return handleSetView(args as Parameters<typeof handleSetView>[0]);

        case "get_scene_info":
          return handleGetSceneInfo();

        case "set_render_settings":
          return await handleSetRenderSettings(
            args as Parameters<typeof handleSetRenderSettings>[0]
          );

        case "create_material":
          return handleCreateMaterial(
            args as Parameters<typeof handleCreateMaterial>[0]
          );

        case "set_object_material":
          return handleSetObjectMaterial(
            args as Parameters<typeof handleSetObjectMaterial>[0]
          );

        case "set_object_color":
          return handleSetObjectColor(
            args as Parameters<typeof handleSetObjectColor>[0]
          );

        case "clear_scene":
          return handleClearScene();

        case "duplicate_object":
          return handleDuplicateObject(
            args as Parameters<typeof handleDuplicateObject>[0]
          );

        case "set_object_visibility":
          return handleSetObjectVisibility(
            args as Parameters<typeof handleSetObjectVisibility>[0]
          );

        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("PS1ender MCP server started");
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
