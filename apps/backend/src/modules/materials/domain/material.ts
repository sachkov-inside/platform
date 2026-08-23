import type { MaterialDocumentV1 } from "./material-document/material-document.js";
import type { MaterialMetadata } from "./material-metadata.js";

export interface MaterialRevision {
  readonly id: string;
  readonly materialId: string;
  readonly metadata: MaterialMetadata;
  readonly body: MaterialDocumentV1;
}

export interface Material {
  readonly id: string;
  readonly currentDraft: MaterialRevision;
}

export function createMaterialRevision(
  values: MaterialRevision,
): MaterialRevision {
  return Object.freeze({ ...values });
}

export function createMaterial(currentDraft: MaterialRevision): Material {
  if (currentDraft.materialId.length === 0) {
    throw new TypeError("A MaterialRevision must belong to a Material");
  }
  return Object.freeze({ id: currentDraft.materialId, currentDraft });
}
