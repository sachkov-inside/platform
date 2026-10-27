import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
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
import { idSchema } from "../../domain/pricing.js";
import {
  ownerOrderEmailSchema,
  type OwnerOrderEmail,
} from "./read-order-email.contract.js";
import { OwnerOrderEmailRead } from "./read-order-email.js";

@ApiTags("Billing")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("billing/admin/payments")
export class ReadOwnerOrderEmailController {
  constructor(
    @Inject(OwnerOrderEmailRead)
    private readonly orderEmail: OwnerOrderEmailRead,
  ) {}

  @Get(":purchaseRef/order-email")
  @ApiOperation({
    operationId: "readOwnerOrderEmail",
    summary:
      "Read the immutable order email of one payment for the billing owner; never cached, listed, searched or exposed through MCP",
  })
  @ApiParam({ name: "purchaseRef", schema: toOpenApiSchema(idSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(ownerOrderEmailSchema) })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(accountProblemSchema),
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
    @Param("purchaseRef") purchaseRef: string,
  ): Promise<OwnerOrderEmail> {
    const result = await this.orderEmail.read(current.accountId, purchaseRef);
    if (result.ok) return { email: result.value.email };
    switch (result.error.code) {
      case "forbidden":
        throw problemException(
          403,
          "forbidden",
          "Billing permission is required",
        );
      case "not_found":
        throw problemException(404, "not_found", "Payment is not found");
      case "dependency_unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Order email is unavailable",
        );
    }
  }
}
