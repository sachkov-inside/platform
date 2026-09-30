import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import {
  bearerCredential,
  credentialsMatch,
} from "../../../../infrastructure/http/bearer-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  botEventDeliverySchema,
  botEventReceiptSchema,
} from "../../domain/bot-events.js";
import { SalesFunnel } from "../../facets/sales-funnel/sales-funnel.js";

@ApiTags("Sales funnel integration")
@ApiBearerAuth("telegram-sales-funnel")
@PrivateNoStore()
@Controller("integrations/telegram/v1/sales-funnel/events")
export class RecordBotEventsController {
  constructor(
    @Inject(SalesFunnel) private readonly funnel: SalesFunnel,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "recordSalesFunnelBotEvents",
    summary:
      "Record bot entries, marketing consent and account links for the sales funnel report",
  })
  @ApiBody({ schema: toOpenApiSchema(botEventDeliverySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(botEventReceiptSchema) })
  @ApiResponse({
    status: 400,
    description: "Envelope or contract version is invalid",
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 401,
    description: "Integration credential is missing, invalid or not configured",
    content: problemDetailsContent(problemDetailsSchema(401, ["unauthorized"])),
  })
  @ApiResponse({
    status: 409,
    description: "An event ID was already recorded with different content",
    content: problemDetailsContent(
      problemDetailsSchema(409, ["event_conflict"]),
    ),
  })
  @ApiResponse({
    status: 503,
    description: "Event storage is unavailable; retry the same delivery",
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async record(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = this.config.salesFunnelIngressSecret;
    if (
      expected === undefined ||
      !credentialsMatch(bearerCredential(authorization), expected)
    )
      throw problemException(
        401,
        "unauthorized",
        "Sales funnel credential required",
      );
    const result = await this.funnel.recordBotEvents(body);
    if (result.ok) return result.value;
    switch (result.error.code) {
      case "invalid_request":
        throw problemException(
          400,
          "invalid_request",
          "Invalid event delivery",
        );
      case "event_conflict":
        throw problemException(
          409,
          "event_conflict",
          "Event ID conflicts with a recorded event",
        );
      case "dependency_unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Event storage is unavailable",
        );
    }
  }
}
