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
import { SubscriptionActivation } from "../../../billing/index.js";
import { redeemInvitationSchema } from "../../../membership-entitlements/index.js";
import { invitationRedeemResponseSchema } from "../../domain/subscription-activation-wire.js";

/**
 * Погашение личного приглашения ботом: операция контракта активации с тем же полномочием
 * `TELEGRAM_ACTIVATION_INGRESS_SECRET`.
 */
@ApiTags("Subscription activation integration")
@ApiBearerAuth("subscription-activation")
@PrivateNoStore()
@ApiResponse({
  status: 401,
  content: problemDetailsContent(problemDetailsSchema(401, ["unauthorized"])),
})
@Controller("integrations/telegram/v1/invitations")
export class InvitationRedemptionController {
  constructor(
    @Inject(SubscriptionActivation)
    private readonly activation: SubscriptionActivation,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}
  @Post("redeem")
  @HttpCode(200)
  @ApiOperation({
    operationId: "redeemTelegramInvitation",
    summary:
      "Claim a personal invitation for a verified Telegram identity and admit or gift its Offer",
  })
  @ApiBody({ schema: toOpenApiSchema(redeemInvitationSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(invitationRedeemResponseSchema) })
  async redeem(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ) {
    const expected = this.config.telegramMembership.activationIngressSecret;
    if (
      expected === undefined ||
      !credentialsMatch(bearerCredential(authorization), expected)
    )
      throw problemException(
        401,
        "unauthorized",
        "Activation authority required",
      );
    return this.activation.redeemInvitation(input);
  }
}
