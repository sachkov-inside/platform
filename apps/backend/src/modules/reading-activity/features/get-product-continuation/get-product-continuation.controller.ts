import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { PersonalHome } from "../../facets/personal-home/personal-home.js";
import { throwPersonalHomeError } from "../../adapters/nest/personal-home-http.js";
import { publishedCatalogFacetHttpSchema } from "../../../content-library/index.js";
import { continueMaterialSchema } from "../get-continue-materials/get-continue-materials.controller.js";
export const productContinuationHttpSchema = z
  .object({
    collection: publishedCatalogFacetHttpSchema,
    started: z.boolean(),
    read: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    continuation: z
      .object({
        materialSlug: z.string(),
        resume: continueMaterialSchema.shape.resume,
      })
      .strict()
      .nullable(),
  })
  .strict();
@ApiTags("Personal home")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("reading-activity")
export class GetProductContinuationController {
  constructor(@Inject(PersonalHome) private readonly home: PersonalHome) {}
  @Get("product-continuation/:slug")
  @ApiOperation({
    operationId: "getProductContinuation",
    summary:
      "Read saved progress and the next accessible Material in a published Product",
  })
  @ApiParam({
    name: "slug",
    schema: toOpenApiSchema(z.string().min(1).max(120)),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productContinuationHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["product_not_found"]),
    ),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async readProduct(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("slug") slug: string,
  ) {
    const result = await this.home.getProduct(current.accountId, slug);
    if (!result.ok) throwPersonalHomeError(result.error.code);
    return result.value;
  }
}
