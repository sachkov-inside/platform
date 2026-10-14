import { Controller, Get, Inject, Query } from "@nestjs/common";
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
import { PUBLISHED_CATALOG_CURSOR_MAX_LENGTH } from "@inside/contracts/published-catalog";
import { PublicCatalogCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  PUBLISHED_MATERIAL_READER,
  publishedMaterialProblemHttpSchema,
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import { throwContentLibraryError } from "../../adapters/nest/content-library-http-errors.js";
import { listPublicSiteIndex } from "./list-public-site-index.js";

const afterSchema = z.string().min(1).max(PUBLISHED_CATALOG_CURSOR_MAX_LENGTH);
const querySchema = z.object({ after: afterSchema.optional() }).strict();
export const publicSiteIndexPageHttpSchema = z
  .object({
    items: z.array(
      z
        .object({
          slug: z.string().min(1),
          publishedAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
    productSlugs: z.array(z.string().min(1)),
    topicSlugs: z.array(z.string().min(1)),
    nextCursor: afterSchema.nullable(),
  })
  .strict();

@ApiTags("Content library")
@PublicCatalogCache()
@Controller("library")
export class ListPublicSiteIndexController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly reader: Pick<PublishedMaterialReader, "listSiteMaterials">,
  ) {}

  @Get("site-index")
  @ApiOperation({
    operationId: "listPublicSiteIndex",
    summary:
      "Enumerate public addresses; collection slugs occur on the initial page only",
  })
  @ApiQuery({
    name: "after",
    required: false,
    schema: toOpenApiSchema(afterSchema),
  })
  @ApiOkResponse({
    description:
      "Bounded published addresses, with initial collection slugs and an opaque continuation",
    schema: toOpenApiSchema(publicSiteIndexPageHttpSchema),
  })
  @ApiBadRequestResponse({
    description: "Invalid continuation",
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiInternalServerErrorResponse({
    description: "Index failed internally",
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiServiceUnavailableResponse({
    description: "Index dependency unavailable",
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  async handle(@Query() input: unknown) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success)
      throwContentLibraryError({ code: "invalid_request_shape" });
    const result = await listPublicSiteIndex(this.reader, {
      first: 200,
      ...(parsed.data.after === undefined ? {} : { after: parsed.data.after }),
    });
    if (!result.ok) throwContentLibraryError(result.error);
    return result.value;
  }
}
