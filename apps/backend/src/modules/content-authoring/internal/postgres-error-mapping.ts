import { randomUUID } from "node:crypto";

import type {
  ContentAuthoringError,
  DraftMetadata,
} from "../content-authoring.interface.js";

interface PostgreSqlErrorShape {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

function errorShape(error: unknown): PostgreSqlErrorShape {
  return typeof error === "object" && error !== null ? error : {};
}

export function mapPostgresError(
  error: unknown,
  metadata?: DraftMetadata,
): ContentAuthoringError {
  const shape = errorShape(error);
  const code = typeof shape.code === "string" ? shape.code : undefined;
  const constraint =
    typeof shape.constraint === "string" ? shape.constraint : undefined;

  if (code === "23505" && constraint === "materials_slug_unique" && metadata !== undefined) {
    return { code: "slug_conflict", slug: metadata.slug };
  }
  if (
    code === "23505" &&
    (constraint === "material_tags_primary" ||
      constraint === "material_revision_tags_primary") &&
    metadata?.tagIds[0] !== undefined
  ) {
    return { code: "duplicate_tag", tagId: metadata.tagIds[0] };
  }
  if (
    code === "23505" &&
    constraint === "series_memberships_ordinal_unique" &&
    metadata?.seriesMemberships[0] !== undefined
  ) {
    return {
      code: "series_ordinal_conflict",
      seriesId: metadata.seriesMemberships[0].seriesId,
      ordinal: metadata.seriesMemberships[0].ordinal,
    };
  }
  if (code === "23503") {
    return {
      code: "invalid_reference",
      issues: [{ code: "reference_not_found", path: "/metadata" }],
    };
  }
  if (["40001", "40P01", "53300", "57P01"].includes(code ?? "")) {
    return { code: "dependency_unavailable", retryable: true };
  }
  return { code: "internal_error", correlationId: randomUUID() };
}
