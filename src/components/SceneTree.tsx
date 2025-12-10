import React from "react";
import hideOnIcon from "../icons/hide_on.svg";
import hideOffIcon from "../icons/hide_off.svg";

interface SceneObject {
  name: string;
  selected: boolean;
  visible: boolean;
}

interface SceneTreeProps {
  objects: SceneObject[];
  onSelectObject: (name: string) => void;
  onToggleVisibility: (name: string) => void;
}

export function SceneTree({
  objects,
  onSelectObject,
  onToggleVisibility,
}: SceneTreeProps) {
  return (
    <div className="panel scene-tree">
      <div className="panel-header">
        <span className="panel-title">Scene</span>
      </div>
      <div className="panel-content">
        <div className="tree-item scene-root">
          <span className="tree-icon">▼</span>
          <span className="tree-label">Scene Collection</span>
        </div>
        {objects.map((obj) => (
          <div
            key={obj.name}
            className={`tree-item object-item ${
              obj.selected ? "selected" : ""
            }`}
            onClick={() => onSelectObject(obj.name)}
          >
            <span className="tree-indent" />
            <span className="tree-icon">◆</span>
            <span className="tree-label">{obj.name}</span>
            <button
              className={`visibility-btn ${obj.visible ? "visible" : "hidden"}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(obj.name);
              }}
              title={obj.visible ? "Hide" : "Show"}
            >
              <img
                src={obj.visible ? hideOffIcon : hideOnIcon}
                className="icon"
                width={18}
                height={18}
                alt={obj.visible ? "Visible" : "Hidden"}
              />
            </button>
          </div>
        ))}
        {objects.length === 0 && (
          <div className="tree-empty">No objects in scene</div>
        )}
      </div>
    </div>
  );
}
