import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  ApiAccountErrors,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  OVERVIEW_DEFAULT_PERIOD,
  overviewPeriodDaysSchema,
  productOverviewSchema,
  type ProductOverview,
} from "../../shared/overview-contract.js";
import {
  OVERVIEW_DEPENDENCIES,
  type OverviewDependencies,
} from "../../shared/overview-composition.js";
import { readProductOverview } from "./read-product-overview.js";

@ApiTags("Authoring Overview")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiAccountErrors(401, 500)
@Controller("admin/products/:productId/overview")
export class ReadProductOverviewController {
  constructor(
    @Inject(OVERVIEW_DEPENDENCIES)
    private readonly owners: OverviewDependencies,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "readProductOverview",
    summary:
      "Read one Product's Overview for a period of Moscow calendar days: active holders by origin, revenue and sales with the previous period, the accepting waitlist intake, learning and recent payment and access events. Requires billing:manage; a block whose owner failed is unavailable",
  })
  @ApiParam({ name: "productId", schema: toOpenApiSchema(z.uuid()) })
  @ApiQuery({
    name: "period",
    required: false,
    description: `Days in the period, ${String(OVERVIEW_DEFAULT_PERIOD)} by default`,
    schema: toOpenApiSchema(overviewPeriodDaysSchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productOverviewSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["product_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("productId") productId: string,
    @Query() input: unknown,
  ): Promise<ProductOverview> {
    const result = await readProductOverview(
      this.owners,
      current.accountId,
      productId,
      input,
    );
    if (result.ok) return result.value;
    switch (result.error.code) {
      case "invalid_request":
        throw problemException(
          400,
          "invalid_request",
          "Invalid product overview request",
        );
      case "forbidden":
        throw problemException(
          403,
          "forbidden",
          "Product overview permission required",
        );
      case "product_not_found":
        throw problemException(404, "product_not_found", "Product not found");
      case "dependency_unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Product overview is unavailable",
        );
    }
  }
}
