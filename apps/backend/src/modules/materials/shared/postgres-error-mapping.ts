import { randomUUID } from "node:crypto";

import { isRetryablePostgresError } from "../../../infrastructure/postgres/is-retryable-postgres-error.js";
import type {
  DuplicateTagError,
  InvalidReferenceError,
  PersistenceConflictError,
  SystemError,
} from "../facets/material-authoring/material-authoring.contract.js";
import type { MaterialRevisionMetadata } from "../domain/material-revision-metadata.js";

interface PostgreSqlErrorShape {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
  readonly driverAdapterError?: unknown;
  readonly errors?: unknown;
  readonly message?: unknown;
  readonly meta?: unknown;
  readonly originalCode?: unknown;
}

interface PostgreSqlErrorSignals {
  readonly codes: readonly string[];
  readonly constraints: readonly string[];
  readonly fieldSets: readonly (readonly string[])[];
}

type PostgresOperationError =
  | DuplicateTagError
  | InvalidReferenceError
  | PersistenceConflictError
  | SystemError;

const referenceConstraints = new Map<string, string>([
  ["material_revisions_topic_fk", "/metadata/topicId"],
  ["material_revisions_format_fk", "/metadata/formatId"],
  ["material_tags_tag_fk", "/metadata/tagIds"],
  ["material_revision_tags_tag_fk", "/metadata/tagIds"],
  ["series_memberships_series_fk", "/metadata/seriesMemberships"],
  ["material_revision_series_series_fk", "/metadata/seriesMemberships"],
]);

export function mapPostgresError(
  error: unknown,
  metadata?: MaterialRevisionMetadata,
): PostgresOperationError {
  const signals = errorSignals(error);
  const uniqueViolation =
    signals.codes.includes("23505") || signals.codes.includes("P2002");

  if (
    uniqueViolation &&
    (hasConstraint(signals, "materials_slug_unique") ||
      hasConstraint(signals, "published_materials_slug_unique") ||
      hasFields(signals, ["slug"])) &&
    metadata !== undefined
  ) {
    return { code: "slug_conflict", slug: metadata.slug };
  }
  if (
    uniqueViolation &&
    (hasConstraint(signals, "material_tags_primary") ||
      hasConstraint(signals, "material_revision_tags_primary") ||
      hasFields(signals, ["material_id", "tag_id"]) ||
      hasFields(signals, ["revision_id", "tag_id"])) &&
    metadata?.tagIds[0] !== undefined
  ) {
    return { code: "duplicate_tag", tagId: metadata.tagIds[0] };
  }
  if (
    uniqueViolation &&
    (hasConstraint(signals, "series_memberships_ordinal_unique") ||
      hasFields(signals, ["series_id", "ordinal"])) &&
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
    signals.codes.includes("23503") || signals.codes.includes("P2003")
      ? signals.constraints
          .map((constraint) => referenceConstraints.get(constraint))
          .find((path) => path !== undefined)
      : undefined;
  if (referencePath !== undefined) {
    return {
      code: "invalid_reference",
      issues: [{ code: "reference_not_found", path: referencePath }],
    };
  }
  return mapPostgresReadError(error);
}

export function mapPostgresLifecycleError(
  error: unknown,
  metadata?: MaterialRevisionMetadata,
): InvalidReferenceError | PersistenceConflictError | SystemError {
  const mapped = mapPostgresError(error, metadata);
  return mapped.code === "duplicate_tag"
    ? mapPostgresReadError(error)
    : mapped;
}

export function mapPostgresReadError(error: unknown): SystemError {
  if (isRetryablePostgresError(error)) {
    return { code: "dependency_unavailable", retryable: true };
  }
  return { code: "internal_error", correlationId: randomUUID() };
}

export function mapPostgresValidationError(
  error: unknown,
): InvalidReferenceError | SystemError {
  const signals = errorSignals(error);
  const referencePath =
    signals.codes.includes("23503") || signals.codes.includes("P2003")
      ? signals.constraints
          .map((constraint) => referenceConstraints.get(constraint))
          .find((path) => path !== undefined)
      : undefined;
  return referencePath === undefined
    ? mapPostgresReadError(error)
    : {
        code: "invalid_reference",
        issues: [{ code: "reference_not_found", path: referencePath }],
      };
}

function errorSignals(error: unknown): PostgreSqlErrorSignals {
  const codes: string[] = [];
  const constraints: string[] = [];
  const fieldSets: string[][] = [];
  const visited = new Set<object>();

  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 5 || typeof candidate !== "object" || candidate === null) {
      return;
    }
    if (visited.has(candidate)) {
      return;
    }
    visited.add(candidate);
    const shape = candidate as PostgreSqlErrorShape;
    for (const code of [shape.code, shape.originalCode]) {
      if (typeof code === "string") {
        codes.push(code);
      }
    }
    collectConstraint(shape.constraint, constraints, fieldSets);
    for (const child of [
      shape.cause,
      shape.driverAdapterError,
      shape.meta,
      ...(isUnknownArray(shape.errors) ? shape.errors : []),
    ]) {
      visit(child, depth + 1);
    }
  };

  visit(error, 0);
  return { codes, constraints, fieldSets };
}

function collectConstraint(
  constraint: unknown,
  constraints: string[],
  fieldSets: string[][],
): void {
  if (typeof constraint === "string") {
    constraints.push(constraint);
    return;
  }
  if (typeof constraint !== "object" || constraint === null) {
    return;
  }
  const shape = constraint as {
    readonly fields?: unknown;
    readonly index?: unknown;
  };
  if (typeof shape.index === "string") {
    constraints.push(shape.index);
  }
  if (
    Array.isArray(shape.fields) &&
    shape.fields.every((field): field is string => typeof field === "string")
  ) {
    fieldSets.push(shape.fields);
  }
}

function hasConstraint(
  signals: PostgreSqlErrorSignals,
  expected: string,
): boolean {
  return signals.constraints.includes(expected);
}

function hasFields(
  signals: PostgreSqlErrorSignals,
  expected: readonly string[],
): boolean {
  return signals.fieldSets.some(
    (fields) =>
      fields.length === expected.length &&
      expected.every((field) => fields.includes(field)),
  );
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
