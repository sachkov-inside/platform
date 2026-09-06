import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  LOGTO_ACCESS_TOKEN_VERIFIER,
  AccountProblemDetailsFilter,
  type LogtoAccessTokenVerifier,
} from "../../../accounts/index.js";
import {
  bearerCredential,
  credentialsMatch,
  telegramMembershipProblemSchema,
} from "../../adapters/nest/telegram-membership-http.js";
import { TelegramAccountSignIn } from "./telegram-account-sign-in.js";
const accountSchema = z.object({ account: z.object({ accountId: z.uuid() }) });
const linkSchema = z
  .object({
    accountRef: z.uuid(),
    telegramIdentityRef: z.uuid(),
    subjectRef: z.uuid(),
  })
  .strict();
const identitySchema = z
  .object({ issuer: z.string(), subject: z.string() })
  .strict();

@UseFilters(AccountProblemDetailsFilter)
@ApiTags("Telegram sign-in")
@PrivateNoStore()
@Controller("integrations/telegram/v1/sign-in")
export class TelegramAccountSignInController {
  constructor(
    @Inject(TelegramAccountSignIn)
    private readonly signIn: TelegramAccountSignIn,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: LogtoAccessTokenVerifier,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}
  @ApiBearerAuth("logto")
  @Post("complete")
  @HttpCode(200)
  @ApiOperation({
    operationId: "completeTelegramAccountSignIn",
    summary: "Establish the Account and finalize the confirmed Telegram link",
  })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(accountSchema) })
  @ApiResponse({
    status: 401,
    schema: toOpenApiSchema(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 409,
    schema: toOpenApiSchema(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 503,
    schema: toOpenApiSchema(telegramMembershipProblemSchema),
  })
  async complete(@Headers("authorization") authorization: string | undefined) {
    const proof = await this.verifier.verifyAccountSignIn(
      bearerCredential(authorization),
    );
    if (!proof.ok)
      throw new HttpException(
        { code: proof.error.code },
        proof.error.code === "dependency_unavailable" ? 503 : 401,
      );
    if (proof.identity.telegram === undefined)
      throw new HttpException({ code: "invalid_proof" }, 401);
    const result = await this.signIn.complete(proof.identity);
    if (!result.ok)
      throw new HttpException(
        { code: result.error.code },
        result.error.code === "identity_conflict" ? 409 : 503,
      );
    return { account: result.account };
  }
  @Post("linked-identity")
  @HttpCode(200)
  @ApiBearerAuth("telegram-membership")
  @ApiOperation({
    operationId: "resolveTelegramLinkedIdentity",
    summary: "Resolve an existing link for the trusted Logto connector",
  })
  @ApiBody({ schema: toOpenApiSchema(linkSchema) })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(identitySchema) })
  @ApiResponse({
    status: 400,
    schema: toOpenApiSchema(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 401,
    schema: toOpenApiSchema(telegramMembershipProblemSchema),
  })
  @ApiResponse({
    status: 409,
    schema: toOpenApiSchema(telegramMembershipProblemSchema),
  })
  async resolve(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = this.config.identity.telegramSignInIntegrationSecret;
    if (
      !this.config.identity.telegramSignInEnabled ||
      !secret ||
      !credentialsMatch(bearerCredential(authorization) ?? "", secret)
    )
      throw new HttpException({ code: "invalid_proof" }, 401);
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ code: "invalid_input" }, 400);
    const identity = await this.signIn.resolveLink(
      parsed.data.accountRef,
      parsed.data.telegramIdentityRef,
      parsed.data.subjectRef,
    );
    if (!identity) throw new HttpException({ code: "identity_conflict" }, 409);
    return identity;
  }
}
