import React from "react";

interface ToolbarButtonProps {
  active?: boolean;
  onClick?: () => void;
  title: string;
  icon?: string;
  iconAlt?: string;
  children?: React.ReactNode;
}

export function ToolbarButton({
  active = false,
  onClick,
  title,
  icon,
  iconAlt,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      className={`toolbar-btn ${active ? "active" : ""}`}
      onClick={onClick}
      title={title}
    >
      {icon ? (
        <img
          src={icon}
          className="icon"
          width={16}
          height={16}
          alt={iconAlt || title}
        />
      ) : null}
      {children}
    </button>
  );
}
