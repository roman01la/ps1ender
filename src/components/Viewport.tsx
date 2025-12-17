import { RefObject } from "react";
import { Instructions } from "./Instructions";
import { ViewportGizmo } from "./ViewportGizmo";
import { PrimitiveSettings, PrimitiveParams } from "./PrimitiveSettings";

type Viewpoint =
  | "front"
  | "back"
  | "right"
  | "left"
  | "top"
  | "bottom"
  | "persp";

interface BoxSelection {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

export interface ViewportProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;

  // Viewport gizmo
  onViewpointChange: (view: Viewpoint) => void;
  onToggleOrtho: () => void;
  isOrtho: boolean;

  // Primitive settings
  primitiveParams: PrimitiveParams | null;
  onPrimitiveParamsChange: (params: PrimitiveParams) => void;
  onPrimitiveSubmit: () => void;

  // Box selection
  boxSelection: BoxSelection | null;
}

export function Viewport({
  viewportRef,
  canvasRef,
  onDragOver,
  onDrop,
  onViewpointChange,
  onToggleOrtho,
  isOrtho,
  primitiveParams,
  onPrimitiveParamsChange,
  onPrimitiveSubmit,
  boxSelection,
}: ViewportProps) {
  return (
    <div
      className="viewport"
      ref={viewportRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <canvas id="canvas" ref={canvasRef} />
      <Instructions />
      <ViewportGizmo
        onViewpointChange={onViewpointChange}
        onToggleOrtho={onToggleOrtho}
        isOrtho={isOrtho}
      />
      {primitiveParams && (
        <PrimitiveSettings
          params={primitiveParams}
          onChange={onPrimitiveParamsChange}
          onSubmit={onPrimitiveSubmit}
        />
      )}
      {boxSelection && boxSelection.active && (
        <div
          className="box-selection"
          style={{
            left: Math.min(boxSelection.startX, boxSelection.currentX),
            top: Math.min(boxSelection.startY, boxSelection.currentY),
            width: Math.abs(boxSelection.currentX - boxSelection.startX),
            height: Math.abs(boxSelection.currentY - boxSelection.startY),
          }}
        />
      )}
    </div>
  );
}
