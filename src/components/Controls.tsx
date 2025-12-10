import React from "react";

interface ControlsProps {
  wireframe: boolean;
  setWireframe: (value: boolean) => void;
  lighting: boolean;
  setLighting: (value: boolean) => void;
  texturing: boolean;
  setTexturing: (value: boolean) => void;
  fps: number;
}

function Checkbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="control-group">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function Controls({
  wireframe,
  setWireframe,
  lighting,
  setLighting,
  texturing,
  setTexturing,
  fps,
}: ControlsProps) {
  return (
    <div className="controls">
      <Checkbox
        id="wireframe"
        label="Wireframe"
        checked={wireframe}
        onChange={setWireframe}
      />
      <Checkbox
        id="lighting"
        label="Lighting"
        checked={lighting}
        onChange={setLighting}
      />
      <Checkbox
        id="texturing"
        label="Texturing"
        checked={texturing}
        onChange={setTexturing}
      />
      <span id="fps">FPS: {fps}</span>
    </div>
  );
}
