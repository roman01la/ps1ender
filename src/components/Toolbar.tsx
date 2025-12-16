import shadingSolidIcon from "../icons/shading_solid.svg";
import shadingWireIcon from "../icons/shading_wire.svg";
import shadingTextureIcon from "../icons/shading_texture.svg";
import editModeIcon from "../icons/editmode_hlt.svg";
import objectModeIcon from "../icons/object_datamode.svg";
import vertexSelectIcon from "../icons/vertex_select.svg";
import edgeSelectIcon from "../icons/edge_select.svg";
import faceSelectIcon from "../icons/face_select.svg";
import { EditorMode, TransformMode, ViewMode, SelectionMode } from "../editor";
import { ToolbarButton } from "./ToolbarButton";

interface ToolbarProps {
  mode: EditorMode;
  transformMode: TransformMode;
  viewMode: ViewMode;
  selectionMode: SelectionMode;
  onModeChange: (mode: EditorMode) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSelectionModeChange: (mode: SelectionMode) => void;
}

export function Toolbar({
  mode,
  transformMode,
  viewMode,
  selectionMode,
  onModeChange,
  onViewModeChange,
  onSelectionModeChange,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <div className="toolbar-group">
          <ToolbarButton
            active={mode === "object"}
            onClick={() => onModeChange("object")}
            title="Object Mode"
            icon={objectModeIcon}
          >
            Object
          </ToolbarButton>
          <ToolbarButton
            active={mode === "edit"}
            onClick={() => onModeChange("edit")}
            title="Edit Mode"
            icon={editModeIcon}
          >
            Edit
          </ToolbarButton>
        </div>

        {mode === "edit" && (
          <>
            <div className="toolbar-divider" />
            <div className="toolbar-group">
              <ToolbarButton
                active={selectionMode === "vertex"}
                onClick={() => onSelectionModeChange("vertex")}
                title="Vertex Select (1)"
                icon={vertexSelectIcon}
              />
              <ToolbarButton
                active={selectionMode === "edge"}
                onClick={() => onSelectionModeChange("edge")}
                title="Edge Select (2)"
                icon={edgeSelectIcon}
              />
              <ToolbarButton
                active={selectionMode === "face"}
                onClick={() => onSelectionModeChange("face")}
                title="Face Select (3)"
                icon={faceSelectIcon}
              />
            </div>
          </>
        )}

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <span className="toolbar-label">Transform:</span>
          <ToolbarButton active={transformMode === "grab"} title="Grab (G)">
            <span className="icon">✥</span>
          </ToolbarButton>
          <ToolbarButton active={transformMode === "rotate"} title="Rotate (R)">
            <span className="icon">↻</span>
          </ToolbarButton>
          <ToolbarButton active={transformMode === "scale"} title="Scale (S)">
            <span className="icon">⤡</span>
          </ToolbarButton>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <span className="toolbar-label">Shading:</span>
          <ToolbarButton
            active={viewMode === "wireframe"}
            onClick={() => onViewModeChange("wireframe")}
            title="Wireframe (Z, 1)"
            icon={shadingWireIcon}
          />
          <ToolbarButton
            active={viewMode === "solid"}
            onClick={() => onViewModeChange("solid")}
            title="Solid (Z, 2)"
            icon={shadingSolidIcon}
          />
          <ToolbarButton
            active={viewMode === "material"}
            onClick={() => onViewModeChange("material")}
            title="Material Preview (Z, 3)"
            icon={shadingTextureIcon}
          />
        </div>
      </div>

      <div className="toolbar-section">
        <span className="toolbar-title">PS1ender</span>
      </div>
    </div>
  );
}
