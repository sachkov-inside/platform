import { Controller, Get, Inject } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { guideCohortsSchema } from "./list-guide-cohorts.js";

/** Без кеша: владелец переключает этап в каталоге, и страница показывает его со следующего запроса. */
@ApiTags("Billing")
@PrivateNoStore()
@Controller("billing/cohorts")
export class ListGuideCohortsController {
  constructor(
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "billingGuideCohorts",
    summary:
      "Read the current cohort of every product: name, sales stage, start date and next event",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(guideCohortsSchema) })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async execute() {
    const result = await this.pricing.cohorts();
    if (!result.ok) throwPricingError(result.error);
    return { items: result.value.items };
  }
}
