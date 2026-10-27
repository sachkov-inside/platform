import { productCapability } from "@inside/access-capabilities";
import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";
import {
  applicablePromotion,
  discountedPrice,
  failure,
  promotionSchema,
  type PriceSnapshot,
  type PricingResult,
} from "../domain/pricing.js";
import { promotionUsage } from "./promotion-usage.js";
export interface SelectPriceOptions {
  readonly allowUnpublished?: boolean;
}
type ProductPriceRow = Awaited<
  ReturnType<BillingPrisma["billingProductPrice"]["findMany"]>
>[number];
export async function selectPrice(
  tx: BillingPrisma,
  productId: string,
  now: Date,
  promoCode?: string,
  options: SelectPriceOptions = {},
): Promise<PricingResult<PriceSnapshot, "not_found" | "unsupported_amount">> {
  const row = await tx.billingProductPrice.findUnique({ where: { productId } });
  if (row === null) return failure("not_found");
  const prices = await selectPricesForOptions(
    tx,
    [row],
    now,
    promoCode,
    options,
  );
  return prices.get(productId) ?? failure("not_found");
}
/** Historical snapshot field names are decoded passively. New commerce has exactly one Product Price. */
export async function selectPricesForOptions(
  tx: BillingPrisma,
  rows: readonly ProductPriceRow[],
  now: Date,
  promoCode?: string,
  options: SelectPriceOptions = {},
) {
  const result = new Map<
    string,
    PricingResult<PriceSnapshot, "not_found" | "unsupported_amount">
  >();
  if (rows.length === 0) return result;
  const promotions = (
    await tx.billingPromotion.findMany({
      where: {
        archived: false,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [
          { code: null },
          ...(promoCode === undefined ? [] : [{ code: promoCode }]),
        ],
      },
    })
  ).map((row) =>
    promotionSchema.parse({
      id: row.id,
      revision: row.revision,
      name: row.name,
      percent: row.percent,
      code: row.code,
      productIds: row.productIds,
      usageLimit: row.usageLimit,
      archived: row.archived,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    }),
  );
  const usage = await promotionUsage(
    tx,
    promotions.filter((p) => p.usageLimit !== null).map((p) => p.id),
  );
  for (const row of rows) {
    if (row.archived || (!row.published && options.allowUnpublished !== true)) {
      result.set(row.productId, failure("not_found"));
      continue;
    }
    const option = {
      id: row.productId,
      offerId: row.productId,
      revision: row.revision,
      mode: "one_time" as const,
      months: 3,
      priceKopecks: Number(row.priceKopecks),
      archived: false,
    };
    const best = promotions
      .filter(
        (p) =>
          applicablePromotion(p, option, now, promoCode) &&
          (p.usageLimit === null || (usage.get(p.id) ?? 0) < p.usageLimit),
      )
      .sort((a, b) => {
        const difference = b.percent - a.percent;
        return difference !== 0 ? difference : a.id.localeCompare(b.id);
      })[0];
    const firstPriceKopecks = discountedPrice(
      option.priceKopecks,
      best?.percent ?? 0,
    );
    if (firstPriceKopecks <= 0) {
      result.set(row.productId, failure("unsupported_amount"));
      continue;
    }
    result.set(row.productId, {
      ok: true,
      value: {
        product: {
          id: row.productId,
          name: row.name,
          priceRevision: row.revision,
        },
        supportMonths: 3,
        offer: {
          id: row.productId,
          revision: row.revision,
          name: row.name,
          benefits: [productCapability(row.productId)],
          coverage: { productIds: [row.productId], materialIds: [] },
          archived: false,
          published: row.published,
        },
        paymentOption: option,
        promotion: best
          ? {
              id: best.id,
              revision: best.revision,
              name: best.name,
              percent: best.percent,
            }
          : null,
        communityPolicy: "explicit",
        currency: "RUB",
        timezone: "Europe/Moscow",
        firstPriceKopecks,
        renewalPriceKopecks: option.priceKopecks,
      },
    });
  }
  return result;
}
