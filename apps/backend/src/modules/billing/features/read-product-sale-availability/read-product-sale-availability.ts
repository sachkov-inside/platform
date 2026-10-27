import {
  productCapability,
  scopeIncludesProduct,
} from "@inside/access-capabilities";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { failure, idSchema, type PricingResult } from "../../domain/pricing.js";
import { paymentAdmission } from "../../shared/payment-admission.js";
import { selectPricesForOptions } from "../../shared/select-price.js";
import type { ListOffersOptions } from "../list-offers/list-offers.js";

export const productSaleAvailabilityQuerySchema = z.strictObject({
  productIds: z.array(idSchema).max(100),
});
export const productSaleAvailabilitySchema = z.strictObject({
  items: z.array(z.strictObject({ productId: z.uuid(), sold: z.boolean() })),
});

/** Scoped sale fact; pricing and Account admission remain inside their Billing owner. */
export async function readProductSaleAvailability(
  prisma: BillingPrismaClient,
  input: unknown,
  clock: () => Date,
  options: ListOffersOptions,
): Promise<
  PricingResult<
    z.infer<typeof productSaleAvailabilitySchema>,
    "invalid_request" | "dependency_unavailable"
  >
> {
  const parsed = productSaleAvailabilityQuerySchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  const productIds = [...new Set(parsed.data.productIds)];
  if (productIds.length === 0) return { ok: true, value: { items: [] } };
  try {
    const rows = await prisma.billingProductPrice.findMany({
      where: {
        productId: { in: productIds },
        archived: false,
        published: true,
      },
      orderBy: { productId: "asc" },
    });
    const entries = await options.contentCatalog?.resolve({
      productIds,
      materialIds: [],
    });
    const available = new Set(
      entries
        ?.filter((entry) => entry.kind === "product" && entry.available)
        .map((entry) => entry.id),
    );
    const sold = new Set<string>();
    const now = clock();
    for (let offset = 0; offset < rows.length; offset += 100) {
      const prices = await selectPricesForOptions(
        prisma,
        rows.slice(offset, offset + 100),
        now,
      );
      for (const price of prices.values()) {
        if (
          !price.ok ||
          !paymentAdmission({
            snapshot: price.value,
            sale: options.sale ?? { payments: false },
          }).ok
        )
          continue;
        for (const id of productIds)
          if (
            available.has(id) &&
            (price.value.offer.benefits.includes(productCapability(id)) ||
              (price.value.offer.benefits.includes("materials") &&
                scopeIncludesProduct(
                  price.value.offer.coverage ?? {
                    productIds: [],
                    materialIds: [],
                  },
                  id,
                )))
          )
            sold.add(id);
      }
    }
    return {
      ok: true,
      value: {
        items: productIds.map((productId) => ({
          productId,
          sold: sold.has(productId),
        })),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "saleAvailability" },
      error,
      failure("dependency_unavailable"),
    );
  }
}
