import { Body, Controller, HttpCode, Inject, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsOneOfContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { BillingOperations } from "../../facets/billing-operations/billing-operations.js";
import { ownerOperationSchema, ownerResponseSchema } from "../../domain/owner-operations.js";
import { throwOwnerError } from "./owner-http.filter.js";

@ApiTags("Billing")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 400, content: problemDetailsOneOfContent(problemDetailsSchema(400, ["invalid_request"]), accountProblemSchema) })
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])) })
@ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])) })
@ApiResponse({ status: 409, content: problemDetailsOneOfContent(problemDetailsSchema(409, ["operation_conflict", "revision_conflict",
  "payment_in_progress", "refund_in_progress", "state_conflict", "reservation_conflict", "preview_expired", "identity_changed"]), accountProblemSchema) })
@ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["unsupported_amount", "method_unavailable"])) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["provider_unavailable", "dependency_unavailable"]), accountProblemSchema) })
@Controller("billing/admin")
export class ManageBillingController {
  constructor(@Inject(BillingOperations) private readonly operations: BillingOperations) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "manageBilling",
    summary: "Manage offers, payments, refund decisions and manual access with the owner billing permission" })
  @ApiBody({ schema: toOpenApiSchema(ownerOperationSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(ownerResponseSchema) })
  async execute(@CurrentAccount() current: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.operations.execute(current.accountId, input);
    if (!result.ok) throwOwnerError(result.error.code);
    return { operationRef: result.operationRef, result: result.result };
  }
}
