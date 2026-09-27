import { Controller, Get, Inject, Query } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountProblemSchema,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { BillingPricing } from "../../facets/billing-pricing/billing-pricing.js";
import { throwPricingError } from "../../shared/pricing-http.filter.js";
import { listOffersSchema, offersPageSchema } from "./list-offers.js";

@ApiTags("Billing")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("billing/offers")
export class ListOffersController {
  constructor(
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "billingOffers",
    summary:
      "Read active options and public first-payment prices, filtered by sale mode, access capability and the reader's eligibility",
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: toOpenApiSchema(listOffersSchema.shape.cursor),
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: toOpenApiSchema(listOffersSchema.shape.limit),
  })
  @ApiQuery({
    name: "mode",
    required: false,
    schema: toOpenApiSchema(listOffersSchema.shape.mode),
  })
  @ApiQuery({
    name: "capability",
    required: false,
    schema: toOpenApiSchema(listOffersSchema.shape.capability),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(offersPageSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async execute(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Query() input: unknown,
  ) {
    const result = await this.pricing.offers(input, account?.accountId);
    if (!result.ok) throwPricingError(result.error);
    return result.value;
  }
}
