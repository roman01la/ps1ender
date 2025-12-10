/**
 * UI State System - Manages editor UI state synchronization
 *
 * This system provides:
 * - A custom React hook for editor UI state
 * - Throttled state updates from editor/scene
 * - Force update logic for immediate user feedback
 */

import { useState, useCallback, useRef } from "react";
import { Vector3 } from "../math";
import { Scene } from "../scene";
import {
  Editor,
  EditorMode,
  TransformMode,
  AxisConstraint,
  ViewMode,
  SelectionMode,
} from "../editor";

/**
 * Scene object info for UI display
 */
export interface SceneObjectInfo {
  name: string;
  selected: boolean;
  visible: boolean;
}

/**
 * Renderer settings
 */
export interface RendererSettings {
  wireframe: boolean;
  lighting: boolean;
  texturing: boolean;
  showGrid: boolean;
}

/**
 * Complete UI state structure
 */
export interface UIState {
  fps: number;
  editorMode: EditorMode;
  selectionMode: SelectionMode;
  transformMode: TransformMode;
  axisConstraint: AxisConstraint;
  viewMode: ViewMode;
  sceneObjects: SceneObjectInfo[];
  selectedObjectName: string | null;
  selectedPosition: Vector3;
  selectedRotation: Vector3;
  selectedScale: Vector3;
  selectedVertexCount: number;
  selectedEdgeCount: number;
  selectedFaceCount: number;
  settings: RendererSettings;
}

/**
 * UI State setters
 */
export interface UIStateSetters {
  setFps: (fps: number) => void;
  setEditorMode: (mode: EditorMode) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setAxisConstraint: (axis: AxisConstraint) => void;
  setViewMode: (mode: ViewMode) => void;
  setSceneObjects: (objects: SceneObjectInfo[]) => void;
  setSelectedObjectName: (name: string | null) => void;
  setSelectedPosition: (pos: Vector3) => void;
  setSelectedRotation: (rot: Vector3) => void;
  setSelectedScale: (scale: Vector3) => void;
  setSelectedVertexCount: (count: number) => void;
  setSelectedEdgeCount: (count: number) => void;
  setSelectedFaceCount: (count: number) => void;
  setSettings: (settings: RendererSettings) => void;
}

/**
 * UI State actions
 */
export interface UIStateActions {
  /** Update UI state from editor/scene (throttled unless force=true) */
  updateUIState: (force?: boolean) => void;
  /** Handle editor mode change from UI */
  handleModeChange: (mode: EditorMode) => void;
  /** Handle view mode change from UI */
  handleViewModeChange: (mode: ViewMode) => void;
  /** Handle selection mode change from UI (vertex/edge/face) */
  handleSelectionModeChange: (mode: SelectionMode) => void;
  /** Handle settings change from UI */
  handleSettingsChange: (settings: RendererSettings) => void;
}

/**
 * Default renderer settings
 */
export const DEFAULT_SETTINGS: RendererSettings = {
  wireframe: false,
  lighting: true,
  texturing: true,
  showGrid: true,
};

/**
 * UI update throttle interval in ms
 */
const UI_UPDATE_INTERVAL = 50;

/**
 * Custom hook for managing editor UI state
 *
 * This hook encapsulates all UI state management including:
 * - React state variables for editor/scene state
 * - Throttled state updates
 * - UI action handlers
 *
 * @param editorRef - Ref to the Editor instance
 * @param sceneRef - Ref to the Scene instance
 * @returns UI state, setters, and action handlers
 */
