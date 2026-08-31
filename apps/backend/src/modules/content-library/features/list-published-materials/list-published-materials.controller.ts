import {
  Controller,
  Get,
  Inject,
  Query,
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
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import { throwContentLibraryError } from "../../adapters/nest/content-library-http-errors.js";
import { publishedCatalogPageHttpSchema } from "../../shared/published-catalog-http.js";
import { listPublishedMaterials } from "./list-published-materials.js";

const CATALOG_PAGE_SIZE = 12;
const catalogSortSchema = z.enum(["newest", "relevance", "series", "title"]);
const facetSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const queryValueSchema = z.union([z.string(), z.array(z.string()).max(20)]);
const catalogHttpQuerySchema = z
  .object({
    after: queryValueSchema.optional(),
    format: queryValueSchema.optional(),
    q: queryValueSchema.optional(),
    series: queryValueSchema.optional(),
    sort: queryValueSchema.optional(),
    topic: queryValueSchema.optional(),
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
  @ApiOperation({
    operationId: "listPublishedMaterials",
    summary: "List safe published Material projections",
  })
  @ApiQuery({
    name: "after",
    required: false,
    schema: toOpenApiSchema(z.string().min(1).max(512)),
  })
  @ApiQuery({
    name: "q",
    required: false,
    schema: toOpenApiSchema(z.string().min(1).max(120)),
  })
  @ApiQuery({
    name: "topic",
    required: false,
    isArray: true,
    schema: toOpenApiSchema(z.array(facetSlugSchema).max(20)),
  })
  @ApiQuery({
    name: "format",
    required: false,
    isArray: true,
    schema: toOpenApiSchema(z.array(facetSlugSchema).max(20)),
  })
  @ApiQuery({
    name: "series",
    required: false,
    isArray: true,
    schema: toOpenApiSchema(z.array(facetSlugSchema).max(20)),
  })
  @ApiQuery({
    name: "sort",
    required: false,
    schema: toOpenApiSchema(catalogSortSchema),
  })
  @ApiOkResponse({
    description: "A deterministic page of published Materials",
    schema: toOpenApiSchema(publishedCatalogPageHttpSchema),
  })
  @ApiBadRequestResponse({
    description: "Catalog query is malformed",
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiInternalServerErrorResponse({
    description: "Catalog or Account resolution failed internally",
    content: problemDetailsOneOfContent(
      publishedMaterialProblemHttpSchema,
      accountProblemSchema,
    ),
  })
  @ApiServiceUnavailableResponse({
    description: "Catalog or Account proof dependency is unavailable",
    content: problemDetailsOneOfContent(
      publishedMaterialProblemHttpSchema,
      accountProblemSchema,
    ),
  })
  async handle(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Query() input: unknown,
  ) {
    const parsed = catalogHttpQuerySchema.safeParse(input);
    if (!parsed.success) {
      throwContentLibraryError({ code: "invalid_request_shape" });
    }
    const after = singleQueryValue(parsed.data.after);
    const q = singleQueryValue(parsed.data.q);
    const sort = singleQueryValue(parsed.data.sort);
    const parsedSort =
      sort === undefined ? undefined : catalogSortSchema.safeParse(sort);
    if (
      after === null ||
      q === null ||
      sort === null ||
      (parsedSort !== undefined && !parsedSort.success)
    ) {
      throwContentLibraryError({ code: "invalid_request_shape" });
    }
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
        ...(q === undefined ? {} : { q }),
        ...(parsedSort === undefined
          ? {}
          : { sort: parsedSort.data }),
        formatSlugs: queryValues(parsed.data.format),
        seriesSlugs: queryValues(parsed.data.series),
        topicSlugs: queryValues(parsed.data.topic),
      },
    );
    if (!result.ok) {
      throwContentLibraryError(result.error);
    }
    return result.value;
  }
}

function singleQueryValue(
  value: string | readonly string[] | undefined,
): string | null | undefined {
  return typeof value === "string" || value === undefined ? value : null;
}

function queryValues(
  value: string | readonly string[] | undefined,
): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
}
