import React, { useState, useEffect, useCallback } from "react";

export type PrimitiveType =
  | "plane"
  | "cube"
  | "circle"
  | "uvsphere"
  | "icosphere"
  | "cylinder"
  | "cone"
  | "torus";

export interface PrimitiveParams {
  type: PrimitiveType;
  // Plane
  planeSize?: number;
  // Cube
  cubeSize?: number;
  // Circle
  circleRadius?: number;
  circleVertices?: number;
  // UV Sphere
  uvSphereSegments?: number;
  uvSphereRings?: number;
  uvSphereRadius?: number;
  // Ico Sphere
  icoSphereSubdivisions?: number;
  icoSphereRadius?: number;
  // Cylinder
  cylinderVertices?: number;
  cylinderRadius?: number;
  cylinderDepth?: number;
  // Cone
  coneVertices?: number;
  coneRadius1?: number;
  coneRadius2?: number;
  coneDepth?: number;
  // Torus
  torusMajorSegments?: number;
  torusMinorSegments?: number;
  torusMajorRadius?: number;
  torusMinorRadius?: number;
}

interface PrimitiveSettingsProps {
  params: PrimitiveParams;
  onChange: (params: PrimitiveParams) => void;
  onSubmit: () => void;
}

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onSubmit: () => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
}

