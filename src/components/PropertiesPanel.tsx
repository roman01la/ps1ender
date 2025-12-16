import React, { useState, useEffect, useCallback, useRef } from "react";
import { Vector3 } from "../math";

interface PropertiesPanelProps {
  objectName: string | null;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  dimensions: Vector3;
  onPositionChange: (position: Vector3) => void;
  onRotationChange: (rotation: Vector3) => void;
  onScaleChange: (scale: Vector3) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

interface VectorInputProps {
  label: string;
  value: Vector3;
  onChange: (value: Vector3) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  step?: number;
  precision?: number;
}

function VectorInput({
  label,
  value,
  onChange,
  onEditStart,
  onEditEnd,
  step = 0.1,
  precision = 3,
}: VectorInputProps) {
  const [localX, setLocalX] = useState(value.x.toFixed(precision));
  const [localY, setLocalY] = useState(value.y.toFixed(precision));
  const [localZ, setLocalZ] = useState(value.z.toFixed(precision));

  // Drag state refs (not state to avoid re-renders during drag)
  const dragRef = useRef<{
    axis: "x" | "y" | "z";
    startX: number;
    startValue: number;
  } | null>(null);

  // Update local values when prop changes
  useEffect(() => {
    setLocalX(value.x.toFixed(precision));
    setLocalY(value.y.toFixed(precision));
    setLocalZ(value.z.toFixed(precision));
  }, [value.x, value.y, value.z, precision]);

  const handleChange = useCallback(
    (axis: "x" | "y" | "z", newValue: string) => {
      if (axis === "x") setLocalX(newValue);
      else if (axis === "y") setLocalY(newValue);
      else setLocalZ(newValue);
    },
    []
  );

  // Evaluate math expression or parse number
  const evaluateInput = useCallback((input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Check if it contains math operators (not just a number)
    const hasMathOps = /[+\-*/]/.test(trimmed.replace(/^-/, "")); // ignore leading minus

    if (hasMathOps) {
      // Try evaluating as math expression
      try {
        // Only allow safe math characters
        if (!/^[\d\s+\-*/().]+$/.test(trimmed)) return null;
        // eslint-disable-next-line no-eval
        const result = eval(trimmed);
        if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
          return result;
        }
      } catch {
        // Evaluation failed
      }
      return null;
    }

    // Simple number parsing
    const simple = parseFloat(trimmed);
    if (!isNaN(simple) && isFinite(simple)) return simple;

    return null;
  }, []);

  const handleBlur = useCallback(
    (axis: "x" | "y" | "z") => {
      const inputStr = axis === "x" ? localX : axis === "y" ? localY : localZ;
      const parsed = evaluateInput(inputStr);

      if (parsed !== null) {
        const newValue = new Vector3(
          axis === "x" ? parsed : value.x,
          axis === "y" ? parsed : value.y,
          axis === "z" ? parsed : value.z
        );
        onChange(newValue);
      } else {
        // Reset to original value
        if (axis === "x") setLocalX(value.x.toFixed(precision));
        else if (axis === "y") setLocalY(value.y.toFixed(precision));
        else setLocalZ(value.z.toFixed(precision));
      }
      // Signal edit end for undo tracking
      onEditEnd?.();
    },
    [
      localX,
      localY,
      localZ,
      value,
      onChange,
      precision,
      onEditEnd,
      evaluateInput,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, axis: "x" | "y" | "z") => {
      if (e.key === "Enter") {
        handleBlur(axis);
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleBlur]
  );

  // Drag to scrub value (Blender-style)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, axis: "x" | "y" | "z") => {
      // Only handle left mouse button on the label, not the input
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return;

      e.preventDefault();
      const startValue =
        axis === "x" ? value.x : axis === "y" ? value.y : value.z;

      dragRef.current = {
        axis,
        startX: e.clientX,
        startValue,
      };

      // Signal edit start for undo tracking
      onEditStart?.();

      document.body.style.cursor = "ew-resize";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;

        const deltaX = moveEvent.clientX - dragRef.current.startX;
        // Sensitivity: 1 pixel = step * 0.1, hold shift for fine control
        const sensitivity = moveEvent.shiftKey ? 0.01 : 0.1;
        const delta = deltaX * step * sensitivity;
        const newAxisValue = dragRef.current.startValue + delta;

        const newValue = new Vector3(
          dragRef.current.axis === "x" ? newAxisValue : value.x,
          dragRef.current.axis === "y" ? newAxisValue : value.y,
          dragRef.current.axis === "z" ? newAxisValue : value.z
        );
        onChange(newValue);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        // Signal edit end for undo tracking
        onEditEnd?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [value, onChange, step, onEditStart, onEditEnd]
  );

