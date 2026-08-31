import {
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
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
  telegramLinkStateSchema,
  telegramMembershipProblemSchema,
  throwTelegramLinkError,
} from "./telegram-membership-http.js";

@ApiTags("Telegram Membership")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@Controller("accounts/current/telegram-link")
export class TelegramLinkController {
  constructor(
    @Inject(TELEGRAM_MEMBERSHIP)
    private readonly membership: TelegramMembership,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "beginTelegramMembershipLink",
    summary: "Begin a Telegram Membership link for the current Account",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(telegramLinkStateSchema) })
  @ApiResponse({
    status: 401,
    description: "Account proof is missing or invalid",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 503,
    description: "Identity verification is unavailable",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  async begin(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.membership.beginLink({
      accountId: accountId(account.accountId),
    });
    if (!result.ok) {
      throwTelegramLinkError(result);
    }
    return result.state;
  }

  @Post(":linkRef/confirm")
  @HttpCode(200)
  @ApiOperation({
    operationId: "confirmTelegramMembershipLink",
    summary: "Confirm the Telegram receipt for the original Account",
  })
  @ApiParam({ name: "linkRef", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(telegramLinkStateSchema) })
  @ApiResponse({
    status: 400,
    description: "The link reference is invalid",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 401,
    description: "Account proof is missing or invalid",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 404,
    description: "No link belongs to this Account",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 503,
    description: "Identity verification is unavailable",
    content: problemDetailsContent(telegramMembershipProblemSchema),
  })
  async confirm(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("linkRef") linkRef: string,
  ) {
    const result = await this.membership.confirmLink({
      accountId: accountId(account.accountId),
      linkRef,
    });
    if (!result.ok) {
      throwTelegramLinkError(result);
    }
    return result.state;
  }
}
