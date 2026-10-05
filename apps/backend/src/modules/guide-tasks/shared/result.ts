import { randomUUID } from "node:crypto";

import type { DependencyScope } from "../../../infrastructure/observability/index.js";
import { isRetryablePostgresError } from "../../../infrastructure/postgres/is-retryable-postgres-error.js";

export type Result<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };

export type SystemError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export function scope(operation: string): DependencyScope {
  return { module: "guide-tasks", operation };
}

/**
 * The failed result a database or dependency error becomes; the caller records it with
 * `dependencyFailure(scope(...), error, systemFailure(error))`.
 */
export function systemFailure(error: unknown): {
  readonly ok: false;
  readonly error: SystemError;
} {
  return {
    ok: false,
    error: isRetryablePostgresError(error)
      ? { code: "dependency_unavailable", retryable: true }
      : { code: "internal_error", correlationId: randomUUID() },
  };
}
