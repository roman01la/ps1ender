import React, { useEffect, useRef } from "react";

type MenuAction = "shade-smooth" | "shade-flat" | "origin-to-center";

interface ObjectContextMenuProps {
  x: number;
  y: number;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
}

export function ObjectContextMenu({
  x,
  y,
  onAction,
  onClose,
}: ObjectContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="add-menu"
      style={{
        left: x,
        top: y,
      }}
    >
      <div className="add-menu-header">Object</div>
      <button
        className="add-menu-item"
        onClick={() => {
          onAction("shade-smooth");
          onClose();
        }}
      >
        <span className="add-menu-label">Set Shade Smooth</span>
      </button>
      <button
        className="add-menu-item"
        onClick={() => {
          onAction("shade-flat");
          onClose();
        }}
      >
        <span className="add-menu-label">Set Shade Flat</span>
      </button>
      <div className="add-menu-separator" />
      <button
        className="add-menu-item"
        onClick={() => {
          onAction("origin-to-center");
          onClose();
        }}
      >
        <span className="add-menu-label">Set Origin to Center of Mass</span>
      </button>
    </div>
  );
}

// Keep the old export name for backwards compatibility
export const ShadingContextMenu = ObjectContextMenu;
