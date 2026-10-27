import { Body, Controller, Get, Inject, Post, Put } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AcceptedTermsEndpoint,
  CurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import type { AccountProfiles } from "../../facets/account-profiles/account-profiles.interface.js";
import { ACCOUNT_PROFILES } from "../../account-profiles.token.js";
import {
  accountProfileMutationBodySchema,
  accountProfileResponseSchema,
  privateProfileStateSchema,
  updateAccountProfileBodySchema,
} from "./account-profile-http.contract.js";
import {
  parseProfileBody,
  throwProfileHttpError,
} from "./account-profile-http.js";
import {
  ApiAccountProfileErrors,
  AccountProfileEndpoint,
} from "./account-profile-endpoint.js";

@AccountProfileEndpoint()
@ApiBearerAuth("logto")
@AcceptedTermsEndpoint()
@Controller("account/profile")
export class PrivateAccountProfileController {
  constructor(
    @Inject(ACCOUNT_PROFILES) private readonly profiles: AccountProfiles,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "readPrivateAccountProfile",
    summary: "Read the current Account owner Profile state",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(privateProfileStateSchema) })
  @ApiAccountProfileErrors(401, 500, 503)
  async read(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.profiles.readPrivateProfile(
      accountId(account.accountId),
    );
    if (!result.ok) throwProfileHttpError(result.error);
    return result.value;
  }

  @Post()
  @ApiOperation({
    operationId: "createAccountProfile",
    summary: "Create the current Account owner Profile",
  })
  @ApiBody({ schema: toOpenApiSchema(accountProfileMutationBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(accountProfileResponseSchema) })
  @ApiAccountProfileErrors(401, 409, 422, 500, 503)
  async create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseProfileBody(accountProfileMutationBodySchema, input);
    const result = await this.profiles.createProfile({
      accountId: accountId(account.accountId),
      displayName: body.displayName,
      bio: body.bio ?? null,
    });
    if (!result.ok) throwProfileHttpError(result.error);
    return { profile: result.value };
  }

  @Put()
  @ApiOperation({
    operationId: "updateAccountProfile",
    summary: "Update the current Account owner Profile",
  })
  @ApiBody({ schema: toOpenApiSchema(updateAccountProfileBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(accountProfileResponseSchema) })
  @ApiAccountProfileErrors(401, 404, 409, 422, 500, 503)
  async update(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseProfileBody(updateAccountProfileBodySchema, input);
    const result = await this.profiles.updateProfile({
      accountId: accountId(account.accountId),
      displayName: body.displayName,
      bio: body.bio ?? null,
      expectedVersion: body.expectedVersion,
    });
    if (!result.ok) throwProfileHttpError(result.error);
    return { profile: result.value };
  }
}
