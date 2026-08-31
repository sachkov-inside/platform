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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import type { TelegramMembership } from "../../index.js";
import { TELEGRAM_MEMBERSHIP } from "../../telegram-membership.tokens.js";
import {
  bearerCredential,
  credentialsMatch,
  evidenceAcceptanceSchema,
  evidenceDeliveryIdSchema,
  evidenceSourceSchema,
  throwEvidenceAuthenticationRequired,
  throwEvidenceError,
  throwInvalidEvidenceRequest,
} from "./telegram-membership-http.js";

@ApiTags("Telegram Membership integration")
@ApiBearerAuth("telegram-membership")
@Controller("integrations/telegram/v1/membership-evidence")
export class TelegramEvidenceController {
  constructor(
    @Inject(TELEGRAM_MEMBERSHIP)
    private readonly membership: TelegramMembership,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "acceptTelegramMembershipEvidence",
    summary: "Accept one authenticated normalized Membership Evidence envelope",
  })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(evidenceDeliveryIdSchema),
  })
  @ApiHeader({
    name: "x-inside-membership-evidence-source",
    required: true,
    schema: toOpenApiSchema(evidenceSourceSchema),
  })
  @ApiBody({
    schema: {
      type: "object",
      description:
        "Strict inside.membership-evidence.v1 envelope from the vendored contract",
    },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(evidenceAcceptanceSchema) })
  @ApiResponse({ status: 400, description: "Envelope or contract version is invalid" })
  @ApiResponse({ status: 401, description: "Integration credential is invalid" })
  @ApiResponse({ status: 409, description: "Principal or evidence revision conflicts" })
  @ApiResponse({ status: 422, description: "Evidence is expired" })
  @ApiResponse({ status: 503, description: "Evidence application is unavailable" })
  async accept(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") deliveryId: string | undefined,
    @Headers("x-inside-membership-evidence-source") source: string | undefined,
    @Body() evidence: unknown,
  ) {
    if (
      !credentialsMatch(
        bearerCredential(authorization),
        this.config.telegramMembership.evidenceIngressSecret,
      )
    ) {
      throwEvidenceAuthenticationRequired();
    }
    const parsedDeliveryId = evidenceDeliveryIdSchema.safeParse(deliveryId);
    const parsedSource = evidenceSourceSchema.safeParse(source);
    if (!parsedDeliveryId.success || !parsedSource.success) {
      throwInvalidEvidenceRequest();
    }
    const result = await this.membership.acceptEvidence({
      deliveryId: parsedDeliveryId.data,
      evidence,
      source: parsedSource.data,
    });
    if (!result.ok) {
      throwEvidenceError(result);
    }
    return result;
  }
}
