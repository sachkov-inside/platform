import { activationResponseSchema, ownSubscriptionAccessResponseSchema } from "../../domain/subscription-activation-wire.js";
import { Body, Controller, Headers, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { bearerCredential, credentialsMatch } from "../../../../infrastructure/http/bearer-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { ownSubscriptionAccessQuerySchema, beginActivationSchema, activationEvidenceSchema } from "../../../membership-entitlements/index.js";
import { SubscriptionActivation } from "../../../billing/index.js";
@ApiTags("Subscription activation integration")
@ApiBearerAuth("subscription-activation")
@PrivateNoStore()
@ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ["unauthorized"])) })
@Controller("integrations/telegram/v1/subscription-activation")
export class SubscriptionActivationController {
  constructor(@Inject(SubscriptionActivation) private readonly activation: SubscriptionActivation,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig) {}
  private authenticate(authorization: string | undefined) {
    const expected = this.config.telegramMembership.activationIngressSecret;
    if (expected === undefined || !credentialsMatch(bearerCredential(authorization), expected))
      throw new HttpException({ type: "about:blank", title: "Activation authority required", status: 401, code: "unauthorized" }, 401);
  }
  @Post("own-access")
  @HttpCode(200)
  @ApiOperation({ operationId: "readOwnSubscriptionAccess", summary: "Read every independent access ground for the exact authenticated Telegram binding" })
  @ApiBody({ schema: toOpenApiSchema(ownSubscriptionAccessQuerySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(ownSubscriptionAccessResponseSchema) })
  async own(@Headers("authorization") authorization: string | undefined, @Body() input: unknown) {
    this.authenticate(authorization);
    return this.activation.readOwn(input);
  }
  @Post("attempts")
  @HttpCode(200)
  @ApiOperation({ operationId: "beginSubscriptionActivation", summary: "Persist an activation attempt for a verified private bot identity" })
  @ApiBody({ schema: toOpenApiSchema(beginActivationSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(activationResponseSchema) })
  async begin(@Headers("authorization") authorization: string | undefined, @Body() input: unknown) {
    this.authenticate(authorization);
    return this.activation.begin(input);
  }
  @Post("evidence")
  @HttpCode(200)
  @ApiOperation({ operationId: "acceptSubscriptionActivationEvidence", summary: "Apply bounded source proof to the exact current Account binding and rule revision" })
  @ApiBody({ schema: toOpenApiSchema(activationEvidenceSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(activationResponseSchema) })
  async accept(@Headers("authorization") authorization: string | undefined, @Body() input: unknown) {
    this.authenticate(authorization);
    return this.activation.accept(input);
  }
}
