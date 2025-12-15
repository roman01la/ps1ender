import React, { useState } from "react";
import hideOnIcon from "../icons/hide_on.svg";
import hideOffIcon from "../icons/hide_off.svg";
import editModeIcon from "../icons/editmode_hlt.svg";

interface SceneObject {
  name: string;
  selected: boolean;
  visible: boolean;
  parentName: string | null;
  inEditMode: boolean;
}

interface SceneTreeProps {
  objects: SceneObject[];
  onSelectObject: (name: string) => void;
  onToggleVisibility: (name: string) => void;
}

/**
 * Recursive component to render a tree item and its children
 */
function TreeItem({
  obj,
  objects,
  depth,
  onSelectObject,
  onToggleVisibility,
  collapsedItems,
  toggleCollapsed,
}: {
  obj: SceneObject;
  objects: SceneObject[];
  depth: number;
  onSelectObject: (name: string) => void;
  onToggleVisibility: (name: string) => void;
  collapsedItems: Set<string>;
  toggleCollapsed: (name: string) => void;
}) {
  // Find children of this object
  const children = objects.filter((o) => o.parentName === obj.name);
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedItems.has(obj.name);

  return (
    <>
      <div
        className={`tree-item object-item ${obj.selected ? "selected" : ""}`}
        onClick={() => onSelectObject(obj.name)}
      >
        {/* Indentation based on depth */}
        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} className="tree-indent" />
        ))}
        {/* Collapse/expand toggle for items with children */}
        {hasChildren ? (
          <span
            className="tree-collapse"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(obj.name);
            }}
          >
            {isCollapsed ? "▶" : "▼"}
          </span>
        ) : (
          <span className="tree-icon">◆</span>
        )}
        {/* Edit mode icon */}
        {obj.inEditMode && (
          <img
            src={editModeIcon}
            className="icon edit-mode-icon"
            width={14}
            height={14}
            alt="Edit Mode"
            title="Edit Mode"
          />
        )}
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
      {/* Render children recursively (only if not collapsed) */}
      {!isCollapsed &&
        children.map((child) => (
          <TreeItem
            key={child.name}
            obj={child}
            objects={objects}
            depth={depth + 1}
            onSelectObject={onSelectObject}
            onToggleVisibility={onToggleVisibility}
            collapsedItems={collapsedItems}
            toggleCollapsed={toggleCollapsed}
          />
        ))}
    </>
  );
}

export function SceneTree({
  objects,
  onSelectObject,
  onToggleVisibility,
}: SceneTreeProps) {
  // Track collapsed state for items with children
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());

  const toggleCollapsed = (name: string) => {
    setCollapsedItems((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Get root objects (no parent)
  const rootObjects = objects.filter((obj) => obj.parentName === null);

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
        {rootObjects.map((obj) => (
          <TreeItem
            key={obj.name}
            obj={obj}
            objects={objects}
            depth={1}
            onSelectObject={onSelectObject}
            onToggleVisibility={onToggleVisibility}
            collapsedItems={collapsedItems}
            toggleCollapsed={toggleCollapsed}
          />
        ))}
        {objects.length === 0 && (
          <div className="tree-empty">No objects in scene</div>
        )}
      </div>
    </div>
  );
}
