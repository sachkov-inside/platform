import type { BillingPricing } from "../../../billing/index.js";
import { productSaleAvailabilityQuerySchema } from "../../../billing/index.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type { ProductDirectory } from "../../../materials/index.js";

/** Purchase invitations require both current reader visibility and the buyer's sale admission. */
export async function readProductSaleAvailability(
  dependencies: {
    readonly directory: Pick<ProductDirectory, "readerVisibleIds">;
    readonly pricing: Pick<BillingPricing, "saleAvailability">;
    readonly contentAccess: Pick<ContentAccess, "checkProductAccessMany">;
  },
  input: unknown,
  subject: Subject,
) {
  const parsed = productSaleAvailabilityQuerySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request" } } as const;
  const productIds = [...new Set(parsed.data.productIds)];
  const visible = await dependencies.directory.readerVisibleIds(productIds, {
    subject,
    contentAccess: dependencies.contentAccess,
  });
  if (!visible.ok) return visible;
  if (visible.value.length === 0)
    return {
      ok: true,
      value: {
        items: productIds.map((productId) => ({ productId, sold: false })),
      },
    } as const;
  const admitted = await dependencies.pricing.saleAvailability(
    { productIds: visible.value },
    subject.kind === "account" ? subject.accountId : undefined,
  );
  if (!admitted.ok) return admitted;
  const sold = new Set(
    admitted.value.items
      .filter((item) => item.sold)
      .map((item) => item.productId),
  );
  return {
    ok: true,
    value: {
      items: productIds.map((productId) => ({
        productId,
        sold: sold.has(productId),
      })),
    },
  } as const;
}
