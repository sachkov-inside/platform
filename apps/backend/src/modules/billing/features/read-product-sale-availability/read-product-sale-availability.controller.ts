import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsOneOfContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { accountProblemSchema, OptionalAccountEndpoint, OptionalCurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { productSaleAvailabilityQuerySchema, productSaleAvailabilitySchema } from "./read-product-sale-availability.js";

@ApiTags("Billing")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("billing/products/sale-availability")
export class ReadProductSaleAvailabilityController {
  constructor(@Inject(BillingPricing) private readonly pricing: BillingPricing) {}

  @Get()
  @ApiOperation({ operationId: "billingProductSaleAvailability", summary: "Read sale admission for a bounded set of Products without programme, cohort or price presentation" })
  @ApiQuery({ name: "productId", required: true, schema: toOpenApiSchema(productSaleAvailabilityQuerySchema.shape.productIds) })
  @ApiOkResponse({ schema: toOpenApiSchema(productSaleAvailabilitySchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["dependency_unavailable"]), accountProblemSchema) })
  async execute(@OptionalCurrentAccount() account: AuthenticatedAccount | undefined, @Query("productId") productIds: unknown) {
    const result = await this.pricing.saleAvailability({ productIds: Array.isArray(productIds) ? productIds : [productIds] }, account?.accountId);
    if (!result.ok) throwPricingError(result.error);
    return result.value;
  }
}
