import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  CurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import type { TelegramMembership } from "../../index.js";
import { TELEGRAM_MEMBERSHIP } from "../../telegram-membership.tokens.js";
import {
  accountTelegramMembershipPresentationSchema,
  telegramMembershipProblemSchema,
  throwTelegramAccountPresentationError,
} from "./telegram-membership-http.js";

@ApiTags("Telegram Membership")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@Controller("accounts/current/telegram-membership")
export class AccountTelegramMembershipController {
  constructor(
    @Inject(TELEGRAM_MEMBERSHIP)
    private readonly membership: TelegramMembership,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "readCurrentAccountTelegramMembership",
    summary: "Read Telegram linking and Membership states for the current Account",
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(accountTelegramMembershipPresentationSchema),
  })
  @ApiResponse({
    status: 401,
    description: "Account proof is missing or invalid",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 503,
    description: "Account Membership presentation is unavailable",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  async read(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.membership.readAccountPresentation({
      accountId: accountId(account.accountId),
    });
    if (!result.ok) throwTelegramAccountPresentationError();
    return result.presentation;
  }
}
