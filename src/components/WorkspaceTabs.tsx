import React from "react";

export type WorkspaceType = "modeling" | "shading";

interface WorkspaceTabsProps {
  activeWorkspace: WorkspaceType;
  onWorkspaceChange: (workspace: WorkspaceType) => void;
}

const WORKSPACES: { id: WorkspaceType; label: string }[] = [
  { id: "modeling", label: "Modeling" },
  { id: "shading", label: "Shading" },
];

export function WorkspaceTabs({
  activeWorkspace,
  onWorkspaceChange,
}: WorkspaceTabsProps) {
  return (
    <div className="workspace-tabs">
      {WORKSPACES.map((workspace) => (
        <button
          key={workspace.id}
          className={`workspace-tab ${
            activeWorkspace === workspace.id ? "active" : ""
          }`}
          onClick={() => onWorkspaceChange(workspace.id)}
        >
          {workspace.label}
        </button>
      ))}
    </div>
  );
}
