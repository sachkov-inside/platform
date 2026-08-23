import { randomUUID } from "node:crypto";

import type {
  ContentAuthoringError,
  DraftMetadata,
} from "../content-authoring.interface.js";

interface PostgreSqlErrorShape {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly detail?: unknown;
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
  const detail = typeof shape.detail === "string" ? shape.detail : undefined;

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
    metadata !== undefined
  ) {
    const conflictingKey = detail?.match(
      /\(series_id, ordinal\)=\(([0-9a-f-]{36}),\s*(-?\d+)\)/i,
    );
    const seriesId = conflictingKey?.[1];
    const ordinal = Number(conflictingKey?.[2]);
    const membership = metadata.seriesMemberships.find(
      (candidate) =>
        candidate.seriesId.toLowerCase() === seriesId?.toLowerCase() &&
        candidate.ordinal === ordinal,
    );
    if (membership !== undefined) {
      return {
        code: "series_ordinal_conflict",
        seriesId: membership.seriesId,
        ordinal: membership.ordinal,
      };
    }
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
