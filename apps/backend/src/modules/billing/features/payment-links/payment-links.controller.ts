import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { OptionalAccountEndpoint } from "../../../accounts/index.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { idSchema } from "../../domain/pricing.js";
import { paymentLinkDetailSchema } from "./payment-links.contract.js";

@ApiTags("Billing")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("billing/payment-links")
export class PaymentLinksController {
  constructor(
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
  ) {}
  @Get(":id")
  @ApiOperation({
    operationId: "readBillingPaymentLink",
    summary:
      "Read one private payment link without revealing buyer identity or changing public sales",
  })
  @ApiParam({ name: "id", schema: toOpenApiSchema(idSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(paymentLinkDetailSchema) })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async execute(@Param("id") id: string) {
    const result = await this.pricing.paymentLink(id);
    if (!result.ok) throwPricingError(result.error);
    return result.value;
  }
}
