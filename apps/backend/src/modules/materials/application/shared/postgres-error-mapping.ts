import { randomUUID } from "node:crypto";

import type { ContentAuthoringError } from "../content-authoring.interface.js";
import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";

interface PostgreSqlErrorShape {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
  readonly errors?: unknown;
  readonly message?: unknown;
}

function errorShape(error: unknown): PostgreSqlErrorShape {
  return typeof error === "object" && error !== null ? error : {};
}

interface ErrorSignals {
  readonly codes: readonly string[];
  readonly messages: readonly string[];
}

function errorSignals(error: unknown, depth = 0): ErrorSignals {
  if (depth > 3) {
    return { codes: [], messages: [] };
  }
  const shape = errorShape(error);
  const codes = typeof shape.code === "string" ? [shape.code] : [];
  const messages = typeof shape.message === "string" ? [shape.message] : [];
  const children = [
    ...(shape.cause === undefined ? [] : [shape.cause]),
    ...(Array.isArray(shape.errors) ? shape.errors : []),
  ].map((child) => errorSignals(child, depth + 1));
  return {
    codes: [...codes, ...children.flatMap((child) => child.codes)],
    messages: [...messages, ...children.flatMap((child) => child.messages)],
  };
}

const referenceConstraints = new Map<string, string>([
  ["material_revisions_topic_fk", "/metadata/topicId"],
  ["material_revisions_format_fk", "/metadata/formatId"],
  ["material_tags_tag_fk", "/metadata/tagIds"],
  ["material_revision_tags_tag_fk", "/metadata/tagIds"],
  ["series_memberships_series_fk", "/metadata/seriesMemberships"],
  ["material_revision_series_series_fk", "/metadata/seriesMemberships"],
]);

const retryableConnectionCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

const retryablePgClientMessages = new Set([
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "timeout exceeded when trying to connect",
]);

export function mapPostgresError(
  error: unknown,
  metadata?: MaterialRevisionMetadata,
): ContentAuthoringError {
  const shape = errorShape(error);
  const code = typeof shape.code === "string" ? shape.code : undefined;
  const constraint =
    typeof shape.constraint === "string" ? shape.constraint : undefined;
  const signals = errorSignals(error);

  if (
    code === "23505" &&
    (constraint === "materials_slug_unique" ||
      constraint === "published_materials_slug_unique") &&
    metadata !== undefined
  ) {
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
    metadata?.seriesMemberships.length === 1
  ) {
    const membership = metadata.seriesMemberships[0];
    if (membership !== undefined) {
      return {
        code: "series_ordinal_conflict",
        seriesId: membership.seriesId,
        ordinal: membership.ordinal,
      };
    }
  }
  const referencePath =
    code === "23503" && constraint !== undefined
      ? referenceConstraints.get(constraint)
      : undefined;
  if (referencePath !== undefined) {
    return {
      code: "invalid_reference",
      issues: [{ code: "reference_not_found", path: referencePath }],
    };
  }
  if (
    signals.codes.some(
      (candidate) =>
        retryableConnectionCodes.has(candidate) || candidate.startsWith("08"),
    ) ||
    signals.messages.some((message) => retryablePgClientMessages.has(message))
  ) {
    return { code: "dependency_unavailable", retryable: true };
  }
  return { code: "internal_error", correlationId: randomUUID() };
}
