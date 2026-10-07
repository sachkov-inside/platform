import { Controller, Get, Headers, Inject } from "@nestjs/common";
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
import { z } from "zod";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { productCohortsSchema } from "./list-product-cohorts.js";

/** Без кеша: владелец переключает этап в каталоге, и страница показывает его со следующего запроса. */
@ApiTags("Billing")
@PrivateNoStore()
@Controller("billing/cohorts")
export class ListProductCohortsController {
  constructor(
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "billingProductCohorts",
    // Поток — публичный факт: страница гостя и бот читают его без входа.
    security: [],
    summary:
      "Read the current cohort of every product: name, sales stage, start date and next event",
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(
      z.union([
        productCohortsSchema,
        z.strictObject({
          items: z.array(
            productCohortsSchema.shape.items.element.extend({
              guideId: z.uuid(),
            }),
          ),
        }),
      ]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async execute(
    @Headers("x-inside-domain-names") domainNames: string | undefined,
  ) {
    const result = await this.pricing.cohorts();
    if (!result.ok) throwPricingError(result.error);
    return {
      items:
        domainNames === "products.v1"
          ? result.value.items
          : result.value.items.map((item) => ({
              productId: item.productId,
              guideId: item.productId,
              revision: item.revision,
              name: item.name,
              stage: item.stage,
              startsOn: item.startsOn,
              nextEvent: item.nextEvent,
            })),
    };
  }
}
