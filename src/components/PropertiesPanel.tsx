import React, { useState, useEffect, useCallback } from "react";
import { Vector3 } from "../math";

interface PropertiesPanelProps {
  objectName: string | null;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  onPositionChange: (position: Vector3) => void;
  onRotationChange: (rotation: Vector3) => void;
  onScaleChange: (scale: Vector3) => void;
}

interface VectorInputProps {
  label: string;
  value: Vector3;
  onChange: (value: Vector3) => void;
  step?: number;
  precision?: number;
}

function VectorInput({
  label,
  value,
  onChange,
  step = 0.1,
  precision = 3,
}: VectorInputProps) {
  const [localX, setLocalX] = useState(value.x.toFixed(precision));
  const [localY, setLocalY] = useState(value.y.toFixed(precision));
  const [localZ, setLocalZ] = useState(value.z.toFixed(precision));

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

  const handleBlur = useCallback(
    (axis: "x" | "y" | "z") => {
      const parsed =
        axis === "x"
          ? parseFloat(localX)
          : axis === "y"
          ? parseFloat(localY)
          : parseFloat(localZ);

      if (!isNaN(parsed)) {
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
    },
    [localX, localY, localZ, value, onChange, precision]
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

  return (
    <div className="vector-input">
      <span className="vector-label">{label}</span>
      <div className="vector-fields">
        <div className="vector-field">
          <label className="axis-label x">X</label>
          <input
            type="text"
            value={localX}
            onChange={(e) => handleChange("x", e.target.value)}
            onBlur={() => handleBlur("x")}
            onKeyDown={(e) => handleKeyDown(e, "x")}
          />
        </div>
        <div className="vector-field">
          <label className="axis-label y">Y</label>
          <input
            type="text"
            value={localY}
            onChange={(e) => handleChange("y", e.target.value)}
            onBlur={() => handleBlur("y")}
            onKeyDown={(e) => handleKeyDown(e, "y")}
          />
        </div>
        <div className="vector-field">
          <label className="axis-label z">Z</label>
          <input
            type="text"
            value={localZ}
            onChange={(e) => handleChange("z", e.target.value)}
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
  onPositionChange,
  onRotationChange,
  onScaleChange,
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
                  step={0.1}
                  precision={3}
                />
                <VectorInput
                  label="Rotation"
                  value={rotationDeg}
                  onChange={handleRotationChange}
                  step={1}
                  precision={1}
                />
                <VectorInput
                  label="Scale"
                  value={scale}
                  onChange={onScaleChange}
                  step={0.1}
                  precision={3}
                />
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
