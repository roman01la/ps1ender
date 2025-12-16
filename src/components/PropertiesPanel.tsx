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

type Axis = "x" | "y" | "z";

function VectorInput({
  label,
  value,
  onChange,
  onEditStart,
  onEditEnd,
  step = 0.1,
  precision = 3,
}: VectorInputProps) {
  // Shared input value when multiple fields are selected
  const [sharedInput, setSharedInput] = useState("");
  const [localX, setLocalX] = useState(value.x.toFixed(precision));
  const [localY, setLocalY] = useState(value.y.toFixed(precision));
  const [localZ, setLocalZ] = useState(value.z.toFixed(precision));

  // Multi-select state
  const [selectedAxes, setSelectedAxes] = useState<Set<Axis>>(new Set());
  const [isMultiEditing, setIsMultiEditing] = useState(false);
  const [focusedAxis, setFocusedAxis] = useState<Axis | null>(null);

  // Refs for field elements and inputs
  const fieldRefs = useRef<{ [key in Axis]: HTMLDivElement | null }>({
    x: null,
    y: null,
    z: null,
  });
  const inputRefs = useRef<{ [key in Axis]: HTMLInputElement | null }>({
    x: null,
    y: null,
    z: null,
  });

  // Update local values when prop changes (only when not editing)
  useEffect(() => {
    if (!isMultiEditing) {
      setLocalX(value.x.toFixed(precision));
      setLocalY(value.y.toFixed(precision));
      setLocalZ(value.z.toFixed(precision));
    }
  }, [value.x, value.y, value.z, precision, isMultiEditing]);

  // Evaluate math expression or parse number
  const evaluateInput = useCallback((input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Check if it contains math operators (not just a number)
    const hasMathOps = /[+\-*/]/.test(trimmed.replace(/^-/, "")); // ignore leading minus

    if (hasMathOps) {
      try {
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

    const simple = parseFloat(trimmed);
    if (!isNaN(simple) && isFinite(simple)) return simple;
    return null;
  }, []);

  // Handle change for multi-edit mode
  const handleMultiChange = useCallback(
    (newValue: string) => {
      setSharedInput(newValue);
      // Update all selected local values to show the same input
      if (selectedAxes.has("x")) setLocalX(newValue);
      if (selectedAxes.has("y")) setLocalY(newValue);
      if (selectedAxes.has("z")) setLocalZ(newValue);
    },
    [selectedAxes]
  );

  // Handle change for single field
  const handleSingleChange = useCallback((axis: Axis, newValue: string) => {
    if (axis === "x") setLocalX(newValue);
    else if (axis === "y") setLocalY(newValue);
    else setLocalZ(newValue);
  }, []);

  // Commit multi-edit changes
  const commitMultiEdit = useCallback(() => {
    const parsed = evaluateInput(sharedInput);
    if (parsed !== null && selectedAxes.size > 0) {
      const newValue = new Vector3(
        selectedAxes.has("x") ? parsed : value.x,
        selectedAxes.has("y") ? parsed : value.y,
        selectedAxes.has("z") ? parsed : value.z
      );
      onChange(newValue);
    } else {
      // Reset to original values
      setLocalX(value.x.toFixed(precision));
      setLocalY(value.y.toFixed(precision));
      setLocalZ(value.z.toFixed(precision));
    }
    setIsMultiEditing(false);
    setSelectedAxes(new Set());
    setSharedInput("");
    onEditEnd?.();
  }, [
    sharedInput,
    selectedAxes,
    value,
    onChange,
    precision,
    evaluateInput,
    onEditEnd,
  ]);

  // Commit single field change
  const handleSingleBlur = useCallback(
    (axis: Axis) => {
      if (isMultiEditing) return; // Handled by commitMultiEdit

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
        if (axis === "x") setLocalX(value.x.toFixed(precision));
        else if (axis === "y") setLocalY(value.y.toFixed(precision));
        else setLocalZ(value.z.toFixed(precision));
      }
      setFocusedAxis(null);
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
      isMultiEditing,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, axis: Axis) => {
      if (e.key === "Enter") {
        if (isMultiEditing) {
          commitMultiEdit();
        } else {
          handleSingleBlur(axis);
        }
        (e.target as HTMLInputElement).blur();
      } else if (e.key === "Escape") {
        // Cancel edit
        setLocalX(value.x.toFixed(precision));
        setLocalY(value.y.toFixed(precision));
        setLocalZ(value.z.toFixed(precision));
        setIsMultiEditing(false);
        setSelectedAxes(new Set());
        setSharedInput("");
        (e.target as HTMLInputElement).blur();
        onEditEnd?.();
      }
    },
    [
      isMultiEditing,
      commitMultiEdit,
      handleSingleBlur,
      value,
      precision,
      onEditEnd,
    ]
  );

  // Check which axis input a point is over
  const getAxisAtPoint = useCallback(
    (clientX: number, clientY: number): Axis | null => {
      for (const axis of ["x", "y", "z"] as Axis[]) {
        const el = inputRefs.current[axis];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          ) {
            return axis;
          }
        }
      }
      return null;
    },
    []
  );

  // Drag on label = scrub value (original behavior)
  const handleLabelMouseDown = useCallback(
    (e: React.MouseEvent, axis: Axis) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const startX = e.clientX;
      const startValue =
        axis === "x" ? value.x : axis === "y" ? value.y : value.z;

      onEditStart?.();
      document.body.style.cursor = "ew-resize";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const sensitivity = moveEvent.shiftKey ? 0.01 : 0.1;
        const delta = deltaX * step * sensitivity;
        const newAxisValue = startValue + delta;

        const newValue = new Vector3(
          axis === "x" ? newAxisValue : value.x,
          axis === "y" ? newAxisValue : value.y,
          axis === "z" ? newAxisValue : value.z
        );
        onChange(newValue);
      };

      const handleMouseUp = () => {
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        onEditEnd?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [value, onChange, step, onEditStart, onEditEnd]
  );

  // Drag on input = multi-field selection for keyboard editing
  const handleInputMouseDown = useCallback(
    (e: React.MouseEvent, axis: Axis) => {
      if (e.button !== 0) return;

      // Clear existing multi-select if clicking different input
      if (selectedAxes.size > 0 && !selectedAxes.has(axis)) {
        setSelectedAxes(new Set());
        setIsMultiEditing(false);
      }

      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;
      const newSelected = new Set<Axis>([axis]);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only start selection mode after small movement threshold
        if (distance > 5) {
          isDragging = true;
          setSelectedAxes(new Set(newSelected));

          const hoveredAxis = getAxisAtPoint(
            moveEvent.clientX,
            moveEvent.clientY
          );
          if (hoveredAxis && !newSelected.has(hoveredAxis)) {
            newSelected.add(hoveredAxis);
            setSelectedAxes(new Set(newSelected));
          }
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        if (isDragging && newSelected.size > 1) {
          // Enter multi-edit mode
          setIsMultiEditing(true);
          setSharedInput("");
          onEditStart?.();
          // Focus the first selected input
          const firstAxis = newSelected.has("x")
            ? "x"
            : newSelected.has("y")
            ? "y"
            : "z";
          setTimeout(() => {
            const input = inputRefs.current[firstAxis];
            if (input) {
              input.focus();
              input.select();
            }
          }, 0);
        } else if (!isDragging) {
          // Normal click - clear selection, let default focus happen
          setSelectedAxes(new Set());
          setIsMultiEditing(false);
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [selectedAxes, onEditStart, getAxisAtPoint]
  );

  const handleFocus = useCallback(
    (axis: Axis) => {
      setFocusedAxis(axis);
      if (!isMultiEditing) {
        onEditStart?.();
      }
    },
    [isMultiEditing, onEditStart]
  );

  const handleBlur = useCallback(
    (axis: Axis) => {
      if (isMultiEditing) {
        // Check if focus is moving to another selected input
        setTimeout(() => {
          const activeEl = document.activeElement;
          const isStillInSelection = Array.from(selectedAxes).some(
            (a) => inputRefs.current[a] === activeEl
          );
          if (!isStillInSelection) {
            commitMultiEdit();
          }
        }, 0);
      } else {
        handleSingleBlur(axis);
      }
    },
    [isMultiEditing, selectedAxes, commitMultiEdit, handleSingleBlur]
  );

  const getFieldClassName = (axis: Axis) => {
    let className = "vector-field";
    if (selectedAxes.has(axis)) {
      className += " selected";
    }
    if (isMultiEditing && selectedAxes.has(axis)) {
      className += " multi-editing";
    }
    return className;
  };

  const getInputValue = (axis: Axis) => {
    if (isMultiEditing && selectedAxes.has(axis)) {
      return sharedInput;
    }
    return axis === "x" ? localX : axis === "y" ? localY : localZ;
  };

  const handleInputChange = (axis: Axis, newValue: string) => {
    if (isMultiEditing && selectedAxes.has(axis)) {
      handleMultiChange(newValue);
    } else {
      handleSingleChange(axis, newValue);
    }
  };

  return (
    <div className="vector-input">
      <span className="vector-label">{label}</span>
      <div className="vector-fields">
        <div
          ref={(el) => {
            fieldRefs.current.x = el;
          }}
          className={getFieldClassName("x")}
        >
          <label
            className="axis-label x"
            onMouseDown={(e) => handleLabelMouseDown(e, "x")}
          >
            X
          </label>
          <input
            ref={(el) => {
              inputRefs.current.x = el;
            }}
            type="text"
            value={getInputValue("x")}
            onChange={(e) => handleInputChange("x", e.target.value)}
            onMouseDown={(e) => handleInputMouseDown(e, "x")}
            onFocus={() => handleFocus("x")}
            onBlur={() => handleBlur("x")}
            onKeyDown={(e) => handleKeyDown(e, "x")}
          />
        </div>
        <div
          ref={(el) => {
            fieldRefs.current.y = el;
          }}
          className={getFieldClassName("y")}
        >
          <label
            className="axis-label y"
            onMouseDown={(e) => handleLabelMouseDown(e, "y")}
          >
            Y
          </label>
          <input
            ref={(el) => {
              inputRefs.current.y = el;
            }}
            type="text"
            value={getInputValue("y")}
            onChange={(e) => handleInputChange("y", e.target.value)}
            onMouseDown={(e) => handleInputMouseDown(e, "y")}
            onFocus={() => handleFocus("y")}
            onBlur={() => handleBlur("y")}
            onKeyDown={(e) => handleKeyDown(e, "y")}
          />
        </div>
        <div
          ref={(el) => {
            fieldRefs.current.z = el;
          }}
          className={getFieldClassName("z")}
        >
          <label
            className="axis-label z"
            onMouseDown={(e) => handleLabelMouseDown(e, "z")}
          >
            Z
          </label>
          <input
            ref={(el) => {
              inputRefs.current.z = el;
            }}
            type="text"
            value={getInputValue("z")}
            onChange={(e) => handleInputChange("z", e.target.value)}
            onMouseDown={(e) => handleInputMouseDown(e, "z")}
            onFocus={() => handleFocus("z")}
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
