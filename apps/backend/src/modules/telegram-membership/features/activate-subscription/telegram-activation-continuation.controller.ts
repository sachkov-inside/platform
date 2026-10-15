import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AcceptedTermsEndpoint,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { SubscriptionActivation } from "../../../billing/index.js";

const continuationSchema = z.union([
  z.strictObject({
    state: z.enum(["expired", "identity_conflict", "unavailable"]),
  }),
  z.strictObject({
    state: z.enum(["link_required", "pending", "active"]),
    product: z.strictObject({
      id: z.uuid(),
      slug: z.string(),
      name: z.string(),
    }),
  }),
]);

@ApiTags("Telegram Membership")
@ApiBearerAuth("logto")
@PrivateNoStore()
@AcceptedTermsEndpoint()
@Controller("accounts/current/telegram-activation")
export class TelegramActivationContinuationController {
  constructor(
    @Inject(SubscriptionActivation)
    private readonly activation: SubscriptionActivation,
  ) {}

  @Get(":attemptId")
  @ApiParam({ name: "attemptId", type: "string", format: "uuid" })
  @ApiOperation({
    operationId: "readTelegramActivationContinuation",
    summary: "Continue a selected activation for the current Account binding",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(continuationSchema) })
  async read(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("attemptId") attemptId: string,
  ) {
    return this.activation.readContinuation(account.accountId, attemptId);
  }
}
