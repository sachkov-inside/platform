import { Body, Controller, HttpCode, Inject, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsOneOfContent, problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { subscriptionViewSchema } from "../../domain/subscription-change.js";
import { BillingSubscriptions } from "../../facets/billing-subscriptions/billing-subscriptions.js";
import { changeMethodSchema, methodFlowSchema, revokeMethodSchema } from "../manage-subscription/manage-subscription.contract.js";
import { throwPaymentError } from "../../shared/payment-http.filter.js";

@ApiTags("Billing")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 400, content: problemDetailsOneOfContent(problemDetailsSchema(400, ["invalid_request"]), accountProblemSchema) })
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])) })
@ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])) })
@ApiResponse({ status: 409, content: problemDetailsOneOfContent(problemDetailsSchema(409, ["operation_conflict", "revision_conflict"]), accountProblemSchema) })
@ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["method_unavailable"])) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["provider_unavailable", "dependency_unavailable"]), accountProblemSchema) })
@Controller("accounts/current/billing/payment-method")
export class ChangePaymentMethodController {
  constructor(@Inject(BillingSubscriptions) private readonly subscriptions: BillingSubscriptions) {}

  @Post("change")
  @HttpCode(200)
  @ApiOperation({ operationId: "changeBillingMethod", summary: "Start a proven bank binding session for a new payment method" })
  @ApiBody({ schema: toOpenApiSchema(changeMethodSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(methodFlowSchema) })
  async change(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.changeMethod(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }

  @Post("revoke")
  @HttpCode(200)
  @ApiOperation({ operationId: "revokeBillingMethod", summary: "Forbid further use of the saved payment method" })
  @ApiBody({ schema: toOpenApiSchema(revokeMethodSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(subscriptionViewSchema) })
  async revoke(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.revokeMethod(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }
}
