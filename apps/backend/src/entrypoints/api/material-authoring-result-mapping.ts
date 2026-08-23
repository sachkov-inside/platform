import type { MaterialAuthoringError } from "../../modules/materials/index.js";

export type MaterialAuthoringErrorStatus = 403 | 404 | 409 | 422 | 500 | 503;

export function statusForMaterialAuthoringError(
  error: MaterialAuthoringError,
): MaterialAuthoringErrorStatus {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "material_not_found":
    case "publication_not_found":
    case "revision_not_found":
      return 404;
    case "idempotency_key_reused":
    case "series_ordinal_conflict":
    case "slug_conflict":
    case "stale_revision":
    case "stale_publication":
      return 409;
    case "duplicate_tag":
    case "invalid_content":
    case "invalid_reference":
      return 422;
    case "dependency_unavailable":
      return 503;
    case "internal_error":
      return 500;
  }
}
