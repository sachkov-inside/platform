import { Body, Controller, HttpCode, Inject, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsOneOfContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { manageCatalogSchema, catalogOutcomeSchema } from "./manage-catalog.contract.js";
@ApiTags("Billing")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 400, content: problemDetailsOneOfContent(problemDetailsSchema(400, ["invalid_request"]), accountProblemSchema) })
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])) })
@ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])) })
@ApiResponse({ status: 409, content: problemDetailsOneOfContent(problemDetailsSchema(409, ["operation_conflict", "revision_conflict", "quote_changed", "quote_expired", "reservation_conflict"]), accountProblemSchema) })
@ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["unsupported_amount"])) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["dependency_unavailable"]), accountProblemSchema) })
@Controller("billing/admin")
export class ManageCatalogController {
  constructor(@Inject(BillingPricing) private readonly pricing: BillingPricing) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "manageBilling", summary: "Manage offers, options and promotions" })
  @ApiBody({ schema: toOpenApiSchema(manageCatalogSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(catalogOutcomeSchema) })
  async execute(@CurrentAccount() current: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.pricing.manage(current.accountId, input);
    if (!result.ok) throwPricingError(result.error);
    return result.value;
  }
}
