import { Material } from "../material";
import { Texture } from "../texture";
import { NodeEditor } from "./NodeEditor";

export interface ShadingWorkspaceProps {
  materials: Material[];
  selectedMaterialId: string | null;
  textureMap: Map<string, Texture>;
  onSelectMaterial: (id: string) => void;
  onMaterialChange: (material: Material) => void;
  onNewMaterial: () => void;
}

export function ShadingWorkspace({
  materials,
  selectedMaterialId,
  textureMap,
  onSelectMaterial,
  onMaterialChange,
  onNewMaterial,
}: ShadingWorkspaceProps) {
  return (
    <NodeEditor
      materials={materials}
      selectedMaterialId={selectedMaterialId}
      textureMap={textureMap}
      onSelectMaterial={onSelectMaterial}
      onMaterialChange={onMaterialChange}
      onNewMaterial={onNewMaterial}
    />
  );
}
