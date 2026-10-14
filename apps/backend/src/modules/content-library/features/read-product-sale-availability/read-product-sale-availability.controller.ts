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
import {
  BillingPricing,
  productSaleAvailabilityQuerySchema,
  productSaleAvailabilitySchema,
} from "../../../billing/index.js";
import { ProductDirectory } from "../../../materials/index.js";
import {
  CONTENT_ACCESS,
  anonymousSubject,
  type ContentAccess,
} from "../../../content-access/index.js";
import { accountId as checkedAccountId } from "../../../accounts/index.js";
import { readProductSaleAvailability } from "./read-product-sale-availability.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";

@ApiTags("Billing")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("library/products/sale-availability")
export class ReadProductSaleAvailabilityController {
  constructor(
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
    @Inject(ProductDirectory) private readonly directory: ProductDirectory,
    @Inject(CONTENT_ACCESS)
    private readonly contentAccess: Pick<
      ContentAccess,
      "checkProductAccessMany"
    >,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "billingProductSaleAvailability",
    summary:
      "Read sale admission for a bounded set of Products without programme, cohort or price presentation",
  })
  @ApiQuery({
    name: "productId",
    required: true,
    schema: toOpenApiSchema(
      productSaleAvailabilityQuerySchema.shape.productIds,
    ),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productSaleAvailabilitySchema) })
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
    @Query("productId") productIds: unknown,
  ) {
    const subject =
      account === undefined
        ? anonymousSubject
        : ({
            kind: "account",
            accountId: checkedAccountId(account.accountId),
          } as const);
    const result = await readProductSaleAvailability(
      {
        directory: this.directory,
        contentAccess: this.contentAccess,
        pricing: this.pricing,
      },
      { productIds: Array.isArray(productIds) ? productIds : [productIds] },
      subject,
    );
    if (!result.ok)
      throw problemException(
        result.error.code === "invalid_request" ? 400 : 503,
        result.error.code,
        "Product sale availability read failed",
      );
    return result.value;
  }
}
