import { Controller, Get, Inject, Query } from "@nestjs/common";
import {
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiResponse,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  toOpenApiSchema,
  problemDetailsContent,
  problemDetailsSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import {
  productSalesStatesQuerySchema,
  productSalesStatesSchema,
} from "./list-product-sales-states.js";

@ApiTags("Billing")
@PrivateNoStore()
@Controller("billing/product-sales-states")
export class ListProductSalesStatesController {
  constructor(
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "billingProductSalesStates",
    security: [],
    summary:
      "Read mutable Product sales presentation, independent of Intake and price admission",
  })
  @ApiQuery({
    name: "productId",
    required: false,
    schema: toOpenApiSchema(productSalesStatesQuerySchema.shape.productId),
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: toOpenApiSchema(productSalesStatesQuerySchema.shape.cursor),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productSalesStatesSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async execute(@Query() input: unknown) {
    const parsed = productSalesStatesQuerySchema.safeParse(input);
    if (!parsed.success) throwPricingError({ code: "invalid_request" });
    const result = await this.pricing.productSalesStates(
      parsed.data.productId,
      parsed.data.cursor,
    );
    if (!result.ok) throwPricingError(result.error);
    return result.value;
  }
}
