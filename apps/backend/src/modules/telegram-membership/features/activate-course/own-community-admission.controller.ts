import { Controller, Get, Inject, UseFilters } from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AcceptedTermsEndpoint,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { CommunityEntitlements } from "../../facets/community-entitlements/community-entitlements.js";
import { ownAdmissionSchema } from "../../domain/community-entitlement.js";
@ApiTags("Telegram community")
@ApiBearerAuth("logto")
@PrivateNoStore()
@AcceptedTermsEndpoint()
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({
  status: 401,
  content: problemDetailsContent(accountProblemSchema),
})
@Controller("accounts/current/community-admission")
export class OwnCommunityAdmissionController {
  constructor(
    @Inject(CommunityEntitlements)
    private readonly community: CommunityEntitlements,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "currentCommunityAdmission",
    summary:
      "Read own current community restriction independently of content access",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(ownAdmissionSchema) })
  read(@CurrentAccount() current: AuthenticatedAccount) {
    return this.community.readOwnAdmission(current.accountId);
  }
}
