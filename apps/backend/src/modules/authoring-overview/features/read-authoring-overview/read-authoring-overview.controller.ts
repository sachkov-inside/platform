import {
  Controller,
  Get,
  Inject,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

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
  authoringOverviewSchema,
  overviewPeriodDaysSchema,
  type AuthoringOverview,
} from "../../shared/overview-contract.js";
import { AuthoringOverviewReads } from "../../shared/overview-reads.js";

@ApiTags("Authoring Overview")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiAccountErrors(401, 500)
@Controller("admin/overview")
export class ReadAuthoringOverviewController {
  constructor(
    @Inject(AuthoringOverviewReads)
    private readonly overview: AuthoringOverviewReads,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "readAuthoringOverview",
    summary:
      "Read the admin Overview for a period of Moscow calendar days: metrics with the previous period, a short funnel, items needing attention, recent events and learning by Product. Each block answers by the caller's rights: billing:manage reads sales and access, materials:manage reads submissions; a block without its right is forbidden, a block whose owner failed is unavailable",
  })
  @ApiQuery({
    name: "period",
    required: false,
    description: `Days in the period, ${String(OVERVIEW_DEFAULT_PERIOD)} by default`,
    schema: toOpenApiSchema(overviewPeriodDaysSchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(authoringOverviewSchema) })
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
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Query() input: unknown,
  ): Promise<AuthoringOverview> {
    const result = await this.overview.readAuthoringOverview(
      current.accountId,
      input,
    );
    if (result.ok) return result.value;
    switch (result.error.code) {
      case "invalid_request":
        throw problemException(
          400,
          "invalid_request",
          "Invalid overview request",
        );
      case "forbidden":
        throw problemException(
          403,
          "forbidden",
          "Overview permission required",
        );
      case "dependency_unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Overview is unavailable",
        );
    }
  }
}
