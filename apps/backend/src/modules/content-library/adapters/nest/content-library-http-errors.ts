import { problemException } from "../../../../infrastructure/http/problem-details.js";
import type { PublishedMaterialDiscoveryError } from "../../features/discover-published-materials/discover-published-materials.contract.js";
import type { PublishedMaterialCatalogError } from "../../features/list-published-materials/list-published-materials.contract.js";

export function throwContentLibraryError(
  error: PublishedMaterialCatalogError | PublishedMaterialDiscoveryError,
): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw problemException(400, error.code, "Invalid request shape");
    case "discovery_not_found":
      throw problemException(404, error.code, "Discovery not found");
    case "dependency_unavailable":
      throw problemException(503, error.code, "Dependency unavailable", {
        retryable: error.retryable,
      });
    case "internal_error":
      throw problemException(500, error.code, "Internal error", {
        correlationId: error.correlationId,
      });
  }
}
