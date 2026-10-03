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
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { SalesFunnel } from "../../facets/sales-funnel/sales-funnel.js";
import {
  funnelReportQuerySchema,
  funnelReportSchema,
} from "./read-funnel-report.contract.js";

@ApiTags("Sales funnel")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("sales-funnel/report")
export class ReadFunnelReportController {
  constructor(@Inject(SalesFunnel) private readonly funnel: SalesFunnel) {}

  @Get()
  @ApiOperation({
    operationId: "readSalesFunnelReport",
    summary:
      "Read the aggregated sales funnel of one Guide by bot source for the owner",
  })
  @ApiQuery({
    name: "from",
    required: true,
    schema: toOpenApiSchema(funnelReportQuerySchema.shape.from),
  })
  @ApiQuery({
    name: "to",
    required: true,
    schema: toOpenApiSchema(funnelReportQuerySchema.shape.to),
  })
  @ApiQuery({
    name: "guideId",
    required: false,
    schema: toOpenApiSchema(funnelReportQuerySchema.shape.guideId),
  })
  @ApiQuery({
    name: "chapterId",
    required: false,
    schema: toOpenApiSchema(funnelReportQuerySchema.shape.chapterId),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(funnelReportSchema) })
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
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["guide_not_found", "chapter_not_found"]),
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
    @Query() input: unknown,
  ) {
    const result = await this.funnel.readReport(current.accountId, input);
    if (result.ok) return result.value;
    switch (result.error.code) {
      case "invalid_request":
        throw problemException(
          400,
          "invalid_request",
          "Invalid report request",
        );
      case "forbidden":
        throw problemException(
          403,
          "forbidden",
          "Sales report permission required",
        );
      case "guide_not_found":
        throw problemException(404, "guide_not_found", "Guide not found");
      case "chapter_not_found":
        throw problemException(404, "chapter_not_found", "Chapter not found");
      case "dependency_unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Report is unavailable",
        );
    }
  }
}
