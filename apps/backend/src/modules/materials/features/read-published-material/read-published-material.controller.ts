import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Res,
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
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import { anonymousSubject } from "../../ports/content-access.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../../facets/published-material-reader/published-material-reader.js";
import type { PublishedMaterialReadError } from "./read-published-material.contract.js";

@Controller("materials")
export class ReadPublishedMaterialController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterials: PublishedMaterialReader,
  ) {}

  @Get(":slug")
  @ApiOperation({ summary: "Read the current published Material revision" })
  @ApiParam({ name: "slug" })
  @ApiOkResponse({ description: "Published Material body or an access-safe teaser" })
  @ApiBadRequestResponse({ description: "Published Material request is malformed" })
  @ApiNotFoundResponse({ description: "Published Material does not exist" })
  @ApiServiceUnavailableResponse({ description: "Published Material dependency is unavailable" })
  @ApiInternalServerErrorResponse({ description: "Published Material read failed unexpectedly" })
  async read(
    @Param("slug") slug: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.publishedMaterials.read({
      subject: anonymousSubject,
      slug,
    });
    if (!result.ok) {
      response.type("application/problem+json");
      throwReadPublishedMaterialError(result.error);
    }

    response.header(
      "Cache-Control",
      result.value.cacheScope === "public"
        ? "public, max-age=0, must-revalidate"
        : "private, no-store",
    );
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
