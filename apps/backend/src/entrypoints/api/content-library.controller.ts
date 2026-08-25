import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Query,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import {
  CONTENT_LIBRARY,
  type ContentLibrary,
  type PublishedMaterialCatalogError,
} from "../../modules/content-library/index.js";

const CATALOG_PAGE_SIZE = 12;

@Controller("library")
export class ContentLibraryController {
  constructor(
    @Inject(CONTENT_LIBRARY)
    private readonly contentLibrary: ContentLibrary,
  ) {}

  @Get("materials")
  @ApiOperation({ summary: "List safe published Material projections" })
  @ApiQuery({ name: "after", required: false })
  @ApiOkResponse({ description: "A deterministic page of published Materials" })
  @ApiBadRequestResponse({ description: "Catalog cursor is malformed" })
  @ApiInternalServerErrorResponse({ description: "Catalog failed internally" })
  @ApiServiceUnavailableResponse({ description: "Catalog dependency is unavailable" })
  async list(
    @Query("after") after: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.contentLibrary.listPublishedMaterials({
      first: CATALOG_PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    });
    if (!result.ok) {
      response.type("application/problem+json");
      throwContentLibraryError(result.error);
    }

    response.header("Cache-Control", "public, max-age=0, must-revalidate");
    return result.value;
  }
}

export function throwContentLibraryError(error: PublishedMaterialCatalogError): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw new BadRequestException({
        type: "urn:inside:problem:invalid-request-shape",
        title: "Invalid request shape",
        status: 400,
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
