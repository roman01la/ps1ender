import { useEffect, useRef } from "react";
import meshPlaneIcon from "../icons/mesh_plane.svg";
import meshCubeIcon from "../icons/mesh_cube.svg";
import meshCircleIcon from "../icons/mesh_circle.svg";
import meshUVSphereIcon from "../icons/mesh_uvsphere.svg";
import meshIcoSphereIcon from "../icons/mesh_icosphere.svg";
import meshCylinderIcon from "../icons/mesh_cylinder.svg";
import meshConeIcon from "../icons/mesh_cone.svg";
import meshTorusIcon from "../icons/mesh_torus.svg";

export type PrimitiveType =
  | "plane"
  | "cube"
  | "circle"
  | "uvsphere"
  | "icosphere"
  | "cylinder"
  | "cone"
  | "torus";

interface AddMenuProps {
  x: number;
  y: number;
  onSelect: (type: PrimitiveType) => void;
  onClose: () => void;
}

const PRIMITIVES: { type: PrimitiveType; label: string; icon: string }[] = [
  { type: "plane", label: "Plane", icon: meshPlaneIcon },
  { type: "cube", label: "Cube", icon: meshCubeIcon },
  { type: "circle", label: "Circle", icon: meshCircleIcon },
  { type: "uvsphere", label: "UV Sphere", icon: meshUVSphereIcon },
  { type: "icosphere", label: "Ico Sphere", icon: meshIcoSphereIcon },
  { type: "cylinder", label: "Cylinder", icon: meshCylinderIcon },
  { type: "cone", label: "Cone", icon: meshConeIcon },
  { type: "torus", label: "Torus", icon: meshTorusIcon },
];

export function AddMenu({ x, y, onSelect, onClose }: AddMenuProps) {
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
      <div className="add-menu-header">Add Mesh</div>
      {PRIMITIVES.map((primitive) => (
        <button
          key={primitive.type}
          className="add-menu-item"
          onClick={() => {
            onSelect(primitive.type);
            onClose();
          }}
        >
          <img
            src={primitive.icon}
            className="add-menu-icon"
            width={16}
            height={16}
            alt={primitive.label}
          />
          <span className="add-menu-label">{primitive.label}</span>
        </button>
      ))}
    </div>
  );
}
