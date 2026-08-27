import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PublishedMaterialCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  publishedMaterialProblemHttpSchema,
  publishedMaterialReadHttpSchema,
} from "../../adapters/nest/published-material-http.js";
import { anonymousSubject } from "../../ports/content-access.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../../facets/published-material-reader/published-material-reader.js";
import type { PublishedMaterialReadError } from "./read-published-material.contract.js";

@ApiTags("Published materials")
@PublishedMaterialCache()
@Controller("materials")
export class ReadPublishedMaterialController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterials: PublishedMaterialReader,
  ) {}

  @Get(":slug")
  @ApiOperation({ operationId: "readPublishedMaterial", summary: "Read the current published Material" })
  @ApiParam({ name: "slug", schema: toOpenApiSchema(z.string().min(1).max(120)) })
  @ApiOkResponse({ description: "Published Material body or an access-safe teaser", schema: toOpenApiSchema(publishedMaterialReadHttpSchema) })
  @ApiBadRequestResponse({ description: "Published Material request is malformed", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiNotFoundResponse({ description: "Published Material does not exist", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiServiceUnavailableResponse({ description: "Published Material dependency is unavailable", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiInternalServerErrorResponse({ description: "Published Material read failed unexpectedly", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  async read(
    @Param("slug") slug: string,
  ) {
    const result = await this.publishedMaterials.read({
      subject: anonymousSubject,
      slug,
    });
    if (!result.ok) {
      throwReadPublishedMaterialError(result.error);
    }
    return result.value;
  }
}

export function throwReadPublishedMaterialError(
  error: PublishedMaterialReadError,
): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw new BadRequestException({
        type: "urn:inside:problem:invalid-request-shape",
        title: "Invalid request shape",
        status: 400,
        code: error.code,
      });
    case "material_not_found":
      throw new NotFoundException({
        type: "urn:inside:problem:material-not-found",
        title: "Material not found",
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
