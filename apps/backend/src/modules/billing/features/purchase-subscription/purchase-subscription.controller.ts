import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsOneOfContent, problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { BillingPayments } from "../../facets/billing-payments/billing-payments.js";
import { purchaseSubscriptionSchema, purchaseStatusSchema } from "./purchase-subscription.contract.js";

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
@ApiResponse({ status: 409, content: problemDetailsOneOfContent(problemDetailsSchema(409, ["operation_conflict", "payment_in_progress", "contact_required", "consent_required", "existing_access", "legacy_review_required", "quote_expired", "quote_changed"]), accountProblemSchema) })
@ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["unsupported_amount", "method_unavailable"])) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["provider_unavailable", "dependency_unavailable"]), accountProblemSchema) })
@Controller("accounts/current/billing")
export class PurchaseSubscriptionController {
  constructor(@Inject(BillingPayments) private readonly payments: BillingPayments) {}
  @Post("purchase")
  @HttpCode(200)
  @ApiOperation({ operationId: "purchaseBillingSubscription", summary: "Start or recover one subscription purchase" })
  @ApiBody({ schema: toOpenApiSchema(purchaseSubscriptionSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(purchaseStatusSchema) })
  async purchase(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.payments.purchase(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }
  @Get("purchases/:purchaseRef")
  @ApiOperation({ operationId: "readBillingPurchase", summary: "Read authoritative own payment and access status" })
  @ApiParam({ name: "purchaseRef", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(purchaseStatusSchema) })
  async read(@CurrentAccount() account: AuthenticatedAccount, @Param("purchaseRef") purchaseRef: string) {
    const result = await this.payments.status(account.accountId, purchaseRef);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }
}
