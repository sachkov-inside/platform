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

import { ViewerAwareCatalogCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  anonymousSubject,
  CONTENT_ACCESS,
  type ContentAccess,
} from "../../../content-access/index.js";
import {
  accountId as checkedAccountId,
  accountProblemSchema,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
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
const catalogItemSchema = publishedMaterialProjectionHttpSchema.extend({
  availability: z.enum(["available", "locked", "unavailable"]),
});
const catalogPageSchema = z
  .object({
    items: z.array(catalogItemSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

@ApiTags("Content library")
@ViewerAwareCatalogCache()
@OptionalAccountEndpoint()
@Controller("library")
export class ListPublishedMaterialsController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterialReader: Pick<
      PublishedMaterialReader,
      "listProjections"
    >,
    @Inject(CONTENT_ACCESS)
    private readonly contentAccess: Pick<
      ContentAccess,
      "checkAvailabilityMany"
    >,
  ) {}

  @Get("materials")
  @ApiOperation({ operationId: "listPublishedMaterials", summary: "List safe published Material projections" })
  @ApiQuery({ name: "after", required: false, schema: toOpenApiSchema(z.string().min(1).max(512)) })
  @ApiOkResponse({ description: "A deterministic page of published Materials", schema: toOpenApiSchema(catalogPageSchema) })
  @ApiBadRequestResponse({ description: "Catalog cursor is malformed", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiInternalServerErrorResponse({ description: "Catalog or Account resolution failed internally", content: problemDetailsOneOfContent(publishedMaterialProblemHttpSchema, accountProblemSchema) })
  @ApiServiceUnavailableResponse({ description: "Catalog or Account proof dependency is unavailable", content: problemDetailsOneOfContent(publishedMaterialProblemHttpSchema, accountProblemSchema) })
  async handle(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Query("after") after: string | undefined,
  ) {
    const result = await listPublishedMaterials(
      this.publishedMaterialReader,
      this.contentAccess,
      {
        subject:
          account === undefined
            ? anonymousSubject
            : {
                kind: "account",
                accountId: checkedAccountId(account.accountId),
              },
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
