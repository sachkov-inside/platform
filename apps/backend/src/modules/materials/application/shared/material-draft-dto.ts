import type { MaterialDraftDto } from "../content-authoring.interface.js";
import type { MaterialRevision } from "../../domain/material.js";

export function toMaterialDraftDto(
  revision: MaterialRevision,
): MaterialDraftDto {
  return {
    materialId: revision.materialId,
    revisionId: revision.id,
    metadata: revision.metadata.toValues(),
    body: revision.body,
  };
}
