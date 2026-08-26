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
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import {
  type PublishedMaterialCatalogError,
} from "./list-published-materials.contract.js";
import { listPublishedMaterials } from "./list-published-materials.js";

const CATALOG_PAGE_SIZE = 12;

@Controller("library")
export class ListPublishedMaterialsController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterialReader: Pick<
      PublishedMaterialReader,
      "listProjections"
    >,
  ) {}

  @Get("materials")
  @ApiOperation({ summary: "List safe published Material projections" })
  @ApiQuery({ name: "after", required: false })
  @ApiOkResponse({ description: "A deterministic page of published Materials" })
  @ApiBadRequestResponse({ description: "Catalog cursor is malformed" })
  @ApiInternalServerErrorResponse({ description: "Catalog failed internally" })
  @ApiServiceUnavailableResponse({ description: "Catalog dependency is unavailable" })
  async handle(
    @Query("after") after: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await listPublishedMaterials(
      this.publishedMaterialReader,
      {
        first: CATALOG_PAGE_SIZE,
        ...(after === undefined ? {} : { after }),
      },
    );
    if (!result.ok) {
      response.type("application/problem+json");
      response.header("Cache-Control", "private, no-store");
      throwListPublishedMaterialsError(result.error);
    }

    response.header(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=60",
    );
    return result.value;
  }
}

function throwListPublishedMaterialsError(
  error: PublishedMaterialCatalogError,
): never {
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
