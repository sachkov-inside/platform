import { Body, Controller, Get, HttpCode, Inject, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsOneOfContent, problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { subscriptionViewSchema } from "../../domain/subscription-change.js";
import { BillingSubscriptions } from "../../facets/billing-subscriptions/billing-subscriptions.js";
import { throwPaymentError } from "../../shared/payment-http.filter.js";
import { cancelChangeSchema, cancelRenewalSchema, changeOptionSchema, changeQuoteResultSchema, changeResultSchema, currentBillingSchema, quoteChangeSchema, resumeRenewalSchema } from "./manage-subscription.contract.js";

@ApiTags("Billing")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 400, content: problemDetailsOneOfContent(problemDetailsSchema(400, ["invalid_request"]), accountProblemSchema) })
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])) })
@ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])) })
@ApiResponse({ status: 409, content: problemDetailsOneOfContent(problemDetailsSchema(409, ["operation_conflict", "revision_conflict", "payment_in_progress", "contact_required", "consent_required", "quote_expired", "quote_changed"]), accountProblemSchema) })
@ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["unsupported_amount", "method_unavailable"])) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["provider_unavailable", "dependency_unavailable"]), accountProblemSchema) })
@Controller("accounts/current/billing")
export class ManageSubscriptionController {
  constructor(@Inject(BillingSubscriptions) private readonly subscriptions: BillingSubscriptions) {}

  @Get()
  @ApiOperation({ operationId: "currentBilling", summary: "Read own subscription, its paid term and pending changes" })
  @ApiOkResponse({ schema: toOpenApiSchema(currentBillingSchema) })
  async read(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.subscriptions.read(account.accountId);
    if (!result.ok) throwPaymentError(result.error.code);
    return { subscription: result.value };
  }

  @Post("subscription/cancel")
  @HttpCode(200)
  @ApiOperation({ operationId: "cancelBillingRenewal", summary: "Stop future charges and keep the paid term" })
  @ApiBody({ schema: toOpenApiSchema(cancelRenewalSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(subscriptionViewSchema) })
  async cancel(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.cancel(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }

  @Post("subscription/resume")
  @HttpCode(200)
  @ApiOperation({ operationId: "resumeBillingRenewal", summary: "Resume renewal inside the active paid term on its original conditions" })
  @ApiBody({ schema: toOpenApiSchema(resumeRenewalSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(subscriptionViewSchema) })
  async resume(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.resume(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }

  @Post("subscription/change/quote")
  @HttpCode(200)
  @ApiOperation({ operationId: "quoteBillingChange", summary: "Calculate an upgrade top-up or the next period conditions" })
  @ApiBody({ schema: toOpenApiSchema(quoteChangeSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(changeQuoteResultSchema) })
  async quoteChange(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.quoteChange(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }

  @Post("subscription/change")
  @HttpCode(200)
  @ApiOperation({ operationId: "changeBillingOption", summary: "Accept a calculated option change" })
  @ApiBody({ schema: toOpenApiSchema(changeOptionSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(changeResultSchema) })
  async change(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.change(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }

  @Post("subscription/change/cancel")
  @HttpCode(200)
  @ApiOperation({ operationId: "cancelBillingChange", summary: "Drop a scheduled option change before its attempt is sent" })
  @ApiBody({ schema: toOpenApiSchema(cancelChangeSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(subscriptionViewSchema) })
  async cancelChange(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.subscriptions.cancelChange(account.accountId, input);
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }
}
