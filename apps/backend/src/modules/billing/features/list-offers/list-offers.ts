import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accessCapabilitySchema } from "../../../membership-entitlements/index.js";
import { failure, idSchema, paymentModeSchema, priceSnapshotSchema, type PricingResult } from "../../domain/pricing.js";
import { selectPrice } from "../../shared/select-price.js";

export const listOffersSchema = z.strictObject({
  cursor: idSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Витрина подписки и витрина руководства спрашивают разные способы оплаты одного каталога. */
  mode: paymentModeSchema.optional(),
  /** Что именно открывает предложение: страница руководства спрашивает своё право. */
  capability: accessCapabilitySchema.optional(),
});
export const offersPageSchema = z.strictObject({ items: z.array(priceSnapshotSchema), nextCursor: idSchema.nullable() });
export async function listOffers(prisma: BillingPrismaClient, input: unknown, clock: () => Date): Promise<PricingResult<z.infer<typeof offersPageSchema>, "invalid_request" | "dependency_unavailable">> {
  const parsed = listOffersSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  try {
    const { cursor, limit, mode, capability } = parsed.data;
    const rows = await prisma.billingPaymentOption.findMany({ where: {
      archived: false, offer: { archived: false, ...(capability === undefined ? {} : { benefits: { has: capability } }) },
      ...(mode === undefined ? {} : { mode }), ...(cursor ? { id: { gt: cursor } } : {}),
    }, orderBy: { id: "asc" }, take: limit + 1 });
    const page = rows.slice(0, limit);
    const items = [];
    const now = clock();
    for (const row of page) {
      const price = await selectPrice(prisma, row.id, now);
      if (price.ok) items.push(price.value);
    }
    return { ok: true, value: { items, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null } };
  } catch { return failure("dependency_unavailable"); }
}
