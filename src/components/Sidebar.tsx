import { Vector3 } from "../math";
import { SceneTree } from "./SceneTree";
import { PropertiesPanel } from "./PropertiesPanel";

interface SceneObject {
  name: string;
  selected: boolean;
  visible: boolean;
  parentName: string | null;
  inEditMode: boolean;
}

interface SelectionModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
}

export interface SidebarProps {
  // Scene tree props
  objects: SceneObject[];
  onSelectObject: (name: string, modifiers: SelectionModifiers) => void;
  onToggleVisibility: (name: string) => void;

  // Properties panel props
  selectedObjectName: string | null;
  selectedPosition: Vector3;
  selectedRotation: Vector3;
  selectedScale: Vector3;
  selectedDimensions: Vector3;
  onPositionChange: (position: Vector3) => void;
  onRotationChange: (rotation: Vector3) => void;
  onScaleChange: (scale: Vector3) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}

export function Sidebar({
  objects,
  onSelectObject,
  onToggleVisibility,
  selectedObjectName,
  selectedPosition,
  selectedRotation,
  selectedScale,
  selectedDimensions,
  onPositionChange,
  onRotationChange,
  onScaleChange,
  onEditStart,
  onEditEnd,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <SceneTree
        objects={objects}
        onSelectObject={onSelectObject}
        onToggleVisibility={onToggleVisibility}
      />
      <PropertiesPanel
        objectName={selectedObjectName}
        position={selectedPosition}
        rotation={selectedRotation}
        scale={selectedScale}
        dimensions={selectedDimensions}
        onPositionChange={onPositionChange}
        onRotationChange={onRotationChange}
        onScaleChange={onScaleChange}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />
    </div>
  );
}
