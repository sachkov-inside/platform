import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  OptionalAccountGuard,
  OptionalCurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import type { MemberProfiles } from "../../facets/member-profiles/member-profiles.interface.js";
import { MEMBER_PROFILES } from "../../member-profiles.token.js";
import { memberProfileProjectionResponseSchema } from "./member-profile-http.contract.js";
import {
  throwMemberProfileNotFound,
  throwProfileHttpError,
} from "./member-profile-http.js";
import {
  ApiMemberProfileErrors,
  MemberProfileEndpoint,
} from "./member-profile-endpoint.js";

const publicProfileIdSchema = z.uuid();

@MemberProfileEndpoint()
@ApiBearerAuth("logto")
@UseGuards(OptionalAccountGuard)
@Controller("member-profiles")
export class MemberProfileController {
  constructor(
    @Inject(MEMBER_PROFILES) private readonly profiles: MemberProfiles,
  ) {}

  @Get(":publicProfileId")
  @Header("X-Robots-Tag", "noindex, nofollow")
  @ApiOperation({
    operationId: "viewMemberProfile",
    summary: "View the accepted Profile projection as an active member",
  })
  @ApiParam({
    name: "publicProfileId",
    schema: toOpenApiSchema(publicProfileIdSchema),
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(memberProfileProjectionResponseSchema),
  })
  @ApiMemberProfileErrors(401, 404, 500, 503)
  async view(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("publicProfileId") publicProfileId: string,
  ) {
    if (account === undefined) throwMemberProfileNotFound();
    const result = await this.profiles.viewProfile(
      accountId(account.accountId),
      publicProfileId,
    );
    if (!result.ok) {
      if (result.error.code === "not_found") throwMemberProfileNotFound();
      throwProfileHttpError(result.error);
    }
    return { profile: result.profile };
  }

}
