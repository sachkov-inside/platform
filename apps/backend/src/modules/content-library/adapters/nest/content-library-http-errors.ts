import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { PublishedMaterialDiscoveryError } from "../../features/discover-published-materials/discover-published-materials.contract.js";
import type { PublishedMaterialCatalogError } from "../../features/list-published-materials/list-published-materials.contract.js";

export function throwContentLibraryError(
  error: PublishedMaterialCatalogError | PublishedMaterialDiscoveryError,
): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw new BadRequestException({
        type: "urn:inside:problem:invalid-request-shape",
        title: "Invalid request shape",
        status: 400,
        code: error.code,
      });
    case "discovery_not_found":
      throw new NotFoundException({
        type: "urn:inside:problem:discovery-not-found",
        title: "Discovery not found",
        status: 404,
        code: error.code,
      });
    case "dependency_unavailable":
      throw new ServiceUnavailableException({
        type: "urn:inside:problem:dependency-unavailable",
        title: "Dependency unavailable",
        status: 503,
        code: error.code,
        retryable: error.retryable,
      });
    case "internal_error":
      throw new InternalServerErrorException({
        type: "urn:inside:problem:internal-error",
        title: "Internal error",
        status: 500,
        code: error.code,
        correlationId: error.correlationId,
      });
  }
}
