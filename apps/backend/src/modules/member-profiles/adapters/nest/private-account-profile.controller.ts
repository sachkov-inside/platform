import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

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
  deleteMemberProfileBodySchema,
  memberProfileMutationBodySchema,
  memberProfileResponseSchema,
  privateProfileStateSchema,
  profileDeleteResponseSchema,
  profileExportSchema,
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

  @Delete()
  @ApiOperation({
    operationId: "deleteMemberProfile",
    summary: "Delete the current Account owner Profile",
  })
  @ApiBody({ schema: toOpenApiSchema(deleteMemberProfileBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(profileDeleteResponseSchema) })
  @ApiMemberProfileErrors(401, 404, 409, 500, 503)
  async delete(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseProfileBody(deleteMemberProfileBodySchema, input);
    const result = await this.profiles.deleteProfile({
      accountId: accountId(account.accountId),
      expectedVersion: body.expectedVersion,
    });
    if (!result.ok) throwProfileHttpError(result.error);
    return result.value;
  }

  @Get("export")
  @ApiOperation({
    operationId: "exportMemberProfile",
    summary: "Export only the current Account owner-authored Profile fields",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(profileExportSchema) })
  @ApiMemberProfileErrors(401, 404, 500, 503)
  async export(
    @CurrentAccount() account: AuthenticatedAccount,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.profiles.readPrivateProfile(accountId(account.accountId));
    if (!result.ok) throwProfileHttpError(result.error);
    if (result.value.kind === "missing") {
      throwProfileHttpError({ code: "profile_not_found" });
    }
    response.header(
      "Content-Disposition",
      'attachment; filename="member-profile.json"',
    );
    return {
      schemaVersion: "member-profile-export.v1",
      profile: {
        displayName: result.value.profile.displayName,
        bio: result.value.profile.bio,
      },
    };
  }
}
