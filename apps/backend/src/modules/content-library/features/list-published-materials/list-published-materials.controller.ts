import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PublicCatalogCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  PUBLISHED_MATERIAL_READER,
  publishedMaterialProblemHttpSchema,
  publishedMaterialProjectionHttpSchema,
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import {
  type PublishedMaterialCatalogError,
} from "./list-published-materials.contract.js";
import { listPublishedMaterials } from "./list-published-materials.js";

const CATALOG_PAGE_SIZE = 12;
const catalogPageSchema = z
  .object({
    items: z.array(publishedMaterialProjectionHttpSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

@ApiTags("Content library")
@PublicCatalogCache()
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
  @ApiOperation({ operationId: "listPublishedMaterials", summary: "List safe published Material projections" })
  @ApiQuery({ name: "after", required: false, schema: toOpenApiSchema(z.string().min(1).max(512)) })
  @ApiOkResponse({ description: "A deterministic page of published Materials", schema: toOpenApiSchema(catalogPageSchema) })
  @ApiBadRequestResponse({ description: "Catalog cursor is malformed", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiInternalServerErrorResponse({ description: "Catalog failed internally", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiServiceUnavailableResponse({ description: "Catalog dependency is unavailable", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  async handle(
    @Query("after") after: string | undefined,
  ) {
    const result = await listPublishedMaterials(
      this.publishedMaterialReader,
      {
        first: CATALOG_PAGE_SIZE,
        ...(after === undefined ? {} : { after }),
      },
    );
    if (!result.ok) {
      throwListPublishedMaterialsError(result.error);
    }
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
