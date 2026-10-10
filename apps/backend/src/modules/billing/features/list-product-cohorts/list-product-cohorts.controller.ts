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
import {
  cohortListLimit,
  productCohortsSchema,
} from "./list-product-cohorts.js";

/**
 * Ответ бота закреплён в `docs/contracts/platform-billing-cohorts`, и бот отвергает лишние поля.
 * Поэтому цена после старта уходит только в ответ без заголовка `products.v1`: его читает Web.
 * Когда ответ без заголовка уберут вместе с прежним ботом, цену нужно перенести в ответ бота
 * через новую версию общего контракта, иначе страница курса молча потеряет зачёркнутую цену.
 */
const botCohortSchema = productCohortsSchema.shape.items.element.omit({
  priceAfterStartKopecks: true,
});

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
        z.strictObject({
          items: z.array(botCohortSchema).max(cohortListLimit),
        }),
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
          ? result.value.items.map((item) => ({
              productId: item.productId,
              revision: item.revision,
              name: item.name,
              stage: item.stage,
              startsOn: item.startsOn,
              nextEvent: item.nextEvent,
            }))
          : result.value.items.map((item) => ({
              productId: item.productId,
              guideId: item.productId,
              revision: item.revision,
              name: item.name,
              stage: item.stage,
              startsOn: item.startsOn,
              nextEvent: item.nextEvent,
              priceAfterStartKopecks: item.priceAfterStartKopecks,
            })),
    };
  }
}
