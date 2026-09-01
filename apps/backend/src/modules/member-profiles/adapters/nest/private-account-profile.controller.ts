import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  CurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import type { MemberProfiles } from "../../facets/member-profiles/member-profiles.interface.js";
import { MEMBER_PROFILES } from "../../member-profiles.token.js";
import {
  memberProfileMutationBodySchema,
  memberProfileResponseSchema,
  privateProfileStateSchema,
  updateMemberProfileBodySchema,
} from "./member-profile-http.contract.js";
import {
  parseProfileBody,
  throwProfileHttpError,
} from "./member-profile-http.js";
import {
  ApiMemberProfileErrors,
  MemberProfileEndpoint,
} from "./member-profile-endpoint.js";

@MemberProfileEndpoint()
@ApiBearerAuth("logto")
@UseGuards(AccountGuard)
@Controller("account/profile")
export class PrivateAccountProfileController {
  constructor(
    @Inject(MEMBER_PROFILES) private readonly profiles: MemberProfiles,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "readPrivateAccountProfile",
    summary: "Read the current Account owner Profile state",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(privateProfileStateSchema) })
  @ApiMemberProfileErrors(401, 500, 503)
  async read(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.profiles.readPrivateProfile(accountId(account.accountId));
    if (!result.ok) throwProfileHttpError(result.error);
    return result.value;
  }

  @Post()
  @ApiOperation({
    operationId: "createMemberProfile",
    summary: "Create the current Account owner Profile",
  })
  @ApiBody({ schema: toOpenApiSchema(memberProfileMutationBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(memberProfileResponseSchema) })
  @ApiMemberProfileErrors(401, 409, 422, 500, 503)
  async create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseProfileBody(memberProfileMutationBodySchema, input);
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
    operationId: "updateMemberProfile",
    summary: "Update the current Account owner Profile",
  })
  @ApiBody({ schema: toOpenApiSchema(updateMemberProfileBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(memberProfileResponseSchema) })
  @ApiMemberProfileErrors(401, 404, 409, 422, 500, 503)
  async update(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseProfileBody(updateMemberProfileBodySchema, input);
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