  return (
    <div className="vector-input">
      <span className="vector-label">{label}</span>
      <div className="vector-fields">
        <div
          className="vector-field"
          onMouseDown={(e) => handleMouseDown(e, "x")}
        >
          <label className="axis-label x">X</label>
          <input
            type="text"
            value={localX}
            onChange={(e) => handleChange("x", e.target.value)}
            onFocus={() => onEditStart?.()}
            onBlur={() => handleBlur("x")}
            onKeyDown={(e) => handleKeyDown(e, "x")}
          />
        </div>
        <div
          className="vector-field"
          onMouseDown={(e) => handleMouseDown(e, "y")}
        >
          <label className="axis-label y">Y</label>
          <input
            type="text"
            value={localY}
            onChange={(e) => handleChange("y", e.target.value)}
            onFocus={() => onEditStart?.()}
            onBlur={() => handleBlur("y")}
            onKeyDown={(e) => handleKeyDown(e, "y")}
          />
        </div>
        <div
          className="vector-field"
          onMouseDown={(e) => handleMouseDown(e, "z")}
        >
          <label className="axis-label z">Z</label>
          <input
            type="text"
            value={localZ}
            onChange={(e) => handleChange("z", e.target.value)}
            onFocus={() => onEditStart?.()}
            onBlur={() => handleBlur("z")}
            onKeyDown={(e) => handleKeyDown(e, "z")}
          />
        </div>
      </div>
    </div>
  );
}

export function PropertiesPanel({
  objectName,
  position,
  rotation,
  scale,
  dimensions,
  onPositionChange,
  onRotationChange,
  onScaleChange,
  onEditStart,
  onEditEnd,
}: PropertiesPanelProps) {
  // Convert rotation from radians to degrees for display
  const rotationDeg = new Vector3(
    (rotation.x * 180) / Math.PI,
    (rotation.y * 180) / Math.PI,
    (rotation.z * 180) / Math.PI
  );

  const handleRotationChange = useCallback(
    (degValue: Vector3) => {
      // Convert back to radians
      onRotationChange(
        new Vector3(
          (degValue.x * Math.PI) / 180,
          (degValue.y * Math.PI) / 180,
          (degValue.z * Math.PI) / 180
        )
      );
    },
    [onRotationChange]
  );

  return (
    <div className="panel properties-panel">
      <div className="panel-header">
        <span className="panel-title">Properties</span>
      </div>
      <div className="panel-content">
        {objectName ? (
          <>
            <div className="property-section">
              <div className="section-header">
                <span className="section-icon">◆</span>
                <span className="section-title">{objectName}</span>
              </div>
            </div>

            <div className="property-section">
              <div className="section-header">
                <span className="section-icon">⊞</span>
                <span className="section-title">Transform</span>
              </div>
              <div className="section-content">
                <VectorInput
                  label="Location"
                  value={position}
                  onChange={onPositionChange}
                  onEditStart={onEditStart}
                  onEditEnd={onEditEnd}
                  step={0.1}
                  precision={3}
                />
                <VectorInput
                  label="Rotation"
                  value={rotationDeg}
                  onChange={handleRotationChange}
                  onEditStart={onEditStart}
                  onEditEnd={onEditEnd}
                  step={1}
                  precision={1}
                />
                <VectorInput
                  label="Scale"
                  value={scale}
                  onChange={onScaleChange}
                  onEditStart={onEditStart}
                  onEditEnd={onEditEnd}
                  step={0.1}
                  precision={3}
                />
              </div>
            </div>

            <div className="property-section">
              <div className="section-header">
                <span className="section-icon">📐</span>
                <span className="section-title">Dimensions</span>
              </div>
              <div className="section-content">
                <div className="dimensions-display">
                  <div className="dimension-row">
                    <span className="axis-label x">X</span>
                    <span className="dimension-value">
                      {dimensions.x.toFixed(3)}
                    </span>
                  </div>
                  <div className="dimension-row">
                    <span className="axis-label y">Y</span>
                    <span className="dimension-value">
                      {dimensions.y.toFixed(3)}
                    </span>
                  </div>
                  <div className="dimension-row">
                    <span className="axis-label z">Z</span>
                    <span className="dimension-value">
                      {dimensions.z.toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="no-selection">No object selected</div>
        )}
      </div>
    </div>
  );
}
