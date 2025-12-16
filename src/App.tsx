import { useRef, useEffect, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Vector3, Color } from "./math";
import {
  createPlaneMesh,
  createCubeMesh,
  createCircleMesh,
} from "./primitives";
import { OBJLoader } from "./obj-loader";
import { Scene, SceneObject } from "./scene";
import { Editor, ViewMode } from "./editor";
import { InputManager } from "./systems/input";
import { useEditorUIState } from "./systems/ui-state";
import { RenderWorkerClient } from "./render-worker-client";
import {
  buildRenderFrame,
  buildRenderSettings,
  WorkerRenderContext,
  GridData,
} from "./systems/worker-render-loop";
import { Texture } from "./texture";
import { Toolbar } from "./components/Toolbar";
import { SceneTree } from "./components/SceneTree";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { StatusBar } from "./components/StatusBar";
import { Instructions } from "./components/Instructions";
import { AddMenu, PrimitiveType } from "./components/AddMenu";
import { ShadingContextMenu } from "./components/ShadingContextMenu";
import { ViewportGizmo } from "./components/ViewportGizmo";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const workerClientRef = useRef<RenderWorkerClient | null>(null);
  const sceneRef = useRef<Scene>(new Scene());
  const editorRef = useRef<Editor | null>(null);
  const gridDataRef = useRef<GridData | null>(null);
  const renderLoopIdRef = useRef<number>(0);
  const renderDimensionsRef = useRef({
    displayWidth: 640,
    displayHeight: 480,
    renderWidth: 640,
    renderHeight: 480,
  });
  const textureRef = useRef<Texture | null>(null);
  const textureChangedRef = useRef(false);

  // UI state from custom hook
  const {
    state: uiState,
    setters,
    actions,
  } = useEditorUIState(editorRef, sceneRef);
  const {
    fps,
    frameTime,
    renderWidth,
    renderHeight,
    editorMode,
    selectionMode,
    transformMode,
    axisConstraint,
    viewMode,
    sceneObjects,
    selectedObjectName,
    selectedPosition,
    selectedRotation,
    selectedScale,
    selectedVertexCount,
    selectedEdgeCount,
    selectedFaceCount,
    settings,
  } = uiState;
  const { setFps, setFrameTime, setRenderResolution, setSettings } = setters;
  const {
    updateUIState,
    handleModeChange,
    handleViewModeChange,
    handleSelectionModeChange,
  } = actions;

  // Input state refs (don't need re-renders)
  const inputManagerRef = useRef<InputManager>(new InputManager());

  // Add menu state
  const [addMenuPos, setAddMenuPos] = useState<{ x: number; y: number } | null>(
    null
  );

  // Context menu state (right-click on mesh)
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Camera state for viewport gizmo
  const [isOrtho, setIsOrtho] = useState(false);

  // Resize canvas to fill viewport
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    const workerClient = workerClientRef.current;
    if (!canvas || !viewport) return;

    // Get viewport dimensions
    const rect = viewport.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (width <= 0 || height <= 0) return;

    // Store dimensions for frame building
    renderDimensionsRef.current.displayWidth = width;
    renderDimensionsRef.current.displayHeight = height;

    // Update render resolution to match aspect ratio (PS1-style low res)
    // Use fixed base width, calculate height from aspect ratio
    const baseWidth = 640;
    const aspectRatio = width / height;
    const baseHeight = Math.max(400, Math.floor(baseWidth / aspectRatio));

    renderDimensionsRef.current.renderWidth = baseWidth;
    renderDimensionsRef.current.renderHeight = baseHeight;
    setRenderResolution(baseWidth, baseHeight);

    if (workerClient) {
      // Resize display canvas and render resolution in worker
      workerClient.resize(width, height);
      workerClient.setRenderResolution(baseWidth, baseHeight);
    }
  }, []);

  // Load OBJ file and add to scene
  const loadOBJ = useCallback(async (url: string, name: string) => {
    const scene = sceneRef.current;

    try {
      console.log(`Loading OBJ: ${url}`);
      const result = await OBJLoader.load(url, new Color(200, 200, 200));

      // Create scene objects from all loaded meshes
      const meshEntries = Array.from(result.meshes.entries());
      let firstObj: SceneObject | null = null;
      let overallCenter = Vector3.zero();
      let meshCount = 0;

      // Calculate overall center of all meshes
      for (const [, mesh] of meshEntries) {
        const center = mesh.getCenter();
        overallCenter = overallCenter.add(center);
        meshCount++;
      }
      if (meshCount > 0) {
        overallCenter = overallCenter.mul(1 / meshCount);
      }

      // Create a scene object for each mesh
      for (const [meshName, mesh] of meshEntries) {
        // Use mesh name from OBJ file, fallback to provided name for "default" group
        const objectName = meshName !== "default" ? meshName : name;

        const obj = new SceneObject(objectName, mesh);

        // Center relative to overall center
        obj.position = new Vector3(
          -overallCenter.x,
          -overallCenter.y,
          -overallCenter.z
        );

        scene.addObject(obj);

        if (!firstObj) {
          firstObj = obj;
        }

        console.log(
          `Loaded mesh "${meshName}" with ${mesh.triangles.length} triangles`
        );
      }

      // Select the first object
      if (firstObj) {
        scene.selectObject(firstObj);
      }

      // Set up texture if available
      if (result.defaultTexture) {
        console.log("Loaded texture, enabling texturing");
        textureRef.current = result.defaultTexture;
        textureChangedRef.current = true;
      }

      // Position camera to view all objects
      const size = result.defaultMesh.getSize();
      const maxDim = Math.max(size.x, size.y, size.z);
      scene.camera.position = new Vector3(
        maxDim * -2,
        maxDim * -1.5,
        maxDim * 0.4
      );
      scene.camera.target = Vector3.zero();

      console.log(`Loaded OBJ with ${meshEntries.length} object(s)`);
    } catch (error) {
      console.warn(`Could not load OBJ file: ${error}`);
    }
  }, []);

  // Handle object selection from scene tree
  const handleSelectObject = useCallback(
    (name: string) => {
      const scene = sceneRef.current;
      const obj = scene.objects.find((o) => o.name === name);
      if (obj) {
        scene.selectObject(obj);
        updateUIState(true); // Force immediate update for user action
      }
    },
    [updateUIState]
  );

  // Handle visibility toggle
  const handleToggleVisibility = useCallback(
    (name: string) => {
      const scene = sceneRef.current;
      const obj = scene.objects.find((o) => o.name === name);
      if (obj) {
        obj.visible = !obj.visible;
        updateUIState(true); // Force immediate update for user action
      }
    },
    [updateUIState]
  );

  // Handle adding a primitive mesh
  const handleAddPrimitive = useCallback(
    (type: PrimitiveType) => {
      const scene = sceneRef.current;
      const editor = editorRef.current;

      // Generate unique name
      const baseName = type.charAt(0).toUpperCase() + type.slice(1);
      let name = baseName;
      let counter = 1;
      while (scene.objects.some((o) => o.name === name)) {
        name = `${baseName}.${String(counter).padStart(3, "0")}`;
        counter++;
      }

      // Create the mesh
      let mesh;
      switch (type) {
        case "plane":
          mesh = createPlaneMesh(2);
          break;
        case "circle":
          mesh = createCircleMesh(1, 32);
          break;
        case "cube":
        default:
          mesh = createCubeMesh(2);
          break;
      }

      // Create scene object
      const obj = new SceneObject(name, mesh);

      // Add to scene and select it
      scene.addObject(obj);
      scene.selectObject(obj);

      // Record in history for undo support
      if (editor) {
        editor.recordObjectAdd(obj);
      }

      updateUIState(true);
      setAddMenuPos(null);
    },
    [updateUIState]
  );

  // Handle transform property changes from properties panel
  const handlePositionChange = useCallback(
    (position: Vector3) => {
      const scene = sceneRef.current;
      const selected = scene.getSelectedObjects();
      if (selected.length > 0) {
        selected[0].position = position;
        updateUIState(true); // Force immediate update for user action
      }
    },
    [updateUIState]
  );

  const handleRotationChange = useCallback(
    (rotation: Vector3) => {
      const scene = sceneRef.current;
      const selected = scene.getSelectedObjects();
      if (selected.length > 0) {
        selected[0].rotation = rotation;
        updateUIState(true); // Force immediate update for user action
      }
    },
    [updateUIState]
  );

  const handleScaleChange = useCallback(
    (scale: Vector3) => {
      const scene = sceneRef.current;
      const selected = scene.getSelectedObjects();
      if (selected.length > 0) {
        selected[0].scale = scale;
        updateUIState(true); // Force immediate update for user action
      }
    },
    [updateUIState]
  );

  // Handle viewpoint change from viewport gizmo
  const handleViewpointChange = useCallback(
    (
      viewpoint:
        | "front"
        | "back"
        | "right"
        | "left"
        | "top"
        | "bottom"
        | "persp"
    ) => {
      const scene = sceneRef.current;
      scene.camera.setViewpoint(viewpoint);
      setIsOrtho(scene.camera.orthographic);
    },
    []
  );

  // Handle ortho toggle from viewport gizmo
  const handleToggleOrtho = useCallback(() => {
    const scene = sceneRef.current;
    scene.camera.orthographic = !scene.camera.orthographic;
    setIsOrtho(scene.camera.orthographic);
  }, []);

  // Update settings on worker when they change
  useEffect(() => {
    const workerClient = workerClientRef.current;
    const editor = editorRef.current;
    if (!workerClient || !editor) return;

    workerClient.setSettings(buildRenderSettings(settings, editor.viewMode));
  }, [settings]);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Store references for cleanup
    let handleKeyDown: (e: KeyboardEvent) => void;
    let handleKeyUp: (e: KeyboardEvent) => void;
    let handleMouseDown: (e: MouseEvent) => void;
    let handleMouseUp: () => void;
    let handleMouseMove: (e: MouseEvent) => void;
    let handleWheel: (e: WheelEvent) => void;
    let handleContextMenu: (e: MouseEvent) => void;
    let handleViewportEnter: () => void;
    let handleViewportLeave: () => void;

    // Initialize render worker
    const workerClient = new RenderWorkerClient("render-worker.js");
    workerClientRef.current = workerClient;

    // Set up FPS callback
    workerClient.onFrameStats = (fps, frameTimeMs) => {
      setFps(fps);
      setFrameTime(frameTimeMs);
    };

    // Initialize worker with canvas
    workerClient.init(canvas, "rasterizer.wasm").then(() => {
      const scene = sceneRef.current;
      editorRef.current = new Editor(scene);
      gridDataRef.current = scene.createGridLines();

      // Now resize canvas and set correct render resolution
      resizeCanvas();

      // Set initial settings
      workerClient.setSettings(
        buildRenderSettings(settings, editorRef.current!.viewMode)
      );

      // Start the worker's render loop
      workerClient.start();

      // Load the demo object
      loadOBJ("roman_head.obj", "Monkey");

      // Handle resize
      window.addEventListener("resize", resizeCanvas);

      // Handle keyboard
      const inputManager = inputManagerRef.current;

      handleKeyDown = (e: KeyboardEvent) => {
        const editor = editorRef.current;
        const scene = sceneRef.current;

        // Track held keys for camera movement
        inputManager.setTransformActive(editor?.transformMode !== "none");

        // Skip viewport shortcuts if pointer is not over viewport (allows typing in input fields)
        // Exception: Escape key should always work to cancel transforms
        const isEscape = e.key === "Escape";
        const isActiveTransform = editor && editor.transformMode !== "none";

        if (
          !inputManager.getPointerOverViewport() &&
          !isEscape &&
          !isActiveTransform
        ) {
          return; // Let the event propagate to input fields
        }

        // Shift+A for Add menu (like Blender)
        if (
          e.key.toLowerCase() === "a" &&
          e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          // Get mouse position for menu placement
          const mouseState = inputManager.getMouseState();
          setAddMenuPos({ x: mouseState.x, y: mouseState.y });
          e.preventDefault();
          return;
        }

        // Z key for view mode cycling (like Blender's Z menu)
        if (e.key.toLowerCase() === "z" && !e.ctrlKey && !e.metaKey && editor) {
          // Don't handle Z during transforms (it's axis constraint)
          if (editor.transformMode === "none") {
            // Cycle through view modes: wireframe -> solid -> material -> wireframe
            const modes: ViewMode[] = ["wireframe", "solid", "material"];
            const currentIndex = modes.indexOf(editor.viewMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            editor.setViewMode(modes[nextIndex]);
            // Update settings on worker for new view mode
            workerClient.setSettings(
              buildRenderSettings(settings, modes[nextIndex])
            );
            updateUIState(true); // Force immediate update for user action
            e.preventDefault();
            return;
          }
        }

        // Let editor handle shortcuts first (pass modifier keys)
        if (
          editor &&
          editor.handleKeyDown(
            e.key,
            e.ctrlKey || e.metaKey,
            e.shiftKey,
            e.altKey
          )
        ) {
          e.preventDefault();
          return;
        }

        // Blender-style numpad viewpoints
        const key = e.key;
        if (key === "1") {
          scene.camera.setViewpoint(e.ctrlKey || e.metaKey ? "back" : "front");
          setIsOrtho(scene.camera.orthographic);
          e.preventDefault();
          return;
        }
        if (key === "3") {
          scene.camera.setViewpoint(e.ctrlKey || e.metaKey ? "left" : "right");
          setIsOrtho(scene.camera.orthographic);
          e.preventDefault();
          return;
        }
        if (key === "7") {
          scene.camera.setViewpoint(e.ctrlKey || e.metaKey ? "bottom" : "top");
          setIsOrtho(scene.camera.orthographic);
          e.preventDefault();
          return;
        }
        if (key === "0") {
          scene.camera.setViewpoint("persp");
          setIsOrtho(scene.camera.orthographic);
          e.preventDefault();
          return;
        }
        if (key === "5") {
          // Toggle orthographic/perspective (Blender Numpad 5)
          scene.camera.orthographic = !scene.camera.orthographic;
          setIsOrtho(scene.camera.orthographic);
          e.preventDefault();
          return;
        }
      };
      handleKeyUp = (e: KeyboardEvent) => {
        // InputManager tracks held keys internally
      };

      // Initialize input manager keyboard tracking
      inputManager.init();

      // Also add our custom handlers
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      // Handle mouse
      handleMouseDown = (e: MouseEvent) => {
        const editor = editorRef.current;
        const canvas = canvasRef.current;
        const dims = renderDimensionsRef.current;

        inputManager.setMouseDragging(true, e.button);
        inputManager.updateMousePosition(e.clientX, e.clientY);

        // Left click for selection (only if not in transform mode)
        if (e.button === 0 && editor && canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Scale to render resolution
          const scaleX = dims.renderWidth / rect.width;
          const scaleY = dims.renderHeight / rect.height;

          editor.handleClick(
            x * scaleX,
            y * scaleY,
            dims.renderWidth,
            dims.renderHeight,
            e.shiftKey,
            e.altKey,
            e.ctrlKey || e.metaKey
          );
        }
      };
      handleMouseUp = () => {
        inputManager.setMouseDragging(false);
      };
      handleMouseMove = (e: MouseEvent) => {
        const editor = editorRef.current;
        const canvas = canvasRef.current;
        const dims = renderDimensionsRef.current;
        const mouseState = inputManager.getMouseState();

        const deltaX = e.clientX - mouseState.x;
        const deltaY = e.clientY - mouseState.y;

        // Always update mouse position for features like Shift+A menu
        inputManager.updateMousePosition(e.clientX, e.clientY);

        // If in transform mode, update transform
        if (editor && editor.transformMode !== "none" && canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const scaleX = dims.renderWidth / rect.width;
          const scaleY = dims.renderHeight / rect.height;

          editor.updateTransform(
            deltaX,
            deltaY,
            x * scaleX,
            y * scaleY,
            dims.renderWidth,
            dims.renderHeight,
            e.ctrlKey || e.metaKey // For vertex snapping
          );
        }
      };
      handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const camera = sceneRef.current.camera;

        if (e.metaKey || e.ctrlKey) {
          // Cmd/Ctrl + two fingers: zoom
          camera.zoom(e.deltaY * 0.05);
        } else if (e.shiftKey) {
          // Shift + two fingers: pan
          camera.pan(-e.deltaX * 0.005, -e.deltaY * 0.005);
        } else {
          // Two fingers only: orbit (rotate camera)
          camera.orbit(-e.deltaX * 0.005, -e.deltaY * 0.005);
        }
      };
      handleContextMenu = (e: MouseEvent) => {
        e.preventDefault(); // Prevent browser right-click menu

        // Don't show context menu if Ctrl is held (Ctrl+click on macOS triggers contextmenu)
        // Ctrl is used for vertex snapping
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        // Only show context menu if right-clicking directly on an object
        const editor = editorRef.current;
        const canvas = canvasRef.current;
        const dims = renderDimensionsRef.current;
        if (editor && canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Scale to render resolution
          const scaleX = dims.renderWidth / rect.width;
          const scaleY = dims.renderHeight / rect.height;

          // Check if we clicked on an object
          const clickedObj = editor.pickObject(
            x * scaleX,
            y * scaleY,
            dims.renderWidth,
            dims.renderHeight
          );

          if (clickedObj) {
            // Select the clicked object and show context menu
            editor.scene.selectObject(clickedObj);
            setContextMenuPos({ x: e.clientX, y: e.clientY });
          }
        }
      };

      // Track pointer over viewport for context-aware shortcuts (like Blender)
      handleViewportEnter = () => {
        inputManager.setPointerOverViewport(true);
      };
      handleViewportLeave = () => {
        inputManager.setPointerOverViewport(false);
      };

      canvas.addEventListener("mousedown", handleMouseDown);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("wheel", handleWheel, { passive: false });
      canvas.addEventListener("contextmenu", handleContextMenu);
      canvas.addEventListener("mouseenter", handleViewportEnter);
      canvas.addEventListener("mouseleave", handleViewportLeave);

      // Main render loop - runs on main thread, builds frames and sends to worker
      const targetFPS = 24;
      const frameInterval = 1000 / targetFPS;
      let lastRenderTime = 0;
      let frameCount = 0;
      let fpsTime = 0;
      let lastTime = performance.now();

      const tick = (currentTime: number) => {
        renderLoopIdRef.current = requestAnimationFrame(tick);

        // FPS limiting
        const elapsed = currentTime - lastRenderTime;
        if (elapsed < frameInterval) {
          return;
        }
        lastRenderTime = currentTime - (elapsed % frameInterval);

        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        // Update UI state
        updateUIState();

        // Build render frame from current scene state
        const dims = renderDimensionsRef.current;
        const ctx: WorkerRenderContext = {
          scene: sceneRef.current,
          editor: editorRef.current!,
          gridData: gridDataRef.current,
          settings: settings,
          renderWidth: dims.renderWidth,
          renderHeight: dims.renderHeight,
          currentTexture: textureRef.current,
        };

        const frame = buildRenderFrame(ctx, textureChangedRef.current);
        textureChangedRef.current = false;

        // Send frame to worker
        workerClient.render(frame);

        // FPS tracking (for local debug - worker also sends its own stats)
        frameCount++;
        fpsTime += deltaTime;
        if (fpsTime >= 1000) {
          frameCount = 0;
          fpsTime = 0;
        }
      };

      renderLoopIdRef.current = requestAnimationFrame(tick);
    });

    // Cleanup
    return () => {
      if (renderLoopIdRef.current) {
        cancelAnimationFrame(renderLoopIdRef.current);
        renderLoopIdRef.current = 0;
      }
      workerClient.terminate();
      window.removeEventListener("resize", resizeCanvas);
      if (handleKeyDown) window.removeEventListener("keydown", handleKeyDown);
      if (handleKeyUp) window.removeEventListener("keyup", handleKeyUp);
      if (handleMouseUp) window.removeEventListener("mouseup", handleMouseUp);
      if (handleMouseMove)
        window.removeEventListener("mousemove", handleMouseMove);
      if (handleMouseDown)
        canvas.removeEventListener("mousedown", handleMouseDown);
      if (handleWheel) canvas.removeEventListener("wheel", handleWheel);
      if (handleContextMenu)
        canvas.removeEventListener("contextmenu", handleContextMenu);
      if (handleViewportEnter)
        canvas.removeEventListener("mouseenter", handleViewportEnter);
      if (handleViewportLeave)
        canvas.removeEventListener("mouseleave", handleViewportLeave);
    };
  }, [resizeCanvas, loadOBJ, updateUIState]);

  return (
    <div className="app-layout">
      <Toolbar
        mode={editorMode}
        transformMode={transformMode}
        viewMode={viewMode}
        selectionMode={selectionMode}
        onModeChange={handleModeChange}
        onViewModeChange={handleViewModeChange}
        onSelectionModeChange={handleSelectionModeChange}
      />
      <SceneTree
        objects={sceneObjects}
        onSelectObject={handleSelectObject}
        onToggleVisibility={handleToggleVisibility}
      />
      <div className="viewport" ref={viewportRef}>
        <canvas id="canvas" ref={canvasRef} />
        <Instructions />
        <ViewportGizmo
          onViewpointChange={handleViewpointChange}
          onToggleOrtho={handleToggleOrtho}
          isOrtho={isOrtho}
        />
      </div>
      <PropertiesPanel
        objectName={selectedObjectName}
        position={selectedPosition}
        rotation={selectedRotation}
        scale={selectedScale}
        onPositionChange={handlePositionChange}
        onRotationChange={handleRotationChange}
        onScaleChange={handleScaleChange}
      />
      <StatusBar
        mode={editorMode}
        selectionMode={selectionMode}
        transformMode={transformMode}
        axisConstraint={axisConstraint}
        selectedCount={sceneObjects.filter((o) => o.selected).length}
        vertexCount={selectedVertexCount}
        edgeCount={selectedEdgeCount}
        faceCount={selectedFaceCount}
        fps={fps}
        frameTime={frameTime}
        renderWidth={renderWidth}
        renderHeight={renderHeight}
      />
      {addMenuPos && (
        <AddMenu
          x={addMenuPos.x}
          y={addMenuPos.y}
          onSelect={handleAddPrimitive}
          onClose={() => setAddMenuPos(null)}
        />
      )}
      {contextMenuPos && (
        <ShadingContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          onAction={(action) => {
            const editor = editorRef.current;
            if (editor) {
              const selected = editor.scene.getSelectedObjects();
              for (const obj of selected) {
                if (action === "shade-smooth") {
                  obj.mesh.smoothShading = true;
                } else if (action === "shade-flat") {
                  obj.mesh.smoothShading = false;
                } else if (action === "origin-to-center") {
                  // Move mesh vertices so that center becomes the origin
                  const center = obj.mesh.getCenter();
                  for (const vertex of obj.mesh.vertices) {
                    vertex.position = vertex.position.sub(center);
                  }
                  // Move object position by the same amount (in world space) to compensate
                  obj.position = obj.position.add(center);
                  obj.mesh.rebuildTriangles();
                }
              }
            }
          }}
          onClose={() => setContextMenuPos(null)}
        />
      )}
    </div>
  );
}

// Mount React app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
