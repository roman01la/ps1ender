import React from "react";
import {
  EditorMode,
  TransformMode,
  AxisConstraint,
  SelectionMode,
} from "../editor";

interface StatusBarProps {
  mode: EditorMode;
  selectionMode: SelectionMode;
  transformMode: TransformMode;
  axisConstraint: AxisConstraint;
  selectedCount: number;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  fps: number;
  frameTime: number;
}

export function StatusBar({
  mode,
  selectionMode,
  transformMode,
  axisConstraint,
  selectedCount,
  vertexCount,
  edgeCount,
  faceCount,
  fps,
  frameTime,
}: StatusBarProps) {
  const getModeText = () => {
    const modeStr = mode === "object" ? "Object Mode" : "Edit Mode";
    if (transformMode !== "none") {
      const transformStr =
        transformMode === "grab"
          ? "Grab"
          : transformMode === "rotate"
          ? "Rotate"
          : "Scale";
      const axisStr =
        axisConstraint !== "none" ? ` (${axisConstraint.toUpperCase()})` : "";
      return `${modeStr} | ${transformStr}${axisStr}`;
    }
    return modeStr;
  };

  const getSelectionText = () => {
    if (mode === "edit") {
      const selModeNames = { vertex: "Vertex", edge: "Edge", face: "Face" };
      const selModeName = selModeNames[selectionMode];

      // Get count for current selection mode
      let count = 0;
      let itemName = "";

      switch (selectionMode) {
        case "vertex":
          count = vertexCount;
          itemName = count === 1 ? "vertex" : "vertices";
          break;
        case "edge":
          count = edgeCount;
          itemName = count === 1 ? "edge" : "edges";
          break;
        case "face":
          count = faceCount;
          itemName = count === 1 ? "face" : "faces";
          break;
      }

      return count > 0
        ? `${selModeName}: ${count} ${itemName} selected`
        : `${selModeName}: No selection`;
    }
    return selectedCount > 0
      ? `${selectedCount} object${selectedCount > 1 ? "s" : ""} selected`
      : "No selection";
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-mode">{getModeText()}</span>
        <span className="status-divider">|</span>
        <span className="status-selection">{getSelectionText()}</span>
      </div>
      <div className="status-right">
        <span className="status-fps">
          {fps} FPS ({frameTime.toFixed(1)} ms)
        </span>
      </div>
    </div>
  );
}
