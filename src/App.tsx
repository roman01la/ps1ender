import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
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
} from "./primitives";
import { OBJLoader, loadOBJToScene } from "./obj-loader";
import { GLTFLoader, loadGLTFToScene } from "./gltf-loader";
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
  clearTextureCache,
} from "./systems/worker-render-loop";
import { Texture } from "./texture";
import { Material } from "./material";
import { Toolbar } from "./components/Toolbar";
import { WorkspaceType } from "./components/WorkspaceTabs";
import { Viewport } from "./components/Viewport";
import { Sidebar } from "./components/Sidebar";
import { ShadingWorkspace } from "./components/ShadingWorkspace";
import { StatusBar } from "./components/StatusBar";
import { AddMenu, PrimitiveType } from "./components/AddMenu";
import { ShadingContextMenu } from "./components/ShadingContextMenu";
import { WelcomeModal, shouldShowWelcome } from "./components/WelcomeModal";
import { PrimitiveParams } from "./components/PrimitiveSettings";

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
    selectedDimensions,
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

  // Welcome modal state
  const [showWelcome, setShowWelcome] = useState(shouldShowWelcome);

  // Workspace state
  const [workspace, setWorkspace] = useState<WorkspaceType>("modeling");

  // Selected material in shading workspace
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(
    null
  );
  // Track material list for re-render (registry changes don't trigger re-render)
  const [materialList, setMaterialList] = useState<Material[]>([]);

  // Build texture map from scene's texture registry for shader editor previews
  const textureMap = useMemo(() => {
    const scene = sceneRef.current;
    // Return the scene's texture registry directly
    // This contains all registered textures keyed by their path/ID
    return scene.textures;
  }, [sceneObjects, materialList]);

  // Primitive settings modal state (appears after creating a primitive)
  const [primitiveParams, setPrimitiveParams] =
    useState<PrimitiveParams | null>(null);
  const newPrimitiveRef = useRef<SceneObject | null>(null);

  // Box selection state
  const [boxSelection, setBoxSelection] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    active: boolean;
  } | null>(null);
  const boxSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const BOX_SELECT_THRESHOLD = 5; // Pixels of movement before activating box select

  // Dismiss primitive settings modal when selection changes away from new primitive
  useEffect(() => {
    if (primitiveParams && newPrimitiveRef.current) {
      const newObj = newPrimitiveRef.current;
      // If the new primitive is no longer selected, submit and close modal
      if (selectedObjectName !== newObj.name) {
        const editor = editorRef.current;
        if (editor) {
          editor.recordObjectAdd(newObj);
        }
        newPrimitiveRef.current = null;
        setPrimitiveParams(null);
      }
    }
  }, [selectedObjectName, primitiveParams]);

  // Sync selected material with selected object when in shading workspace
  useEffect(() => {
    if (workspace === "shading" && selectedObjectName) {
      const scene = sceneRef.current;
      const obj = scene.objects.find((o) => o.name === selectedObjectName);
      if (obj && obj.materialId) {
        setSelectedMaterialId(obj.materialId);
      }
    }
  }, [selectedObjectName, workspace]);

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
  const loadOBJ = useCallback(async (url: string) => {
    const scene = sceneRef.current;

    try {
      console.log(`Loading OBJ: ${url}`);
      // Clear texture cache so new textures are sent to worker
      clearTextureCache();

      const result = await loadOBJToScene(url, scene);

      // Set up texture reference for worker
      if (result.defaultTexture) {
        textureRef.current = result.defaultTexture;
        textureChangedRef.current = true;
      }

      // Update material list state
      setMaterialList([...scene.materials.getAll()]);

      // Select the first object's material in shader editor
      if (result.firstObject?.materialId) {
        setSelectedMaterialId(result.firstObject.materialId);
      }
    } catch (error) {
      console.warn(`Could not load OBJ file: ${error}`);
    }
  }, []);

  // Load GLTF/GLB file and add to scene
  const loadGLTF = useCallback(async (url: string) => {
    const scene = sceneRef.current;

    try {
      console.log(`Loading GLTF: ${url}`);
      // Clear texture cache so new textures are sent to worker
      clearTextureCache();

      const result = await loadGLTFToScene(url, scene);

      // Set up texture reference for worker
      if (result.defaultTexture) {
        textureRef.current = result.defaultTexture;
        textureChangedRef.current = true;
      }

      // Update material list state
      setMaterialList([...scene.materials.getAll()]);

      // Select the first object's material in shader editor
      if (result.firstObject?.materialId) {
        setSelectedMaterialId(result.firstObject.materialId);
      }
    } catch (error) {
      console.warn(`Could not load GLTF file: ${error}`);
    }
  }, []);

  // Load 3D file based on extension
  const loadModelFile = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      const ext = file.name.toLowerCase().split(".").pop();

      try {
        if (ext === "obj") {
          await loadOBJ(url);
        } else if (ext === "gltf" || ext === "glb") {
          await loadGLTF(url);
        } else {
          console.warn(`Unsupported file format: ${ext}`);
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [loadOBJ, loadGLTF]
  );

  // Handle drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from(e.dataTransfer.files);
      const modelFiles = files.filter((file) => {
        const ext = file.name.toLowerCase().split(".").pop();
        return ext === "obj" || ext === "gltf" || ext === "glb";
      });

      for (const file of modelFiles) {
        loadModelFile(file);
      }
    },
    [loadModelFile]
  );

  // Track last selected object for shift-select range
  const lastSelectedRef = useRef<string | null>(null);

  // Handle object selection from scene tree
  const handleSelectObject = useCallback(
    (name: string, modifiers: { shiftKey: boolean; ctrlKey: boolean }) => {
      const scene = sceneRef.current;
      const obj = scene.objects.find((o) => o.name === name);
      if (!obj) return;

      if (modifiers.shiftKey && lastSelectedRef.current) {
        // Shift+click: select range from last selected to current
        const lastIdx = scene.objects.findIndex(
          (o) => o.name === lastSelectedRef.current
        );
        const currentIdx = scene.objects.findIndex((o) => o.name === name);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const startIdx = Math.min(lastIdx, currentIdx);
          const endIdx = Math.max(lastIdx, currentIdx);
          for (let i = startIdx; i <= endIdx; i++) {
            scene.objects[i].selected = true;
          }
          scene.activeObject = obj;
        }
      } else if (modifiers.ctrlKey) {
        // Ctrl/Cmd+click: toggle selection
        obj.selected = !obj.selected;
        if (obj.selected) {
          scene.activeObject = obj;
        } else if (scene.activeObject === obj) {
          // Find another selected object to be active
          const otherSelected = scene.objects.find(
            (o) => o.selected && o !== obj
          );
          scene.activeObject = otherSelected || null;
        }
        lastSelectedRef.current = name;
      } else {
        // Normal click: select only this object
        scene.selectObject(obj);
        lastSelectedRef.current = name;
      }

      updateUIState(true); // Force immediate update for user action
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

      // Generate unique name
      const typeNames: Record<PrimitiveType, string> = {
        plane: "Plane",
        cube: "Cube",
        circle: "Circle",
        uvsphere: "UVSphere",
        icosphere: "IcoSphere",
        cylinder: "Cylinder",
        cone: "Cone",
        torus: "Torus",
      };
      const baseName = typeNames[type];
      let name = baseName;
      let counter = 1;
      while (scene.objects.some((o) => o.name === name)) {
        name = `${baseName}.${String(counter).padStart(3, "0")}`;
        counter++;
      }

      // Default params for each type
      const defaultParams: PrimitiveParams = (() => {
        switch (type) {
          case "plane":
            return { type: "plane", planeSize: 2 };
          case "circle":
            return { type: "circle", circleRadius: 1, circleVertices: 32 };
          case "cube":
            return { type: "cube", cubeSize: 2 };
          case "uvsphere":
            return {
              type: "uvsphere",
              uvSphereSegments: 32,
              uvSphereRings: 16,
              uvSphereRadius: 1,
            };
          case "icosphere":
            return {
              type: "icosphere",
              icoSphereSubdivisions: 2,
              icoSphereRadius: 1,
            };
          case "cylinder":
            return {
              type: "cylinder",
              cylinderVertices: 32,
              cylinderRadius: 1,
              cylinderDepth: 2,
            };
          case "cone":
            return {
              type: "cone",
              coneVertices: 32,
              coneRadius1: 1,
              coneRadius2: 0,
              coneDepth: 2,
            };
          case "torus":
            return {
              type: "torus",
              torusMajorSegments: 48,
              torusMinorSegments: 12,
              torusMajorRadius: 1,
              torusMinorRadius: 0.25,
            };
        }
      })();

      // Create the mesh with default params
      const mesh = createPrimitiveMesh(defaultParams);

      // Create scene object
      const obj = new SceneObject(name, mesh);

      // Add to scene and select it
      scene.addObject(obj);
      scene.selectObject(obj);

      // Store reference and show settings modal (don't add to history yet)
      newPrimitiveRef.current = obj;
      setPrimitiveParams(defaultParams);

      updateUIState(true);
      setAddMenuPos(null);
    },
    [updateUIState]
  );

  // Helper to create mesh from params
  const createPrimitiveMesh = (params: PrimitiveParams) => {
    switch (params.type) {
      case "plane":
        return createPlaneMesh(params.planeSize ?? 2);
      case "circle":
        return createCircleMesh(
          params.circleRadius ?? 1,
          params.circleVertices ?? 32
        );
      case "cube":
        return createCubeMesh(params.cubeSize ?? 2);
      case "uvsphere":
        return createUVSphereMesh(
          params.uvSphereRadius ?? 1,
          params.uvSphereSegments ?? 32,
          params.uvSphereRings ?? 16
        );
      case "icosphere":
        return createIcoSphereMesh(
          params.icoSphereRadius ?? 1,
          params.icoSphereSubdivisions ?? 2
        );
      case "cylinder":
        return createCylinderMesh(
          params.cylinderRadius ?? 1,
          params.cylinderDepth ?? 2,
          params.cylinderVertices ?? 32
        );
      case "cone":
        return createConeMesh(
          params.coneRadius1 ?? 1,
          params.coneRadius2 ?? 0,
          params.coneDepth ?? 2,
          params.coneVertices ?? 32
        );
      case "torus":
        return createTorusMesh(
          params.torusMajorRadius ?? 1,
          params.torusMinorRadius ?? 0.25,
          params.torusMajorSegments ?? 48,
          params.torusMinorSegments ?? 12
        );
    }
  };

  // Handle primitive params change (regenerate mesh)
  const handlePrimitiveParamsChange = useCallback((params: PrimitiveParams) => {
    const obj = newPrimitiveRef.current;
    if (!obj) return;

    // Regenerate mesh based on new params
    const mesh = createPrimitiveMesh(params);

    // Replace mesh on the object
    obj.mesh = mesh;
    setPrimitiveParams(params);
  }, []);

  // Submit primitive (finalize creation, add to history)
  const handlePrimitiveSubmit = useCallback(() => {
    const obj = newPrimitiveRef.current;
    const editor = editorRef.current;

    if (obj && editor) {
      // Now record in history for undo support
      editor.recordObjectAdd(obj);
    }

    // Clear modal
    newPrimitiveRef.current = null;
    setPrimitiveParams(null);
  }, []);

  // Handle transform property changes from properties panel
  const beforeTransformRef = useRef<{
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
    objectName: string;
  } | null>(null);

  const handleEditStart = useCallback(() => {
    const scene = sceneRef.current;
    const selected = scene.getSelectedObjects();
    if (selected.length > 0) {
      const obj = selected[0];
      beforeTransformRef.current = {
        position: obj.position.clone(),
        rotation: obj.rotation.clone(),
        scale: obj.scale.clone(),
        objectName: obj.name,
      };
    }
  }, []);

  const handleEditEnd = useCallback(() => {
    const scene = sceneRef.current;
    const editor = editorRef.current;
    const selected = scene.getSelectedObjects();
    const before = beforeTransformRef.current;

    if (selected.length > 0 && before && editor) {
      const obj = selected[0];
      // Only push to history if something actually changed
      const posChanged =
        obj.position.x !== before.position.x ||
        obj.position.y !== before.position.y ||
        obj.position.z !== before.position.z;
      const rotChanged =
        obj.rotation.x !== before.rotation.x ||
        obj.rotation.y !== before.rotation.y ||
        obj.rotation.z !== before.rotation.z;
      const scaleChanged =
        obj.scale.x !== before.scale.x ||
        obj.scale.y !== before.scale.y ||
        obj.scale.z !== before.scale.z;

      if (posChanged || rotChanged || scaleChanged) {
        editor.pushTransformToHistory(
          before.objectName,
          before.position,
          before.rotation,
          before.scale,
          obj.position.clone(),
          obj.rotation.clone(),
          obj.scale.clone()
        );
      }
    }
    beforeTransformRef.current = null;
  }, []);

  // Material handling callbacks for shading workspace
  const handleSelectMaterial = useCallback((id: string) => {
    setSelectedMaterialId(id);
    // Assign to selected object if in shading workspace
    const scene = sceneRef.current;
    const selectedObjs = scene.getSelectedObjects();
    if (selectedObjs.length > 0) {
      for (const obj of selectedObjs) {
        obj.materialId = id;
      }
    }
  }, []);

  const handleMaterialChange = useCallback((newMaterial: Material) => {
    const scene = sceneRef.current;
    scene.materials.update(newMaterial);
    // Update material list to trigger re-render
    setMaterialList([...scene.materials.getAll()]);
  }, []);

  const handleNewMaterial = useCallback(() => {
    const scene = sceneRef.current;
    const newMat = scene.materials.createMaterial("Material");
    setMaterialList([...scene.materials.getAll()]);
    setSelectedMaterialId(newMat.id);
    // Assign to selected object
    const selectedObjs = scene.getSelectedObjects();
    if (selectedObjs.length > 0) {
      for (const obj of selectedObjs) {
        obj.materialId = newMat.id;
      }
    }
  }, []);

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
    let handleMouseUp: (e: MouseEvent) => void;
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
      loadOBJ("roman_head.obj");

      // Initialize material list from registry
      setMaterialList(scene.materials.getAll());
      setSelectedMaterialId(scene.materials.getDefault().id);

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

        inputManager.setMouseDragging(true, e.button);
        inputManager.updateMousePosition(e.clientX, e.clientY);

        // Left click: record start position for potential box selection
        if (e.button === 0 && editor && canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Store the start position for box selection detection
          boxSelectionStartRef.current = { x, y };
        }
      };
      handleMouseUp = (e: MouseEvent) => {
        const editor = editorRef.current;
        const canvas = canvasRef.current;
        const dims = renderDimensionsRef.current;

        inputManager.setMouseDragging(false);

        // Handle left button release
        if (e.button === 0 && editor && canvas) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = dims.renderWidth / rect.width;
          const scaleY = dims.renderHeight / rect.height;

          // Check if we were in box selection mode
          if (boxSelectionStartRef.current) {
            const startX = boxSelectionStartRef.current.x;
            const startY = boxSelectionStartRef.current.y;
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;

            const deltaX = Math.abs(endX - startX);
            const deltaY = Math.abs(endY - startY);

            if (
              deltaX > BOX_SELECT_THRESHOLD ||
              deltaY > BOX_SELECT_THRESHOLD
            ) {
              // Box selection: select elements within the box
              const boxMinX = Math.min(startX, endX) * scaleX;
              const boxMinY = Math.min(startY, endY) * scaleY;
              const boxMaxX = Math.max(startX, endX) * scaleX;
              const boxMaxY = Math.max(startY, endY) * scaleY;

              if (editor.mode === "object") {
                // Object mode box selection
                const selectedObjects = editor.boxSelectObjects(
                  boxMinX,
                  boxMinY,
                  boxMaxX,
                  boxMaxY,
                  dims.renderWidth,
                  dims.renderHeight
                );

                // Apply selection
                if (!e.shiftKey) {
                  sceneRef.current.deselectAll();
                }
                for (const obj of selectedObjects) {
                  obj.selected = true;
                  sceneRef.current.activeObject = obj;
                }

                updateUIState(true);
              } else if (editor.mode === "edit") {
                // Edit mode box selection
                editor.boxSelectElements(
                  boxMinX,
                  boxMinY,
                  boxMaxX,
                  boxMaxY,
                  dims.renderWidth,
                  dims.renderHeight,
                  e.shiftKey
                );
                updateUIState(true);
              }
            } else {
              // Normal click selection
              editor.handleClick(
                endX * scaleX,
                endY * scaleY,
                dims.renderWidth,
                dims.renderHeight,
                e.shiftKey,
                e.altKey,
                e.ctrlKey || e.metaKey
              );
            }
          }
        }

        // Clear box selection state
        boxSelectionStartRef.current = null;
        setBoxSelection(null);
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

        // Handle box selection dragging (click+drag in both object and edit mode)
        const canBoxSelect =
          boxSelectionStartRef.current &&
          mouseState.isDragging &&
          mouseState.button === 0 &&
          editor &&
          editor.transformMode === "none" &&
          canvas;

        if (canBoxSelect) {
          const rect = canvas.getBoundingClientRect();
          const currentX = e.clientX - rect.left;
          const currentY = e.clientY - rect.top;
          const startX = boxSelectionStartRef.current!.x;
          const startY = boxSelectionStartRef.current!.y;

          const deltaBoxX = Math.abs(currentX - startX);
          const deltaBoxY = Math.abs(currentY - startY);

          // Activate box selection after threshold
          if (
            deltaBoxX > BOX_SELECT_THRESHOLD ||
            deltaBoxY > BOX_SELECT_THRESHOLD
          ) {
            setBoxSelection({
              startX,
              startY,
              currentX,
              currentY,
              active: true,
            });
          }
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
    <div
      className={`app-layout ${
        workspace === "shading" ? "shading-workspace" : ""
      }`}
    >
      <Toolbar
        mode={editorMode}
        transformMode={transformMode}
        viewMode={viewMode}
        selectionMode={selectionMode}
        workspace={workspace}
        onModeChange={handleModeChange}
        onViewModeChange={handleViewModeChange}
        onSelectionModeChange={handleSelectionModeChange}
        onWorkspaceChange={setWorkspace}
      />
      <Viewport
        viewportRef={viewportRef}
        canvasRef={canvasRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onViewpointChange={handleViewpointChange}
        onToggleOrtho={handleToggleOrtho}
        isOrtho={isOrtho}
        primitiveParams={primitiveParams}
        onPrimitiveParamsChange={handlePrimitiveParamsChange}
        onPrimitiveSubmit={handlePrimitiveSubmit}
        boxSelection={boxSelection}
      />
      {workspace === "shading" && (
        <ShadingWorkspace
          materials={materialList}
          selectedMaterialId={selectedMaterialId}
          textureMap={textureMap}
          onSelectMaterial={handleSelectMaterial}
          onMaterialChange={handleMaterialChange}
          onNewMaterial={handleNewMaterial}
        />
      )}
      <Sidebar
        objects={sceneObjects}
        onSelectObject={handleSelectObject}
        onToggleVisibility={handleToggleVisibility}
        selectedObjectName={selectedObjectName}
        selectedPosition={selectedPosition}
        selectedRotation={selectedRotation}
        selectedScale={selectedScale}
        selectedDimensions={selectedDimensions}
        onPositionChange={handlePositionChange}
        onRotationChange={handleRotationChange}
        onScaleChange={handleScaleChange}
        onEditStart={handleEditStart}
        onEditEnd={handleEditEnd}
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
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
    </div>
  );
}

// Mount React app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
