import { problemException } from "../../../../infrastructure/http/problem-details.js";
import type { TermMutationError } from "../../features/import-source-term/import-source-term.contract.js";

export function throwTermMutationError(error: TermMutationError): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw problemException(400, error.code, "Invalid term request");
    case "forbidden":
      throw problemException(403, error.code, "Term authoring forbidden");
    case "invalid_term_material":
      throw problemException(
        400,
        error.code,
        "Detailed Material does not exist",
      );
    case "source_mismatch":
    case "term_version_conflict":
    case "idempotency_conflict":
      throw problemException(
        409,
        error.code,
        "Term mutation conflicts with current state",
      );
    case "dependency_unavailable":
      throw problemException(503, error.code, "Term dependency unavailable", {
        retryable: true,
      });
    case "internal_error":
      throw problemException(500, error.code, "Term mutation failed", {
        correlationId: error.correlationId,
      });
  }
}