export function useEditorUIState(
  editorRef: React.RefObject<Editor | null>,
  sceneRef: React.RefObject<Scene>
): {
  state: UIState;
  setters: UIStateSetters;
  actions: UIStateActions;
} {
  // UI state
  const [fps, setFps] = useState(0);
  const [editorMode, setEditorMode] = useState<EditorMode>("object");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("vertex");
  const [transformMode, setTransformMode] = useState<TransformMode>("none");
  const [axisConstraint, setAxisConstraint] = useState<AxisConstraint>("none");
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [sceneObjects, setSceneObjects] = useState<SceneObjectInfo[]>([]);
  const [selectedObjectName, setSelectedObjectName] = useState<string | null>(
    null
  );
  const [selectedPosition, setSelectedPosition] = useState<Vector3>(
    Vector3.zero()
  );
  const [selectedRotation, setSelectedRotation] = useState<Vector3>(
    Vector3.zero()
  );
  const [selectedScale, setSelectedScale] = useState<Vector3>(
    new Vector3(1, 1, 1)
  );
  const [selectedVertexCount, setSelectedVertexCount] = useState(0);
  const [selectedEdgeCount, setSelectedEdgeCount] = useState(0);
  const [selectedFaceCount, setSelectedFaceCount] = useState(0);
  const [settings, setSettings] = useState<RendererSettings>(DEFAULT_SETTINGS);

  // Throttling ref
  const lastUIUpdateRef = useRef<number>(0);

  // Update UI state from editor/scene (core implementation)
  const updateUIStateImpl = useCallback(() => {
    const editor = editorRef.current;
    const scene = sceneRef.current;
    if (!editor) return;

    // Update editor mode and transform state
    setEditorMode(editor.mode);
    setSelectionMode(editor.selectionMode);
    setTransformMode(editor.transformMode);
    setAxisConstraint(editor.axisConstraint);
    setViewMode(editor.viewMode);
    setSelectedVertexCount(editor.selectedVertices.size);
    setSelectedEdgeCount(editor.selectedEdges.size);
    setSelectedFaceCount(editor.selectedFaces.size);

    // Update scene objects list
    const objects: SceneObjectInfo[] = scene.objects.map((obj) => ({
      name: obj.name,
      selected: obj.selected,
      visible: obj.visible,
    }));
    setSceneObjects(objects);

    // Update selected object properties
    const selected = scene.getSelectedObjects();
    if (selected.length > 0) {
      const obj = selected[0];
      setSelectedObjectName(obj.name);
      setSelectedPosition(obj.position.clone());
      setSelectedRotation(obj.rotation.clone());
      setSelectedScale(obj.scale.clone());
    } else {
      setSelectedObjectName(null);
    }
  }, [editorRef, sceneRef]);

  // Throttled UI update - only updates at most every UI_UPDATE_INTERVAL ms
  const updateUIState = useCallback(
    (force = false) => {
      const now = performance.now();
      if (force || now - lastUIUpdateRef.current >= UI_UPDATE_INTERVAL) {
        lastUIUpdateRef.current = now;
        updateUIStateImpl();
      }
    },
    [updateUIStateImpl]
  );

  // Handle mode change from UI
  const handleModeChange = useCallback(
    (mode: EditorMode) => {
      const editor = editorRef.current;
      if (editor) {
        editor.setMode(mode);
        updateUIState(true); // Force immediate update for user action
      }
    },
    [editorRef, updateUIState]
  );

  // Handle view mode change from UI
  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      const editor = editorRef.current;
      if (editor) {
        editor.setViewMode(mode);
        updateUIState(true); // Force immediate update for user action
      }
    },
    [editorRef, updateUIState]
  );

  // Handle selection mode change from UI (vertex/edge/face)
  const handleSelectionModeChange = useCallback(
    (mode: SelectionMode) => {
      const editor = editorRef.current;
      if (editor) {
        editor.setSelectionMode(mode);
        updateUIState(true); // Force immediate update for user action
      }
    },
    [editorRef, updateUIState]
  );

  // Handle settings change from UI
  const handleSettingsChange = useCallback((newSettings: RendererSettings) => {
    setSettings(newSettings);
  }, []);

  return {
    state: {
      fps,
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
    },
    setters: {
      setFps,
      setEditorMode,
      setSelectionMode,
      setTransformMode,
      setAxisConstraint,
      setViewMode,
      setSceneObjects,
      setSelectedObjectName,
      setSelectedPosition,
      setSelectedRotation,
      setSelectedScale,
      setSelectedVertexCount,
      setSelectedEdgeCount,
      setSelectedFaceCount,
      setSettings,
    },
    actions: {
      updateUIState,
      handleModeChange,
      handleViewModeChange,
      handleSelectionModeChange,
      handleSettingsChange,
    },
  };
}
