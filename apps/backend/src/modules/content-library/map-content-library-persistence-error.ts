import { randomUUID } from "node:crypto";

import { isRetryablePostgresError } from "../../infrastructure/postgres/index.js";
import type { ContentLibrarySystemError } from "./content-library.interface.js";

export function mapContentLibraryPersistenceError(
  error: unknown,
): ContentLibrarySystemError {
  if (isRetryablePostgresError(error)) {
    return { code: "dependency_unavailable", retryable: true };
  }
  return { code: "internal_error", correlationId: randomUUID() };
}
