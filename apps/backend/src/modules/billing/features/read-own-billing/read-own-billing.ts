import { z } from "zod";
import {
  ownAccessGroundSchema,
  ownProductSchema,
  type AccessGrants,
} from "../../../account-rights/index.js";
import type { BillingPayments } from "../../facets/billing-payments/billing-payments.js";
import type { BillingNotices } from "../../facets/billing-notices/billing-notices.js";
import { ownPaymentSchema } from "../manage-subscription/manage-subscription.contract.js";
import { noticeViewSchema } from "../../domain/notice.js";
import { paymentFailure } from "../purchase-product/purchase-product.contract.js";
export const ownBillingSchema = z.strictObject({
  products: z.array(ownProductSchema),
  access: z.strictObject({ grounds: z.array(ownAccessGroundSchema) }),
  payments: z.array(ownPaymentSchema),
  notices: z.array(noticeViewSchema),
});
export async function readOwnBilling(
  dependencies: {
    payments: Pick<BillingPayments, "history">;
    grants: Pick<AccessGrants, "readOwnProducts" | "readOwnAccess">;
    notices: Pick<BillingNotices, "readNotices">;
  },
  accountId: string,
) {
  const [payments, products, access, notices] = await Promise.all([
    dependencies.payments.history(accountId),
    dependencies.grants.readOwnProducts(accountId),
    dependencies.grants.readOwnAccess(accountId),
    dependencies.notices.readNotices(accountId),
  ]);
  if (!payments.ok) return payments;
  if (!products.ok || !access.ok)
    return paymentFailure("dependency_unavailable");
  return {
    ok: true as const,
    value: ownBillingSchema.parse({
      products: products.value,
      access: access.value,
      payments: payments.value,
      notices,
    }),
  };
}
