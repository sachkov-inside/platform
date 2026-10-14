import { Controller, Get, Inject, UseFilters, Query } from "@nestjs/common";
import {
  ApiTags,
  ApiQuery,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
  problemDetailsSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AcceptedTermsEndpoint,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { CommunityEntitlements } from "../../facets/community-entitlements/community-entitlements.js";
import { ownCommunityEntrySchema } from "../../domain/community-entitlement.js";
@ApiTags("Telegram community")
@ApiBearerAuth("logto")
@PrivateNoStore()
@AcceptedTermsEndpoint()
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({
  status: 401,
  content: problemDetailsContent(accountProblemSchema),
})
@ApiResponse({
  status: 503,
  content: problemDetailsContent(
    problemDetailsSchema(503, ["dependency_unavailable"]),
  ),
})
@Controller("accounts/current/community-entry")
export class OwnCommunityEntryController {
  constructor(
    @Inject(CommunityEntitlements)
    private readonly community: CommunityEntitlements,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "currentCommunityEntry",
    summary: "Read which community entry to offer the current Account",
  })
  @ApiQuery({
    name: "productId",
    required: false,
    schema: { type: "string", format: "uuid" },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(ownCommunityEntrySchema) })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Query("productId") productId?: string,
  ) {
    if (productId === undefined)
      return this.community.readOwnCommunityEntry(current.accountId);
    const result = await this.community.readOwnProductCommunityEntry(
      current.accountId,
      productId,
    );
    if (result.kind === "unavailable")
      throw problemException(
        503,
        "dependency_unavailable",
        "Product community is unavailable",
      );
    return result;
  }
}
