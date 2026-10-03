import {
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AcceptedTermsEndpoint,
  AccountEndpoint,
  ApiAccountErrors,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { TelegramAccountSignIn } from "./telegram-account-sign-in.js";

const responseSchema = z
  .object({ account: z.object({ accountId: z.uuid() }).strict() })
  .strict();

@AccountEndpoint()
@AcceptedTermsEndpoint()
@Controller("accounts/current/telegram-sign-in")
export class ResumeTelegramAccountSignInController {
  constructor(
    @Inject(TelegramAccountSignIn)
    private readonly signIn: TelegramAccountSignIn,
  ) {}

  @Post("resume")
  @HttpCode(200)
  @ApiOperation({
    operationId: "resumeTelegramAccountSignIn",
    summary:
      "Finalize an already verified Telegram sign-in receipt after terms acceptance",
  })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(responseSchema) })
  @ApiAccountErrors(401, 409, 503)
  async resume(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.signIn.resume(account);
    if (!result.ok)
      throw new HttpException(
        {
          code:
            result.error.code === "unavailable"
              ? "dependency_unavailable"
              : result.error.code,
        },
        result.error.code === "identity_conflict" ? 409 : 503,
      );
    return { account: { accountId: result.account.accountId } };
  }
}