function NumberInput({
  label,
  value,
  onChange,
  onSubmit,
  min,
  max,
  step = 0.1,
  integer = false,
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState(value.toString());

  useEffect(() => {
    setLocalValue(integer ? value.toString() : value.toFixed(3));
  }, [value, integer]);

  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);

      // Parse and update live
      let parsed = integer ? parseInt(newValue) : parseFloat(newValue);
      if (isNaN(parsed)) return; // Don't update if invalid
      if (min !== undefined) parsed = Math.max(min, parsed);
      if (max !== undefined) parsed = Math.min(max, parsed);
      onChange(parsed);
    },
    [onChange, min, max, integer]
  );

  const handleBlur = useCallback(() => {
    // On blur, just reformat the display value
    let parsed = integer ? parseInt(localValue) : parseFloat(localValue);
    if (isNaN(parsed)) {
      setLocalValue(integer ? value.toString() : value.toFixed(3));
      return;
    }
    if (min !== undefined) parsed = Math.max(min, parsed);
    if (max !== undefined) parsed = Math.min(max, parsed);
    setLocalValue(integer ? parsed.toString() : parsed.toFixed(3));
  }, [localValue, value, min, max, integer]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Stop propagation to prevent viewport shortcuts from triggering
      e.stopPropagation();
      if (e.key === "Enter") {
        handleBlur();
        onSubmit();
      }
    },
    [handleBlur, onSubmit]
  );

  return (
    <div className="primitive-setting">
      <label>{label}</label>
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

export function PrimitiveSettings({
  params,
  onChange,
  onSubmit,
}: PrimitiveSettingsProps) {
  const titles: Record<PrimitiveType, string> = {
    plane: "Add Plane",
    cube: "Add Cube",
    circle: "Add Circle",
    uvsphere: "Add UV Sphere",
    icosphere: "Add Ico Sphere",
    cylinder: "Add Cylinder",
    cone: "Add Cone",
    torus: "Add Torus",
  };
  const title = titles[params.type];

  return (
    <div className="primitive-settings-modal">
      <div className="primitive-settings-header">{title}</div>
      <div className="primitive-settings-content">
        {params.type === "plane" && (
          <NumberInput
            label="Size"
            value={params.planeSize ?? 2}
            onChange={(v) => onChange({ ...params, planeSize: v })}
            onSubmit={onSubmit}
            min={0.01}
            step={0.1}
          />
        )}

        {params.type === "cube" && (
          <NumberInput
            label="Size"
            value={params.cubeSize ?? 2}
            onChange={(v) => onChange({ ...params, cubeSize: v })}
            onSubmit={onSubmit}
            min={0.01}
            step={0.1}
          />
        )}

        {params.type === "circle" && (
          <>
            <NumberInput
              label="Vertices"
              value={params.circleVertices ?? 32}
              onChange={(v) => onChange({ ...params, circleVertices: v })}
              onSubmit={onSubmit}
              min={3}
              max={128}
              integer
            />
            <NumberInput
              label="Radius"
              value={params.circleRadius ?? 1}
              onChange={(v) => onChange({ ...params, circleRadius: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
          </>
        )}

        {params.type === "uvsphere" && (
          <>
            <NumberInput
              label="Segments"
              value={params.uvSphereSegments ?? 32}
              onChange={(v) => onChange({ ...params, uvSphereSegments: v })}
              onSubmit={onSubmit}
              min={3}
              max={64}
              integer
            />
            <NumberInput
              label="Rings"
              value={params.uvSphereRings ?? 16}
              onChange={(v) => onChange({ ...params, uvSphereRings: v })}
              onSubmit={onSubmit}
              min={2}
              max={32}
              integer
            />
            <NumberInput
              label="Radius"
              value={params.uvSphereRadius ?? 1}
              onChange={(v) => onChange({ ...params, uvSphereRadius: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
          </>
        )}

        {params.type === "icosphere" && (
          <>
            <NumberInput
              label="Subdivisions"
              value={params.icoSphereSubdivisions ?? 2}
              onChange={(v) =>
                onChange({ ...params, icoSphereSubdivisions: v })
              }
              onSubmit={onSubmit}
              min={1}
              max={5}
              integer
            />
            <NumberInput
              label="Radius"
              value={params.icoSphereRadius ?? 1}
              onChange={(v) => onChange({ ...params, icoSphereRadius: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
          </>
        )}

        {params.type === "cylinder" && (
          <>
            <NumberInput
              label="Vertices"
              value={params.cylinderVertices ?? 32}
              onChange={(v) => onChange({ ...params, cylinderVertices: v })}
              onSubmit={onSubmit}
              min={3}
              max={64}
              integer
            />
            <NumberInput
              label="Radius"
              value={params.cylinderRadius ?? 1}
              onChange={(v) => onChange({ ...params, cylinderRadius: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
            <NumberInput
              label="Depth"
              value={params.cylinderDepth ?? 2}
              onChange={(v) => onChange({ ...params, cylinderDepth: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
          </>
        )}

        {params.type === "cone" && (
          <>
            <NumberInput
              label="Vertices"
              value={params.coneVertices ?? 32}
              onChange={(v) => onChange({ ...params, coneVertices: v })}
              onSubmit={onSubmit}
              min={3}
              max={64}
              integer
            />
            <NumberInput
              label="Radius 1"
              value={params.coneRadius1 ?? 1}
              onChange={(v) => onChange({ ...params, coneRadius1: v })}
              onSubmit={onSubmit}
              min={0}
              step={0.1}
            />
            <NumberInput
              label="Radius 2"
              value={params.coneRadius2 ?? 0}
              onChange={(v) => onChange({ ...params, coneRadius2: v })}
              onSubmit={onSubmit}
              min={0}
              step={0.1}
            />
            <NumberInput
              label="Depth"
              value={params.coneDepth ?? 2}
              onChange={(v) => onChange({ ...params, coneDepth: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
          </>
        )}

        {params.type === "torus" && (
          <>
            <NumberInput
              label="Major Segments"
              value={params.torusMajorSegments ?? 48}
              onChange={(v) => onChange({ ...params, torusMajorSegments: v })}
              onSubmit={onSubmit}
              min={3}
              max={64}
              integer
            />
            <NumberInput
              label="Minor Segments"
              value={params.torusMinorSegments ?? 12}
              onChange={(v) => onChange({ ...params, torusMinorSegments: v })}
              onSubmit={onSubmit}
              min={3}
              max={32}
              integer
            />
            <NumberInput
              label="Major Radius"
              value={params.torusMajorRadius ?? 1}
              onChange={(v) => onChange({ ...params, torusMajorRadius: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.1}
            />
            <NumberInput
              label="Minor Radius"
              value={params.torusMinorRadius ?? 0.25}
              onChange={(v) => onChange({ ...params, torusMinorRadius: v })}
              onSubmit={onSubmit}
              min={0.01}
              step={0.05}
            />
          </>
        )}
      </div>
    </div>
  );
}
