import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Material,
  ShaderNode,
  NodeConnection,
  NodeType,
  SocketType,
  Socket,
} from "../material";

// Re-export types for convenience
export type {
  NodeType,
  SocketType,
  ShaderNode as Node,
  NodeConnection as Connection,
};

interface NodeEditorProps {
  materials: Material[];
  selectedMaterialId: string | null;
  onSelectMaterial: (id: string) => void;
  onMaterialChange?: (material: Material) => void;
  onNewMaterial?: () => void;
}

// Node color scheme (PS1-style simplified)
const NODE_COLORS: Record<NodeType, string> = {
  output: "#6b3a3a",
  texture: "#6b5a3a",
  "flat-color": "#5a3a6b",
  mix: "#3a5a6b",
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
        width: 160,
        height: 80,
        inputs: [],
        outputs: [
          { id: "color", name: "Color", type: "color", isInput: false },
        ],
        data: { imagePath: "" },
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
        data: { blendMode: "multiply", factor: 1.0 },
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
}: NodeEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get active material from list
  const material = materials.find((m) => m.id === selectedMaterialId) || null;

  // Editor state - synced with material
  const [nodes, setNodes] = useState<ShaderNode[]>(material?.nodes || []);
  const [connections, setConnections] = useState<NodeConnection[]>(
    material?.connections || []
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Sync nodes/connections when material changes
  useEffect(() => {
    if (material) {
      setNodes(material.nodes);
      setConnections(material.connections);
      setSelectedNodeId(null);
    } else {
      setNodes([]);
      setConnections([]);
      setSelectedNodeId(null);
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

  // Interaction state
  const [dragging, setDragging] = useState<{
    type: "node" | "pan" | "socket";
    nodeId?: string;
    startX: number;
    startY: number;
    startNodeX?: number;
    startNodeY?: number;
    socketId?: string;
    isInput?: boolean;
  } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{
    fromNodeId: string;
    fromSocketId: string;
    isInput: boolean;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
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
        setSelectedNodeId(node.id);
        setDragging({
          type: "node",
          nodeId: node.id,
          startX: e.clientX,
          startY: e.clientY,
          startNodeX: node.x,
          startNodeY: node.y,
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

      // Middle mouse or space+left click for pan
      if (e.button === 1 || (e.button === 0 && !node)) {
        setSelectedNodeId(null);
        setDragging({
          type: "pan",
          startX: e.clientX - pan.x,
          startY: e.clientY - pan.y,
        });
      }
    },
    [screenToCanvas, findNodeAt, findSocketAt, connections, pan]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;

      if (dragging.type === "node" && dragging.nodeId) {
        const dx = (e.clientX - dragging.startX) / zoom;
        const dy = (e.clientY - dragging.startY) / zoom;
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
      if (dragging?.type === "socket" && pendingConnection) {
        const canvasPos = screenToCanvas(e.clientX, e.clientY);
        const socketHit = findSocketAt(canvasPos.x, canvasPos.y);

        if (socketHit) {
          const { node: targetNode, socket: targetSocket } = socketHit;

          // Validate connection
          const canConnect =
            // Different nodes
            targetNode.id !== pendingConnection.fromNodeId &&
            // Opposite socket types (input to output)
            targetSocket.isInput !== pendingConnection.isInput &&
            // Compatible socket types (all sockets are color type now)
            targetSocket.type === "color";

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
    [dragging, pendingConnection, screenToCanvas, findSocketAt]
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
        const delta = e.deltaY > 0 ? 0.99 : 1.01;
        setZoom((prev) => Math.max(0.25, Math.min(2, prev * delta)));
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
  }, []);

  // Add node from context menu
  const handleAddNode = useCallback(
    (type: NodeType) => {
      if (!contextMenu) return;
      const canvasPos = screenToCanvas(contextMenu.x, contextMenu.y);
      const newNode = createNode(type, canvasPos.x, canvasPos.y);
      setNodes((prev) => [...prev, newNode]);
      setContextMenu(null);
      setSelectedNodeId(newNode.id);
    },
    [contextMenu, screenToCanvas]
  );

  // Delete selected node
  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId) return;
    // Don't delete output node
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (node?.type === "output") return;

    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setConnections((prev) =>
      prev.filter(
        (c) => c.fromNodeId !== selectedNodeId && c.toNodeId !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, nodes]);

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
  }, [handleDeleteNode, contextMenu]);

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
      drawNode(ctx, node, node.id === selectedNodeId, zoom);
    }

    ctx.restore();
  }, [
    nodes,
    connections,
    selectedNodeId,
    pan,
    zoom,
    pendingConnection,
    getSocketPosition,
  ]);

  return (
    <div
      ref={containerRef}
      className="node-editor"
      onMouseDown={(e) => {
        // Close menu if clicking outside of it
        if (contextMenu) {
          const target = e.target as HTMLElement;
          if (!target.closest(".node-context-menu")) {
            setContextMenu(null);
          }
        }
        handleMouseDown(e);
      }}
      onMouseMove={(e) => {
        // Track mouse position for contextual shortcuts
        mousePositionRef.current = { x: e.clientX, y: e.clientY };
        handleMouseMove(e);
      }}
      onMouseUp={handleMouseUp}
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
        </div>
      )}
      {/* Color picker for flat-color nodes */}
      {nodes
        .filter((n) => n.type === "flat-color")
        .map((node) => {
          const container = containerRef.current;
          if (!container) return null;
          const rect = container.getBoundingClientRect();
          const screenX = node.x * zoom + pan.x + 12;
          const screenY = node.y * zoom + pan.y + 24 + 36;
          const swatchW = (node.width - 24) * zoom;
          const swatchH = 24 * zoom;
          return (
            <input
              key={node.id}
              type="color"
              className="node-color-picker"
              value={(node.data.color as string) || "#808080"}
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
                left: screenX,
                top: screenY,
                width: swatchW,
                height: swatchH,
              }}
            />
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
  zoom: number
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
