import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { listOffersSchema, offersPageSchema } from "./list-offers.js";

@ApiTags("Billing")
@PrivateNoStore()
@Controller("billing/offers")
export class ListOffersController {
  constructor(@Inject(BillingPricing) private readonly pricing: BillingPricing) {}
  @Get()
  @ApiOperation({ operationId: "billingOffers", summary: "Read active options and public first-payment prices" })
  @ApiQuery({ name: "cursor", required: false, schema: toOpenApiSchema(listOffersSchema.shape.cursor) })
  @ApiQuery({ name: "limit", required: false, schema: toOpenApiSchema(listOffersSchema.shape.limit) })
  @ApiOkResponse({ schema: toOpenApiSchema(offersPageSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async execute(@Query() input: unknown) {
    const result = await this.pricing.offers(input);
    if (!result.ok) throwPricingError(result.error);
    return result.value;
  }
}
