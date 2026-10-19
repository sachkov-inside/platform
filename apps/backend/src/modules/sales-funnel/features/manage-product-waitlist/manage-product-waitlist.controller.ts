import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  HttpCode,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
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
import { ProductWaitlists } from "../../facets/product-waitlists/product-waitlists.js";
import {
  waitlistIntakeSchema,
  waitlistMembershipSchema,
  joinWaitlistSchema,
  withdrawWaitlistSchema,
} from "./manage-product-waitlist.contract.js";

@ApiTags("Product waitlists")
@PrivateNoStore()
@UseFilters(AccountProblemDetailsFilter)
@Controller("product-waitlists")
export class ProductWaitlistController {
  constructor(
    @Inject(ProductWaitlists) private readonly waitlists: ProductWaitlists,
  ) {}
  @Get(":productId/intake")
  @ApiOperation({
    operationId: "readProductWaitlistIntake",
    summary:
      "Read the current intake identity without private membership or counts",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(waitlistIntakeSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["intake_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async intake(@Param("productId") productId: string) {
    return unwrap(await this.waitlists.readIntake(productId));
  }
  @Get(":productId/membership")
  @UseGuards(AccountGuard)
  @ApiBearerAuth("logto")
  @ApiOperation({
    operationId: "readProductWaitlistMembership",
    summary: "Read only the current Account's waitlist membership",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(waitlistMembershipSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["intake_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("productId") productId: string,
  ) {
    return unwrap(await this.waitlists.read(current.accountId, productId));
  }
  @Post("join")
  @HttpCode(200)
  @UseGuards(AccountGuard)
  @ApiBearerAuth("logto")
  @ApiOperation({
    operationId: "joinProductWaitlist",
    summary: "Complete an explicit waitlist action for the current Account",
  })
  @ApiBody({ schema: toOpenApiSchema(joinWaitlistSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(waitlistMembershipSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, ["telegram_required"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["intake_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async join(
    @CurrentAccount() current: AuthenticatedAccount,
    @Body() body: unknown,
  ) {
    return unwrap(await this.waitlists.join(current.accountId, body));
  }
  @Post("withdraw")
  @HttpCode(200)
  @UseGuards(AccountGuard)
  @ApiBearerAuth("logto")
  @ApiOperation({
    operationId: "withdrawProductWaitlist",
    summary:
      "Withdraw the current Account without changing access or marketing preference",
  })
  @ApiBody({ schema: toOpenApiSchema(withdrawWaitlistSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(waitlistMembershipSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["intake_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async withdraw(
    @CurrentAccount() current: AuthenticatedAccount,
    @Body() body: unknown,
  ) {
    return unwrap(await this.waitlists.withdraw(current.accountId, body));
  }
}
function unwrap<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: {
          readonly code:
            | "invalid_request"
            | "intake_not_found"
            | "telegram_required"
            | "dependency_unavailable";
        };
      },
): T {
  if (result.ok) return result.value;
  switch (result.error.code) {
    case "invalid_request":
      throw problemException(
        400,
        "invalid_request",
        "Invalid waitlist request",
      );
    case "intake_not_found":
      throw problemException(404, "intake_not_found", "No accepting intake");
    case "telegram_required":
      throw problemException(
        409,
        "telegram_required",
        "Link Telegram to the current Account first",
      );
    case "dependency_unavailable":
      throw problemException(
        503,
        "dependency_unavailable",
        "Waitlist unavailable",
      );
  }
}
