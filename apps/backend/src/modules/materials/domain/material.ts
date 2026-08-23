import type { MaterialDocumentV1 } from "./material-document/material-document.js";
import type { MaterialRevisionMetadata } from "./material-revision-metadata.js";

export interface MaterialRevision {
  readonly id: string;
  readonly materialId: string;
  readonly restoredFromRevisionId?: string;
  readonly metadata: MaterialRevisionMetadata;
  readonly body: MaterialDocumentV1;
}

export interface Material {
  readonly id: string;
  readonly currentDraft: MaterialRevision;
}

export function restoreMaterialRevision(
  values: MaterialRevision,
): MaterialRevision {
  return Object.freeze({ ...values });
}

export function restoreMaterial(currentDraft: MaterialRevision): Material {
  if (currentDraft.materialId.length === 0) {
    throw new TypeError("A MaterialRevision must belong to a Material");
  }
  return Object.freeze({ id: currentDraft.materialId, currentDraft });
}
