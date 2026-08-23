import type { ContentAuthoringError } from "../../modules/content-authoring/index.js";

export type ContentAuthoringErrorStatus = 403 | 404 | 409 | 422 | 500 | 503;

export function statusForContentAuthoringError(
  error: ContentAuthoringError,
): ContentAuthoringErrorStatus {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "material_not_found":
      return 404;
    case "idempotency_key_reused":
    case "series_ordinal_conflict":
    case "slug_conflict":
    case "stale_revision":
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
