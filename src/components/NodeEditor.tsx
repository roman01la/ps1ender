import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Material,
  ShaderNode,
  NodeConnection,
  NodeType,
  SocketType,
  Socket,
  ColorStop,
} from "../material";
import { Texture } from "../texture";
import { historyManager, GenericHistoryStack } from "../systems/history";

// Re-export types for convenience
export type {
  NodeType,
  SocketType,
  ShaderNode as Node,
  NodeConnection as Connection,
};

// Type for shader editor undo state
interface ShaderEditorState {
  nodes: ShaderNode[];
  connections: NodeConnection[];
}

interface NodeEditorProps {
  materials: Material[];
  selectedMaterialId: string | null;
  onSelectMaterial: (id: string) => void;
  onMaterialChange?: (material: Material) => void;
  onNewMaterial?: () => void;
  /** Map of texture names/paths to Texture objects for previews */
  textureMap?: Map<string, Texture>;
}

// Node color scheme (PS1-style simplified)
const NODE_COLORS: Record<NodeType, string> = {
  output: "#6b3a3a",
  texture: "#6b5a3a",
  "flat-color": "#5a3a6b",
  mix: "#3a5a6b",
  "color-ramp": "#3a6b5a",
  voronoi: "#4a4a6b",
  "alpha-cutoff": "#6b4a4a",
  noise: "#4a6b4a",
};

const SOCKET_COLORS: Record<SocketType, string> = {
  color: "#c7c729",
  float: "#a1a1a1",
};

// Node factory (PS1-style simplified)
function createNode(type: NodeType, x: number, y: number): ShaderNode {
  const baseId = `${type}-${Date.now()}`;

  switch (type) {
    case "output":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 140,
        height: 80,
        inputs: [{ id: "color", name: "Color", type: "color", isInput: true }],
        outputs: [],
        data: {},
      };
    case "texture":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 180,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { imagePath: "", textureWidth: 0, textureHeight: 0 },
      };
    case "flat-color":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 160,
        height: 100,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { color: "#808080" },
      };
    case "mix":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 160,
        height: 120,
        inputs: [
          { id: "color1", name: "Color1", type: "color", isInput: true },
          { id: "color2", name: "Color2", type: "color", isInput: true },
        ],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { blendMode: "mix", factor: 0.5 },
      };
    case "color-ramp":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 200,
        height: 140,
        inputs: [{ id: "fac", name: "Fac", type: "float", isInput: true }],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: {
          stops: [
            { position: 0, color: "#000000" },
            { position: 1, color: "#ffffff" },
          ] as ColorStop[],
        },
      };
    case "voronoi":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 160,
        height: 130,
        inputs: [],
        outputs: [
          { id: "color", name: "Distance", type: "float", isInput: false },
        ],
        data: { scale: 5, mode: 0 }, // mode: 0=F1 (distance to point), 1=edge (F2-F1)
      };
    case "alpha-cutoff":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 160,
        height: 110,
        inputs: [{ id: "color", name: "Color", type: "color", isInput: true }],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { threshold: 0.5 }, // 0-1 threshold
      };
    case "noise":
      return {
        id: baseId,
        type,
        x,
        y,
        width: 160,
        height: 150,
        inputs: [],
        outputs: [
          { id: "color", name: "Value", type: "float", isInput: false },
        ],
        data: { scale: 5, octaves: 1, mode: 0 }, // mode: 0=value noise, 1=simplex
      };
    default:
      throw new Error(`Unknown node type: ${type}`);
  }
}

// Get node title
function getNodeTitle(type: NodeType): string {
  switch (type) {
    case "output":
      return "Material Output";
    case "texture":
      return "Texture";
    case "flat-color":
      return "Flat Color";
    case "mix":
      return "Mix";
    case "color-ramp":
      return "Color Ramp";
    case "voronoi":
      return "Voronoi";
    case "alpha-cutoff":
      return "Alpha Cutoff";
    case "noise":
      return "Noise";
    default:
      return type;
  }
}

