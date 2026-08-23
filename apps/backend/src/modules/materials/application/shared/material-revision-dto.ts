import type { MaterialRevisionDto } from "../content-authoring.interface.js";
import type { MaterialRevision } from "../../domain/material.js";

export function toMaterialRevisionDto(
  revision: MaterialRevision,
): MaterialRevisionDto {
  return {
    materialId: revision.materialId,
    revisionId: revision.id,
    metadata: revision.metadata.toValues(),
    body: revision.body,
  };
}
