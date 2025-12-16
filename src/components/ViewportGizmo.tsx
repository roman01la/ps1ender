type Viewpoint =
  | "front"
  | "back"
  | "right"
  | "left"
  | "top"
  | "bottom"
  | "persp";

interface ViewportGizmoProps {
  onViewpointChange: (viewpoint: Viewpoint) => void;
  onToggleOrtho: () => void;
  isOrtho: boolean;
}

export function ViewportGizmo({
  onViewpointChange,
  onToggleOrtho,
  isOrtho,
}: ViewportGizmoProps) {
  return (
    <div className="viewport-gizmo">
      <div className="viewport-gizmo-cube">
        {/* Top row */}
        <button
          className="gizmo-face gizmo-top"
          onClick={() => onViewpointChange("top")}
          title="Top (Numpad 7)"
        >
          <span className="gizmo-label gizmo-z">Z</span>
        </button>

        {/* Middle row */}
        <div className="gizmo-middle-row">
          <button
            className="gizmo-face gizmo-left"
            onClick={() => onViewpointChange("left")}
            title="Left (Ctrl+Numpad 3)"
          >
            <span className="gizmo-label gizmo-x-neg">−X</span>
          </button>
          <button
            className="gizmo-face gizmo-front"
            onClick={() => onViewpointChange("front")}
            title="Front (Numpad 1)"
          >
            <span className="gizmo-label gizmo-y-neg">−Y</span>
          </button>
          <button
            className="gizmo-face gizmo-right"
            onClick={() => onViewpointChange("right")}
            title="Right (Numpad 3)"
          >
            <span className="gizmo-label gizmo-x">X</span>
          </button>
          <button
            className="gizmo-face gizmo-back"
            onClick={() => onViewpointChange("back")}
            title="Back (Ctrl+Numpad 1)"
          >
            <span className="gizmo-label gizmo-y">Y</span>
          </button>
        </div>

        {/* Bottom row */}
        <button
          className="gizmo-face gizmo-bottom"
          onClick={() => onViewpointChange("bottom")}
          title="Bottom (Ctrl+Numpad 7)"
        >
          <span className="gizmo-label gizmo-z-neg">−Z</span>
        </button>
      </div>

      {/* Ortho/Persp toggle */}
      <button
        className={`gizmo-ortho-toggle ${isOrtho ? "ortho" : "persp"}`}
        onClick={onToggleOrtho}
        title="Toggle Orthographic/Perspective (Numpad 5)"
      >
        {isOrtho ? "Ortho" : "Persp"}
      </button>
    </div>
  );
}