export function NodeEditor({
  materials,
  selectedMaterialId,
  onSelectMaterial,
  onMaterialChange,
  onNewMaterial,
  textureMap,
}: NodeEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cache for texture preview ImageBitmaps (keyed by texture path)
  const texturePreviewCache = useRef<Map<string, ImageBitmap>>(new Map());

  // Get active material from list
  const material = materials.find((m) => m.id === selectedMaterialId) || null;

  // Editor state - synced with material
  const [nodes, setNodes] = useState<ShaderNode[]>(material?.nodes || []);
  const [connections, setConnections] = useState<NodeConnection[]>(
    material?.connections || []
  );
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    new Set()
  );
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Use global history manager with material-specific stack
  // Stack ID is "shader-editor:{materialId}" so each material has its own history
  const historyStackId = selectedMaterialId
    ? `shader-editor:${selectedMaterialId}`
    : "shader-editor:default";
  const historyStackRef = useRef<GenericHistoryStack<ShaderEditorState> | null>(
    null
  );
  const isUndoingRef = useRef(false);
  const [, forceUpdate] = useState(0); // For re-render on history change

  // Get/create the history stack for the current material
  useEffect(() => {
    historyStackRef.current =
      historyManager.getStack<ShaderEditorState>(historyStackId);
    historyStackRef.current.setOnChange(() => forceUpdate((n) => n + 1));
    return () => {
      historyStackRef.current?.setOnChange(null);
    };
  }, [historyStackId]);

  // Push current state to undo stack (call before making changes)
  const pushUndo = useCallback(() => {
    if (isUndoingRef.current || !historyStackRef.current) return;
    historyStackRef.current.push({ nodes, connections });
  }, [nodes, connections]);

  // Undo last action
  const undo = useCallback(() => {
    if (!historyStackRef.current?.canUndo()) return;
    isUndoingRef.current = true;

    const prevState = historyStackRef.current.popUndo({ nodes, connections });
    if (prevState) {
      setNodes(prevState.nodes);
      setConnections(prevState.connections);
    }

    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);
  }, [nodes, connections]);

  // Redo last undone action
  const redo = useCallback(() => {
    if (!historyStackRef.current?.canRedo()) return;
    isUndoingRef.current = true;

    const nextState = historyStackRef.current.popRedo({ nodes, connections });
    if (nextState) {
      setNodes(nextState.nodes);
      setConnections(nextState.connections);
    }

    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);
  }, [nodes, connections]);

  // Sync nodes/connections when material changes
  useEffect(() => {
    if (material) {
      setNodes(material.nodes);
      setConnections(material.connections);
      setSelectedNodeIds(new Set());
    } else {
      setNodes([]);
      setConnections([]);
      setSelectedNodeIds(new Set());
    }
  }, [material?.id]);

  // Notify parent when nodes/connections change
  useEffect(() => {
    if (material && onMaterialChange) {
      // Only update if actually changed
      if (nodes !== material.nodes || connections !== material.connections) {
        onMaterialChange({
          ...material,
          nodes,
          connections,
        });
      }
    }
  }, [nodes, connections, material, onMaterialChange]);

  // Create ImageBitmap previews from textureMap
  useEffect(() => {
    if (!textureMap) return;

    const cache = texturePreviewCache.current;

    // Create ImageBitmaps for any new textures
    textureMap.forEach((texture, key) => {
      if (cache.has(key)) return; // Already cached

      if (texture.loaded && texture.width > 0 && texture.height > 0) {
        // Create ImageData from texture
        const imageData = new ImageData(
          new Uint8ClampedArray(texture.getData()),
          texture.width,
          texture.height
        );

        // Create ImageBitmap asynchronously
        createImageBitmap(imageData).then((bitmap) => {
          cache.set(key, bitmap);
          // Force re-render to show the preview
          setNodes((n) => [...n]);
        });
      }
    });

    // Cleanup: remove cached bitmaps for textures no longer in map
    cache.forEach((_, key) => {
      if (!textureMap.has(key)) {
        cache.get(key)?.close();
        cache.delete(key);
      }
    });
  }, [textureMap, nodes]);

  // Interaction state
  const [dragging, setDragging] = useState<{
    type: "node" | "pan" | "socket" | "box";
    nodeId?: string;
    startX: number;
    startY: number;
    startNodeX?: number;
    startNodeY?: number;
    socketId?: string;
    isInput?: boolean;
    // For multi-node dragging
    nodeStartPositions?: Map<string, { x: number; y: number }>;
    // For box selection
    boxStartCanvasX?: number;
    boxStartCanvasY?: number;
  } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{
    fromNodeId: string;
    fromSocketId: string;
    isInput: boolean;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  // Box selection state
  const [boxSelection, setBoxSelection] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Color stop dragging state
  const [draggingStop, setDraggingStop] = useState<{
    nodeId: string;
    stopIndex: number;
    rampX: number;
    rampW: number;
  } | null>(null);

  // Track mouse position and whether it's over the node editor
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isMouseOverRef = useRef(false);

  // Get socket position in canvas coordinates
  const getSocketPosition = useCallback(
    (node: ShaderNode, socket: Socket): { x: number; y: number } => {
      const socketRadius = 6;
      const headerHeight = 24;
      const socketSpacing = 22;

      const x = socket.isInput ? node.x : node.x + node.width;

      let socketIndex = 0;
      const sockets = socket.isInput ? node.inputs : node.outputs;
      for (let i = 0; i < sockets.length; i++) {
        if (sockets[i].id === socket.id) {
          socketIndex = i;
          break;
        }
      }

      const y = node.y + headerHeight + 16 + socketIndex * socketSpacing;
      return { x, y };
    },
    []
  );

  // Find connection at canvas position
  const findConnectionAt = useCallback(
    (
      canvasX: number,
      canvasY: number,
      threshold: number = 15
    ): NodeConnection | null => {
      for (const conn of connections) {
        const fromNode = nodes.find((n) => n.id === conn.fromNodeId);
        const toNode = nodes.find((n) => n.id === conn.toNodeId);
        if (!fromNode || !toNode) continue;

        const fromSocket = fromNode.outputs.find(
          (s) => s.id === conn.fromSocketId
        );
        const toSocket = toNode.inputs.find((s) => s.id === conn.toSocketId);
        if (!fromSocket || !toSocket) continue;

        const fromPos = getSocketPosition(fromNode, fromSocket);
        const toPos = getSocketPosition(toNode, toSocket);

        const dist = distanceToBezier(canvasX, canvasY, fromPos, toPos);
        if (dist < threshold) {
          return conn;
        }
      }
      return null;
    },
    [connections, nodes, getSocketPosition]
  );

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const container = containerRef.current;
      if (!container) return { x: screenX, y: screenY };

      const rect = container.getBoundingClientRect();
      return {
        x: (screenX - rect.left - pan.x) / zoom,
        y: (screenY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  // Find node at position
  const findNodeAt = useCallback(
    (canvasX: number, canvasY: number): ShaderNode | null => {
      // Check in reverse order (top nodes first)
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (
          canvasX >= node.x &&
          canvasX <= node.x + node.width &&
          canvasY >= node.y &&
          canvasY <= node.y + node.height
        ) {
          return node;
        }
      }
      return null;
    },
    [nodes]
  );

  // Find socket at position
  const findSocketAt = useCallback(
    (
      canvasX: number,
      canvasY: number
    ): { node: ShaderNode; socket: Socket } | null => {
      const socketRadius = 8;

      for (const node of nodes) {
        for (const socket of [...node.inputs, ...node.outputs]) {
          const pos = getSocketPosition(node, socket);
          const dist = Math.sqrt(
            (canvasX - pos.x) ** 2 + (canvasY - pos.y) ** 2
          );
          if (dist <= socketRadius) {
            return { node, socket };
          }
        }
      }
      return null;
    },
    [nodes, getSocketPosition]
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);

      // Check for socket click first
      const socketHit = findSocketAt(canvasPos.x, canvasPos.y);
      if (socketHit && e.button === 0) {
        // Start connection drag
        const { node, socket } = socketHit;

        // If clicking on an input that already has a connection, remove it
        if (socket.isInput) {
          const existingConn = connections.find(
            (c) => c.toNodeId === node.id && c.toSocketId === socket.id
          );
          if (existingConn) {
            // Remove connection and start dragging from the other end
            setConnections((prev) =>
              prev.filter((c) => c.id !== existingConn.id)
            );
            setPendingConnection({
              fromNodeId: existingConn.fromNodeId,
              fromSocketId: existingConn.fromSocketId,
              isInput: false,
              mouseX: canvasPos.x,
              mouseY: canvasPos.y,
            });
            setDragging({
              type: "socket",
              startX: e.clientX,
              startY: e.clientY,
            });
            return;
          }
        }

        setPendingConnection({
          fromNodeId: node.id,
          fromSocketId: socket.id,
          isInput: socket.isInput,
          mouseX: canvasPos.x,
          mouseY: canvasPos.y,
        });
        setDragging({
          type: "socket",
          startX: e.clientX,
          startY: e.clientY,
        });
        return;
      }

      // Check for node click
      const node = findNodeAt(canvasPos.x, canvasPos.y);
      if (node && e.button === 0) {
        if (e.shiftKey) {
          // Shift+click: toggle selection
          setSelectedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(node.id)) {
              next.delete(node.id);
            } else {
              next.add(node.id);
            }
            return next;
          });
        } else {
          // Regular click: select only this node (unless already selected for multi-drag)
          if (!selectedNodeIds.has(node.id)) {
            setSelectedNodeIds(new Set([node.id]));
          }
        }

        // Build start positions for all selected nodes (for multi-drag)
        const nodeStartPositions = new Map<string, { x: number; y: number }>();
        const idsToUse = selectedNodeIds.has(node.id)
          ? selectedNodeIds
          : new Set([node.id]);
        for (const id of idsToUse) {
          const n = nodes.find((n) => n.id === id);
          if (n) {
            nodeStartPositions.set(id, { x: n.x, y: n.y });
          }
        }

        setDragging({
          type: "node",
          nodeId: node.id,
          startX: e.clientX,
          startY: e.clientY,
          startNodeX: node.x,
          startNodeY: node.y,
          nodeStartPositions,
        });
        // Move node to top
        setNodes((prev) => {
          const idx = prev.findIndex((n) => n.id === node.id);
          if (idx === -1 || idx === prev.length - 1) return prev;
          const newNodes = [...prev];
          const [removed] = newNodes.splice(idx, 1);
          newNodes.push(removed);
          return newNodes;
        });
        return;
      }

      // Middle mouse button for pan
      if (e.button === 1) {
        setDragging({
          type: "pan",
          startX: e.clientX - pan.x,
          startY: e.clientY - pan.y,
        });
        return;
      }

      // Left click on empty space: start box selection
      if (e.button === 0 && !node) {
        if (!e.shiftKey) {
          setSelectedNodeIds(new Set());
        }
        setBoxSelection({
          startX: canvasPos.x,
          startY: canvasPos.y,
          currentX: canvasPos.x,
          currentY: canvasPos.y,
        });
        setDragging({
          type: "box",
          startX: e.clientX,
          startY: e.clientY,
          boxStartCanvasX: canvasPos.x,
          boxStartCanvasY: canvasPos.y,
        });
      }
    },
    [
      screenToCanvas,
      findNodeAt,
      findSocketAt,
      connections,
      pan,
      selectedNodeIds,
      nodes,
    ]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;

      if (dragging.type === "node" && dragging.nodeId) {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;

        // Multi-node drag if we have start positions
        if (
          dragging.nodeStartPositions &&
          dragging.nodeStartPositions.size > 1
        ) {
          setNodes((prev) =>
            prev.map((n) => {
              const startPos = dragging.nodeStartPositions?.get(n.id);
              if (startPos) {
                return {
                  ...n,
                  x: startPos.x + dx,
                  y: startPos.y + dy,
                };
              }
              return n;
            })
          );
        } else {
          // Single node drag
          setNodes((prev) =>
            prev.map((n) =>
              n.id === dragging.nodeId
                ? {
                    ...n,
                    x: (dragging.startNodeX ?? 0) + dx,
                    y: (dragging.startNodeY ?? 0) + dy,
                  }
                : n
            )
          );
        }
      } else if (dragging.type === "box") {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        setBoxSelection((prev) =>
          prev
            ? { ...prev, currentX: canvasPos.x, currentY: canvasPos.y }
            : null
        );
      } else if (dragging.type === "pan") {
        setPan({
          x: e.clientX - dragging.startX,
          y: e.clientY - dragging.startY,
        });
      } else if (dragging.type === "socket" && pendingConnection) {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        setPendingConnection((prev) =>
          prev ? { ...prev, mouseX: canvasPos.x, mouseY: canvasPos.y } : null
        );
      }
    },
    [dragging, zoom, pendingConnection, screenToCanvas]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Check if we dropped a node onto a connection
      if (dragging?.type === "node" && dragging.nodeId) {
        const droppedNode = nodes.find((n) => n.id === dragging.nodeId);
        if (droppedNode) {
          // Get node center
          const nodeCenterX = droppedNode.x + droppedNode.width / 2;
          const nodeCenterY = droppedNode.y + droppedNode.height / 2;

          const hitConnection = findConnectionAt(nodeCenterX, nodeCenterY);
          if (
            hitConnection &&
            droppedNode.id !== hitConnection.fromNodeId &&
            droppedNode.id !== hitConnection.toNodeId
          ) {
            // Check if the dropped node has compatible sockets
            const hasInput = droppedNode.inputs.length > 0;
            const hasOutput = droppedNode.outputs.length > 0;

            if (hasInput && hasOutput) {
              // Get the first compatible input and output sockets
              const fromNode = nodes.find(
                (n) => n.id === hitConnection.fromNodeId
              );
              const toNode = nodes.find((n) => n.id === hitConnection.toNodeId);
              const fromSocket = fromNode?.outputs.find(
                (s) => s.id === hitConnection.fromSocketId
              );
              const toSocket = toNode?.inputs.find(
                (s) => s.id === hitConnection.toSocketId
              );

              if (fromSocket && toSocket) {
                // Find compatible sockets on the dropped node
                const compatibleInput = droppedNode.inputs.find(
                  (s) =>
                    s.type === fromSocket.type ||
                    (fromSocket.type === "color" && s.type === "float")
                );
                const compatibleOutput = droppedNode.outputs.find(
                  (s) =>
                    s.type === toSocket.type ||
                    (s.type === "color" && toSocket.type === "float")
                );

                if (compatibleInput && compatibleOutput) {
                  // Remove the old connection and create two new ones
                  pushUndo();
                  setConnections((prev) => {
                    const filtered = prev.filter(
                      (c) => c.id !== hitConnection.id
                    );
                    return [
                      ...filtered,
                      // Connection from original source to dropped node
                      {
                        id: `conn-${Date.now()}-1`,
                        fromNodeId: hitConnection.fromNodeId,
                        fromSocketId: hitConnection.fromSocketId,
                        toNodeId: droppedNode.id,
                        toSocketId: compatibleInput.id,
                      },
                      // Connection from dropped node to original target
                      {
                        id: `conn-${Date.now()}-2`,
                        fromNodeId: droppedNode.id,
                        fromSocketId: compatibleOutput.id,
                        toNodeId: hitConnection.toNodeId,
                        toSocketId: hitConnection.toSocketId,
                      },
                    ];
                  });
                }
              }
            }
          }
        }
      }

      // Complete box selection
      if (dragging?.type === "box" && boxSelection) {
        const minX = Math.min(boxSelection.startX, boxSelection.currentX);
        const maxX = Math.max(boxSelection.startX, boxSelection.currentX);
        const minY = Math.min(boxSelection.startY, boxSelection.currentY);
        const maxY = Math.max(boxSelection.startY, boxSelection.currentY);

        // Find nodes within box
        const selectedIds = new Set<string>();
        for (const node of nodes) {
          const nodeRight = node.x + node.width;
          const nodeBottom = node.y + node.height;

          // Check if node intersects with box
          if (
            node.x < maxX &&
            nodeRight > minX &&
            node.y < maxY &&
            nodeBottom > minY
          ) {
            selectedIds.add(node.id);
          }
        }

        setSelectedNodeIds((prev) => {
          // If shift was held, add to existing selection
          if (e.shiftKey) {
            const combined = new Set(prev);
            for (const id of selectedIds) {
              combined.add(id);
            }
            return combined;
          }
          return selectedIds;
        });
        setBoxSelection(null);
      }

      if (dragging?.type === "socket" && pendingConnection) {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        const socketHit = findSocketAt(canvasPos.x, canvasPos.y);

        if (socketHit) {
          const { node: targetNode, socket: targetSocket } = socketHit;

          // Find the source socket to check type compatibility
          const sourceNode = nodes.find(
            (n) => n.id === pendingConnection.fromNodeId
          );
          const sourceSocket = sourceNode
            ? [...sourceNode.inputs, ...sourceNode.outputs].find(
                (s) => s.id === pendingConnection.fromSocketId
              )
            : null;

          // Validate connection
          const canConnect =
            // Different nodes
            targetNode.id !== pendingConnection.fromNodeId &&
            // Opposite socket types (input to output)
            targetSocket.isInput !== pendingConnection.isInput &&
            // Compatible socket types:
            // - color → color: yes
            // - color → float: yes (uses luminance/red channel)
            // - float → float: yes
            // - float → color: no (would need conversion)
            (sourceSocket?.type === targetSocket.type ||
              (sourceSocket?.type === "color" &&
                targetSocket.type === "float"));

          if (canConnect) {
            const fromNode = pendingConnection.isInput
              ? targetNode.id
              : pendingConnection.fromNodeId;
            const fromSocket = pendingConnection.isInput
              ? targetSocket.id
              : pendingConnection.fromSocketId;
            const toNode = pendingConnection.isInput
              ? pendingConnection.fromNodeId
              : targetNode.id;
            const toSocket = pendingConnection.isInput
              ? pendingConnection.fromSocketId
              : targetSocket.id;

            // Remove existing connection to input socket
            pushUndo();
            setConnections((prev) => {
              const filtered = prev.filter(
                (c) => !(c.toNodeId === toNode && c.toSocketId === toSocket)
              );
              return [
                ...filtered,
                {
                  id: `conn-${Date.now()}`,
                  fromNodeId: fromNode,
                  fromSocketId: fromSocket,
                  toNodeId: toNode,
                  toSocketId: toSocket,
                },
              ];
            });
          }
        }
      }

      setDragging(null);
      setPendingConnection(null);
    },
    [
      dragging,
      pendingConnection,
      screenToCanvas,
      findSocketAt,
      nodes,
      findConnectionAt,
      pushUndo,
      boxSelection,
    ]
  );

  // Helper to get socket type
  const getSocketType = (nodeId: string, socketId: string): SocketType => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return "color";
    const socket = [...node.inputs, ...node.outputs].find(
      (s) => s.id === socketId
    );
    return socket?.type ?? "color";
  };

  // Handle wheel for panning (and zoom with Cmd/Ctrl)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Cmd/Ctrl + scroll to zoom
      if (e.metaKey || e.ctrlKey) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom factor
        const zoomFactor = e.deltaY > 0 ? 0.99 : 1.01;
        const newZoom = Math.max(0.25, Math.min(2, zoom * zoomFactor));
        const actualFactor = newZoom / zoom;

        // Adjust pan to keep the point under cursor stationary
        // The point in canvas space: (mouseX - pan.x) / zoom
        // After zoom, we want the same canvas point to be at mouseX
        // So: newPan.x = mouseX - canvasX * newZoom
        const newPanX = mouseX - (mouseX - pan.x) * actualFactor;
        const newPanY = mouseY - (mouseY - pan.y) * actualFactor;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      } else {
        // Pan with wheel
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    // Use non-passive listener to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoom, pan]);

  // Add node from context menu
  const handleAddNode = useCallback(
    (type: NodeType) => {
      if (!contextMenu) return;
      pushUndo();
      const canvasPos = screenToCanvas(contextMenu.x, contextMenu.y);
      const newNode = createNode(type, canvasPos.x, canvasPos.y);
      setNodes((prev) => [...prev, newNode]);
      setContextMenu(null);
      setSelectedNodeIds(new Set([newNode.id]));
    },
    [contextMenu, screenToCanvas, pushUndo]
  );

  // Delete selected node
  const handleDeleteNode = useCallback(() => {
    if (selectedNodeIds.size === 0) return;

    // Filter out the output node from deletion
    const nodesToDelete = new Set<string>();
    for (const id of selectedNodeIds) {
      const node = nodes.find((n) => n.id === id);
      if (node && node.type !== "output") {
        nodesToDelete.add(id);
      }
    }

    if (nodesToDelete.size === 0) return;

    pushUndo();
    setNodes((prev) => prev.filter((n) => !nodesToDelete.has(n.id)));
    setConnections((prev) =>
      prev.filter(
        (c) =>
          !nodesToDelete.has(c.fromNodeId) && !nodesToDelete.has(c.toNodeId)
      )
    );
    setSelectedNodeIds(new Set());
  }, [selectedNodeIds, nodes, pushUndo]);

  // Keyboard handler - only responds when mouse is over node editor
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Close menu on Escape (always)
      if (e.key === "Escape") {
        setContextMenu(null);
        return;
      }

      // Only handle shortcuts if mouse is over node editor
      if (!isMouseOverRef.current) return;

      // Undo: Cmd+Z (Mac) or Ctrl+Z (Win/Linux)
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        undo();
        return;
      }

      // Redo: Cmd+Shift+Z (Mac) or Ctrl+Shift+Z / Ctrl+Y (Win/Linux)
      if (
        (e.metaKey || e.ctrlKey) &&
        ((e.shiftKey && e.key.toLowerCase() === "z") ||
          (!e.shiftKey && e.key.toLowerCase() === "y"))
      ) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }

      // Open Add Node menu on Shift+A at mouse position
      if (e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          x: mousePositionRef.current.x,
          y: mousePositionRef.current.y,
        });
        return;
      }

      // Delete node
      if ((e.key === "Delete" || e.key === "x") && !contextMenu) {
        e.preventDefault();
        e.stopPropagation();
        handleDeleteNode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteNode, contextMenu, undo, redo]);

  // Draw the node editor
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw grid
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const gridSize = 20;
    const gridExtent = 2000;
    ctx.strokeStyle = "#252525";
    ctx.lineWidth = 1 / zoom;

    for (let x = -gridExtent; x <= gridExtent; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, -gridExtent);
      ctx.lineTo(x, gridExtent);
      ctx.stroke();
    }
    for (let y = -gridExtent; y <= gridExtent; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(-gridExtent, y);
      ctx.lineTo(gridExtent, y);
      ctx.stroke();
    }

    // Draw connections
    for (const conn of connections) {
      const fromNode = nodes.find((n) => n.id === conn.fromNodeId);
      const toNode = nodes.find((n) => n.id === conn.toNodeId);
      if (!fromNode || !toNode) continue;

      const fromSocket = fromNode.outputs.find(
        (s) => s.id === conn.fromSocketId
      );
      const toSocket = toNode.inputs.find((s) => s.id === conn.toSocketId);
      if (!fromSocket || !toSocket) continue;

      const fromPos = getSocketPosition(fromNode, fromSocket);
      const toPos = getSocketPosition(toNode, toSocket);

      drawConnection(ctx, fromPos, toPos, SOCKET_COLORS[fromSocket.type], zoom);
    }

    // Draw pending connection
    if (pendingConnection) {
      const node = nodes.find((n) => n.id === pendingConnection.fromNodeId);
      if (node) {
        const socket = [...node.inputs, ...node.outputs].find(
          (s) => s.id === pendingConnection.fromSocketId
        );
        if (socket) {
          const pos = getSocketPosition(node, socket);
          const mousePos = {
            x: pendingConnection.mouseX,
            y: pendingConnection.mouseY,
          };
          const fromPos = pendingConnection.isInput ? mousePos : pos;
          const toPos = pendingConnection.isInput ? pos : mousePos;
          drawConnection(
            ctx,
            fromPos,
            toPos,
            SOCKET_COLORS[socket.type],
            zoom,
            true
          );
        }
      }
    }

    // Draw nodes
    for (const node of nodes) {
      drawNode(
        ctx,
        node,
        selectedNodeIds.has(node.id),
        zoom,
        texturePreviewCache.current
      );
    }

    // Draw box selection
    if (boxSelection) {
      ctx.strokeStyle = "#4a90d9";
      ctx.fillStyle = "rgba(74, 144, 217, 0.2)";
      ctx.lineWidth = 1 / zoom;
      const x = Math.min(boxSelection.startX, boxSelection.currentX);
      const y = Math.min(boxSelection.startY, boxSelection.currentY);
      const w = Math.abs(boxSelection.currentX - boxSelection.startX);
      const h = Math.abs(boxSelection.currentY - boxSelection.startY);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }, [
    nodes,
    connections,
    selectedNodeIds,
    pan,
    zoom,
    pendingConnection,
    getSocketPosition,
    boxSelection,
  ]);

  return (
    <div
      ref={containerRef}
      className="node-editor"
      style={{ position: "relative" }}
      onMouseDown={(e) => {
        // Don't handle mouse events on color pickers
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "BUTTON") {
          return;
        }
        // Close menu if clicking outside of it
        if (contextMenu) {
          if (!target.closest(".node-context-menu")) {
            setContextMenu(null);
          }
        }
        handleMouseDown(e);
      }}
      onMouseMove={(e) => {
        // Track mouse position for contextual shortcuts
        mousePositionRef.current = { x: e.clientX, y: e.clientY };

        // Handle color stop dragging
        if (draggingStop) {
          const container = containerRef.current;
          if (container) {
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const relativeX = mouseX - draggingStop.rampX;
            const newPosition = Math.max(
              0,
              Math.min(1, relativeX / draggingStop.rampW)
            );

            setNodes((prev) =>
              prev.map((n) => {
                if (n.id === draggingStop.nodeId) {
                  const stops = [...(n.data.stops as ColorStop[])];
                  stops[draggingStop.stopIndex] = {
                    ...stops[draggingStop.stopIndex],
                    position: newPosition,
                  };
                  // Sort stops by position
                  stops.sort((a, b) => a.position - b.position);
                  return { ...n, data: { ...n.data, stops } };
                }
                return n;
              })
            );
          }
          return;
        }

        handleMouseMove(e);
      }}
      onMouseUp={(e) => {
        if (draggingStop) {
          setDraggingStop(null);
          return;
        }
        handleMouseUp(e);
      }}
      onMouseEnter={() => {
        isMouseOverRef.current = true;
      }}
      onMouseLeave={() => {
        isMouseOverRef.current = false;
        if (dragging?.type !== "socket") {
          setDragging(null);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} />
      <div className="node-editor-header">
        <span>Shader Editor</span>
        <div className="material-selector">
          <select
            value={selectedMaterialId || ""}
            onChange={(e) => onSelectMaterial(e.target.value)}
          >
            {materials.map((mat) => (
              <option key={mat.id} value={mat.id}>
                {mat.name}
              </option>
            ))}
          </select>
          <button
            className="new-material-btn"
            onClick={onNewMaterial}
            title="New Material"
          >
            +
          </button>
        </div>
      </div>
      {contextMenu && (
        <div
          className="node-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="menu-header">Add Node</div>
          <button onClick={() => handleAddNode("flat-color")}>
            Flat Color
          </button>
          <button onClick={() => handleAddNode("texture")}>Texture</button>
          <button onClick={() => handleAddNode("mix")}>Mix</button>
          <button onClick={() => handleAddNode("color-ramp")}>
            Color Ramp
          </button>
          <button onClick={() => handleAddNode("voronoi")}>Voronoi</button>
          <button onClick={() => handleAddNode("noise")}>Noise</button>
          <button onClick={() => handleAddNode("alpha-cutoff")}>
            Alpha Cutoff
          </button>
        </div>
      )}
      {/* Color picker for flat-color nodes */}
      {nodes
        .filter((n) => n.type === "flat-color")
        .map((node) => {
          const container = containerRef.current;
          if (!container) return null;
          const screenX = node.x * zoom + pan.x + 12 * zoom;
          const screenY = node.y * zoom + pan.y + 24 * zoom + 36 * zoom;
          const swatchW = (node.width - 24) * zoom;
          const swatchH = 24 * zoom;
          return (
            <input
              key={node.id}
              type="color"
              className="node-color-picker"
              value={(node.data.color as string) || "#808080"}
              onFocus={() => pushUndo()}
              onChange={(e) => {
                setNodes((prev) =>
                  prev.map((n) =>
                    n.id === node.id
                      ? { ...n, data: { ...n.data, color: e.target.value } }
                      : n
                  )
                );
              }}
              style={{
                position: "absolute",
                left: screenX,
                top: screenY,
                width: swatchW,
                height: swatchH,
                zIndex: 10,
              }}
            />
          );
        })}
      {/* Color ramp stop controls */}
      {nodes
        .filter((n) => n.type === "color-ramp")
        .map((node) => {
          const stops = (node.data.stops as ColorStop[]) || [
            { position: 0, color: "#000000" },
            { position: 1, color: "#ffffff" },
          ];
          const rampX = node.x * zoom + pan.x + 8 * zoom;
          const rampY = node.y * zoom + pan.y + 24 * zoom + 32 * zoom;
          const rampW = (node.width - 16) * zoom;
          const rampH = 24 * zoom;

          return (
            <React.Fragment key={node.id}>
              {/* Stop color pickers */}
              {stops.map((stop, idx) => {
                const markerX = rampX + stop.position * rampW - 8 * zoom;
                const markerY = rampY + rampH + 4 * zoom;
                return (
                  <div
                    key={`${node.id}-stop-${idx}`}
                    className="color-ramp-stop"
                    style={{
                      position: "absolute",
                      left: markerX,
                      top: markerY,
                      width: 16 * zoom,
                      height: 16 * zoom,
                      backgroundColor: stop.color,
                      border: "2px solid #fff",
                      borderRadius: 2,
                      cursor: "ew-resize",
                      zIndex: 10,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                    }}
                    title={`Stop ${idx + 1} (${(stop.position * 100).toFixed(
                      0
                    )}%) - Drag to move, click to change color`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      pushUndo(); // Save state before dragging
                      setDraggingStop({
                        nodeId: node.id,
                        stopIndex: idx,
                        rampX,
                        rampW,
                      });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      pushUndo(); // Save state before color change
                      // Trigger the hidden color input
                      const colorInput = document.getElementById(
                        `color-input-${node.id}-${idx}`
                      );
                      colorInput?.click();
                    }}
                  >
                    <input
                      id={`color-input-${node.id}-${idx}`}
                      type="color"
                      value={stop.color}
                      onChange={(e) => {
                        const newStops = [...stops];
                        newStops[idx] = { ...stop, color: e.target.value };
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === node.id
                              ? { ...n, data: { ...n.data, stops: newStops } }
                              : n
                          )
                        );
                      }}
                      style={{
                        position: "absolute",
                        opacity: 0,
                        width: "100%",
                        height: "100%",
                        cursor: "ew-resize",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                );
              })}
              {/* Add/remove stop buttons */}
              <div
                className="color-ramp-buttons"
                style={{
                  position: "absolute",
                  left: rampX,
                  top: rampY + rampH + 24 * zoom,
                  display: "flex",
                  gap: 4,
                  zIndex: 10,
                }}
              >
                <button
                  style={{
                    padding: "2px 8px",
                    fontSize: 12,
                    cursor: "pointer",
                    background: "#444",
                    border: "1px solid #666",
                    color: "#fff",
                    borderRadius: 2,
                  }}
                  onClick={() => {
                    pushUndo();
                    // Add a new stop in the middle
                    const newPos =
                      stops.length === 0
                        ? 0.5
                        : stops[Math.floor(stops.length / 2)]?.position || 0.5;
                    const newStops = [
                      ...stops,
                      {
                        position: Math.min(0.99, newPos + 0.1),
                        color: "#888888",
                      },
                    ].sort((a, b) => a.position - b.position);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, stops: newStops } }
                          : n
                      )
                    );
                  }}
                  title="Add stop"
                >
                  +
                </button>
                <button
                  style={{
                    padding: "2px 8px",
                    fontSize: 12,
                    cursor: stops.length <= 2 ? "not-allowed" : "pointer",
                    background: stops.length <= 2 ? "#333" : "#444",
                    border: "1px solid #666",
                    color: stops.length <= 2 ? "#666" : "#fff",
                    borderRadius: 2,
                  }}
                  onClick={() => {
                    if (stops.length > 2) {
                      pushUndo();
                      // Remove the middle stop
                      const newStops = stops.filter(
                        (_, i) => i !== Math.floor(stops.length / 2)
                      );
                      setNodes((prev) =>
                        prev.map((n) =>
                          n.id === node.id
                            ? { ...n, data: { ...n.data, stops: newStops } }
                            : n
                        )
                      );
                    }
                  }}
                  disabled={stops.length <= 2}
                  title="Remove stop"
                >
                  −
                </button>
              </div>
            </React.Fragment>
          );
        })}
      {/* Mix blend mode selector */}
      {nodes
        .filter((n) => n.type === "mix")
        .map((node) => {
          const container = containerRef.current;
          if (!container) return null;
          const controlX = node.x * zoom + pan.x + 8 * zoom;
          const controlY = node.y * zoom + pan.y + 24 * zoom + 32 * zoom;
          const controlW = (node.width - 16) * zoom;
          const blendMode = (node.data.blendMode as string) || "mix";
          const factor = (node.data.factor as number) ?? 0.5;

          return (
            <div
              key={node.id}
              className="mix-control"
              style={{
                position: "absolute",
                left: controlX,
                top: controlY,
                width: controlW,
                zIndex: 10,
              }}
            >
              {/* Blend mode selector */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                  marginBottom: 6 * zoom,
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Mode
                </span>
                <select
                  value={blendMode}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newMode = e.target.value;
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, blendMode: newMode } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 10 * zoom,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    borderRadius: 2,
                    padding: "2px 4px",
                    cursor: "pointer",
                  }}
                >
                  <option value="mix">Mix</option>
                  <option value="multiply">Multiply</option>
                  <option value="add">Add</option>
                </select>
              </div>
              {/* Factor slider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Factor
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={factor}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newFactor = parseFloat(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, factor: newFactor } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 12 * zoom,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#fff",
                    flexShrink: 0,
                    minWidth: 24 * zoom,
                    textAlign: "right",
                  }}
                >
                  {factor.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      {/* Voronoi scale slider */}
      {nodes
        .filter((n) => n.type === "voronoi")
        .map((node) => {
          const container = containerRef.current;
          if (!container) return null;
          const controlX = node.x * zoom + pan.x + 8 * zoom;
          const sliderY = node.y * zoom + pan.y + 24 * zoom + 32 * zoom;
          const controlW = (node.width - 16) * zoom;
          const scale = (node.data.scale as number) || 5;
          const mode = (node.data.mode as number) || 0;

          return (
            <div
              key={node.id}
              className="voronoi-scale-control"
              style={{
                position: "absolute",
                left: controlX,
                top: sliderY,
                width: controlW,
                zIndex: 10,
              }}
            >
              {/* Mode selector */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                  marginBottom: 6 * zoom,
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Mode
                </span>
                <select
                  value={mode}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newMode = parseInt(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, mode: newMode } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 10 * zoom,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    borderRadius: 2,
                    padding: "2px 4px",
                    cursor: "pointer",
                  }}
                >
                  <option value={0}>F1 (Distance)</option>
                  <option value={1}>Edge</option>
                </select>
              </div>
              {/* Scale slider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Scale
                </span>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={scale}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newScale = parseInt(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, scale: newScale } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 12 * zoom,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#fff",
                    flexShrink: 0,
                    minWidth: 16 * zoom,
                    textAlign: "right",
                  }}
                >
                  {scale}
                </span>
              </div>
            </div>
          );
        })}
      {/* Alpha Cutoff threshold slider */}
      {nodes
        .filter((n) => n.type === "alpha-cutoff")
        .map((node) => {
          const container = containerRef.current;
          if (!container) return null;
          const controlX = node.x * zoom + pan.x + 8 * zoom;
          const sliderY = node.y * zoom + pan.y + 24 * zoom + 32 * zoom;
          const controlW = (node.width - 16) * zoom;
          const threshold = (node.data.threshold as number) ?? 0.5;

          return (
            <div
              key={node.id}
              className="alpha-cutoff-control"
              style={{
                position: "absolute",
                left: controlX,
                top: sliderY,
                width: controlW,
                zIndex: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Threshold
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={threshold}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newThreshold = parseFloat(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? {
                              ...n,
                              data: { ...n.data, threshold: newThreshold },
                            }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 12 * zoom,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#fff",
                    flexShrink: 0,
                    minWidth: 24 * zoom,
                    textAlign: "right",
                  }}
                >
                  {threshold.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      {/* Noise controls */}
      {nodes
        .filter((n) => n.type === "noise")
        .map((node) => {
          const container = containerRef.current;
          if (!container) return null;
          const controlX = node.x * zoom + pan.x + 8 * zoom;
          const sliderY = node.y * zoom + pan.y + 24 * zoom + 32 * zoom;
          const controlW = (node.width - 16) * zoom;
          const scale = (node.data.scale as number) || 5;
          const octaves = (node.data.octaves as number) || 1;
          const mode = (node.data.mode as number) || 0;

          return (
            <div
              key={node.id}
              className="noise-control"
              style={{
                position: "absolute",
                left: controlX,
                top: sliderY,
                width: controlW,
                zIndex: 10,
              }}
            >
              {/* Mode selector */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                  marginBottom: 6 * zoom,
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Type
                </span>
                <select
                  value={mode}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newMode = parseInt(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, mode: newMode } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 10 * zoom,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    borderRadius: 2,
                    padding: "2px 4px",
                    cursor: "pointer",
                  }}
                >
                  <option value={0}>Value</option>
                  <option value={1}>Simplex</option>
                </select>
              </div>
              {/* Scale slider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                  marginBottom: 6 * zoom,
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Scale
                </span>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={scale}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newScale = parseInt(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, scale: newScale } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 12 * zoom,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#fff",
                    flexShrink: 0,
                    minWidth: 16 * zoom,
                    textAlign: "right",
                  }}
                >
                  {scale}
                </span>
              </div>
              {/* Octaves slider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4 * zoom,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#aaa",
                    flexShrink: 0,
                  }}
                >
                  Octaves
                </span>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={octaves}
                  onMouseDown={() => pushUndo()}
                  onChange={(e) => {
                    const newOctaves = parseInt(e.target.value);
                    setNodes((prev) =>
                      prev.map((n) =>
                        n.id === node.id
                          ? { ...n, data: { ...n.data, octaves: newOctaves } }
                          : n
                      )
                    );
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 12 * zoom,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontSize: 10 * zoom,
                    color: "#fff",
                    flexShrink: 0,
                    minWidth: 16 * zoom,
                    textAlign: "right",
                  }}
                >
                  {octaves}
                </span>
              </div>
            </div>
          );
        })}
    </div>
  );
}

// Draw a bezier connection between two points
function drawConnection(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  zoom: number,
  dashed: boolean = false
) {
  const dx = Math.abs(to.x - from.x);
  const controlDist = Math.max(50, dx * 0.5);

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(
    from.x + controlDist,
    from.y,
    to.x - controlDist,
    to.y,
    to.x,
    to.y
  );

  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / zoom;
  if (dashed) {
    ctx.setLineDash([5 / zoom, 5 / zoom]);
  } else {
    ctx.setLineDash([]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// Draw a node
function drawNode(
  ctx: CanvasRenderingContext2D,
  node: ShaderNode,
  selected: boolean,
  zoom: number,
  texturePreviewCache?: Map<string, ImageBitmap>
) {
  const { x, y, width, height, type } = node;
  const headerHeight = 24;
  const borderRadius = 6;
  const socketRadius = 6;
  const socketSpacing = 22;

  // Node shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  roundRect(ctx, x + 3, y + 3, width, height, borderRadius);
  ctx.fill();

  // Node body
  ctx.fillStyle = "#3d3d3d";
  roundRect(ctx, x, y, width, height, borderRadius);
  ctx.fill();

  // Node header
  ctx.fillStyle = NODE_COLORS[type];
  roundRectTop(ctx, x, y, width, headerHeight, borderRadius);
  ctx.fill();

  // Selection outline
  if (selected) {
    ctx.strokeStyle = "#ff9500";
    ctx.lineWidth = 2 / zoom;
    roundRect(ctx, x, y, width, height, borderRadius);
    ctx.stroke();
  }

  // Node title
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px 'Pixelify Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(getNodeTitle(type), x + width / 2, y + 16);

  // Draw sockets
  ctx.textAlign = "left";
  ctx.font = "11px 'Pixelify Sans', sans-serif";

  for (let i = 0; i < node.inputs.length; i++) {
    const socket = node.inputs[i];
    const sy = y + headerHeight + 16 + i * socketSpacing;

    // Socket circle
    ctx.beginPath();
    ctx.arc(x, sy, socketRadius, 0, Math.PI * 2);
    ctx.fillStyle = SOCKET_COLORS[socket.type];
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();

    // Socket label
    ctx.fillStyle = "#cccccc";
    ctx.fillText(socket.name, x + socketRadius + 6, sy + 4);
  }

  ctx.textAlign = "right";
  for (let i = 0; i < node.outputs.length; i++) {
    const socket = node.outputs[i];
    const sy = y + headerHeight + 16 + i * socketSpacing;

    // Socket circle
    ctx.beginPath();
    ctx.arc(x + width, sy, socketRadius, 0, Math.PI * 2);
    ctx.fillStyle = SOCKET_COLORS[socket.type];
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();

    // Socket label
    ctx.fillStyle = "#cccccc";
    ctx.fillText(socket.name, x + width - socketRadius - 6, sy + 4);
  }

  // Draw color swatch for flat-color node
  if (type === "flat-color" && node.data.color) {
    const swatchX = x + 12;
    const swatchY = y + headerHeight + 36;
    const swatchW = width - 24;
    const swatchH = 24;

    // Swatch background (for transparency indication)
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(swatchX, swatchY, swatchW, swatchH);

    // Color swatch
    ctx.fillStyle = node.data.color as string;
    ctx.fillRect(swatchX, swatchY, swatchW, swatchH);

    // Swatch border
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(swatchX, swatchY, swatchW, swatchH);
  }

  // Draw texture info and preview for texture node
  if (type === "texture") {
    const imagePath = (node.data.imagePath as string) || "";
    const texW = (node.data.textureWidth as number) || 0;
    const texH = (node.data.textureHeight as number) || 0;

    // Try to draw texture preview if available
    const preview = texturePreviewCache?.get(imagePath);
    if (preview) {
      const previewX = x + 8;
      const previewY = y + headerHeight + 8;
      const previewSize = Math.min(width - 16, 48); // Square preview, max 48px

      // Draw checkerboard background for transparency
      const checkSize = 6;
      for (let cy = 0; cy < previewSize; cy += checkSize) {
        for (let cx = 0; cx < previewSize; cx += checkSize) {
          const isLight = (cx / checkSize + cy / checkSize) % 2 === 0;
          ctx.fillStyle = isLight ? "#4a4a4a" : "#3a3a3a";
          ctx.fillRect(
            previewX + cx,
            previewY + cy,
            Math.min(checkSize, previewSize - cx),
            Math.min(checkSize, previewSize - cy)
          );
        }
      }

      // Draw the texture preview (fit to square)
      ctx.drawImage(preview, previewX, previewY, previewSize, previewSize);

      // Draw preview border
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(previewX, previewY, previewSize, previewSize);

      // Draw filename next to preview
      ctx.font = "10px 'Pixelify Sans', sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "#888888";
      const filename = imagePath.split("/").pop() || imagePath || "No texture";
      const maxChars = 12;
      const displayName =
        filename.length > maxChars
          ? filename.substring(0, maxChars - 2) + ".."
          : filename;
      ctx.fillText(displayName, previewX + previewSize + 6, previewY + 14);

      // Display dimensions
      if (texW > 0 && texH > 0) {
        ctx.fillStyle = "#666666";
        ctx.fillText(
          `${texW}×${texH}`,
          previewX + previewSize + 6,
          previewY + 28
        );
      }
    } else {
      // No preview available - show text only
      const infoY = y + headerHeight + 36;
      ctx.font = "10px 'Pixelify Sans', sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "#888888";

      // Display filename (truncated if too long)
      const filename = imagePath
        ? imagePath.split("/").pop() || imagePath
        : "No texture";
      const maxChars = 20;
      const displayName =
        filename.length > maxChars
          ? filename.substring(0, maxChars - 2) + ".."
          : filename;
      ctx.fillText(displayName, x + 8, infoY);

      // Display dimensions if available
      if (texW > 0 && texH > 0) {
        ctx.fillStyle = "#666666";
        ctx.fillText(`${texW} × ${texH}`, x + 8, infoY + 14);
      }
    }
  }

  // Draw color ramp preview
  if (type === "color-ramp") {
    const stops = (node.data.stops as ColorStop[]) || [
      { position: 0, color: "#000000" },
      { position: 1, color: "#ffffff" },
    ];
    const sortedStops = [...stops].sort((a, b) => a.position - b.position);

    const rampX = x + 8;
    const rampY = y + headerHeight + 32;
    const rampW = width - 16;
    const rampH = 24;

    // Draw gradient
    const gradient = ctx.createLinearGradient(rampX, 0, rampX + rampW, 0);
    for (const stop of sortedStops) {
      gradient.addColorStop(stop.position, stop.color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(rampX, rampY, rampW, rampH);

    // Draw border
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(rampX, rampY, rampW, rampH);

    // Draw stop markers
    for (const stop of sortedStops) {
      const markerX = rampX + stop.position * rampW;
      const markerY = rampY + rampH;

      // Triangle marker
      ctx.beginPath();
      ctx.moveTo(markerX, markerY);
      ctx.lineTo(markerX - 4, markerY + 8);
      ctx.lineTo(markerX + 4, markerY + 8);
      ctx.closePath();
      ctx.fillStyle = stop.color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }
  }
}

// Helper to draw rounded rectangle
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Helper to draw rounded rectangle (top corners only)
function roundRectTop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Helper to calculate distance from a point to a bezier curve
function distanceToBezier(
  px: number,
  py: number,
  from: { x: number; y: number },
  to: { x: number; y: number }
): number {
  const dx = Math.abs(to.x - from.x);
  const controlDist = Math.max(50, dx * 0.5);

  // Sample points along the bezier curve and find minimum distance
  let minDist = Infinity;
  const samples = 20;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const t1 = 1 - t;

    // Control points
    const cp1x = from.x + controlDist;
    const cp1y = from.y;
    const cp2x = to.x - controlDist;
    const cp2y = to.y;

    // Bezier formula
    const x =
      t1 * t1 * t1 * from.x +
      3 * t1 * t1 * t * cp1x +
      3 * t1 * t * t * cp2x +
      t * t * t * to.x;
    const y =
      t1 * t1 * t1 * from.y +
      3 * t1 * t1 * t * cp1y +
      3 * t1 * t * t * cp2y +
      t * t * t * to.y;

    const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
}
