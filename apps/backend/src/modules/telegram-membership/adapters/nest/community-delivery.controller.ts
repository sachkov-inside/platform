import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
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
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { CommunityEntitlements } from "../../facets/community-entitlements/community-entitlements.js";
import { communityDeliveryViewSchema } from "../../facets/community-entitlements/community-delivery.contract.js";

const deliveryFailureStatus: Readonly<
  Record<"invalid_input" | "forbidden" | "unavailable", number>
> = Object.freeze({ forbidden: 403, invalid_input: 400, unavailable: 503 });

@ApiTags("Telegram Community")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("community-entitlements")
export class CommunityDeliveryController {
  constructor(
    @Inject(CommunityEntitlements)
    private readonly community: CommunityEntitlements,
  ) {}

  @Get(":accountId")
  @ApiOperation({
    operationId: "readCommunityEntitlementDelivery",
    summary:
      "Read the desired, accepted and applied community states of one Account",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(communityDeliveryViewSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(400, ["invalid_input"]),
      accountProblemSchema,
    ),
  })
  @ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(problemDetailsSchema(503, ["unavailable"])),
  })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("accountId") accountId: string,
  ) {
    const result = await this.community.readDelivery(
      current.accountId,
      accountId,
    );
    if (result.ok) return result.value;
    const status = deliveryFailureStatus[result.error.code];
    throw new HttpException(
      {
        code: result.error.code,
        status,
        title: "Community entitlement delivery is unavailable",
        type: `urn:inside:problem:community-entitlement:${result.error.code.replaceAll("_", "-")}`,
      },
      status,
    );
  }
}
