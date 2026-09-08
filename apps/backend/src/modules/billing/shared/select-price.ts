import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";
import { applicablePromotion, discountedPrice, failure, offerSchema, optionSchema, promotionSchema, type PriceSnapshot, type PricingResult } from "../domain/pricing.js";

export async function selectPrice(tx: BillingPrisma, optionId: string, now: Date, promoCode?: string): Promise<PricingResult<PriceSnapshot>> {
  const row = await tx.billingPaymentOption.findUnique({ where: { id: optionId }, include: { offer: true } });
  if (!row || row.archived || row.offer.archived) return failure("not_found");
  const offer = offerSchema.parse(row.offer);
  const option = optionSchema.parse({ id: row.id, offerId: row.offerId, revision: row.revision, months: row.months, priceKopecks: Number(row.priceKopecks), archived: row.archived });
  const rows = await tx.billingPromotion.findMany({ where: { archived: false, startsAt: { lte: now }, endsAt: { gt: now }, OR: [{ code: null }, ...(promoCode ? [{ code: promoCode }] : [])] } });
  const available = [];
  for (const row of rows) {
    const promotion = promotionSchema.parse({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() });
    if (!applicablePromotion(promotion, option, now, promoCode)) continue;
    const used = promotion.usageLimit === null ? 0 : await tx.billingPromoReservation.count({ where: { promotionId: promotion.id, state: { not: "failed" } } });
    if (promotion.usageLimit === null || used < promotion.usageLimit) available.push(promotion);
  }
  available.sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id));
  const best = available[0];
  const firstPriceKopecks = discountedPrice(option.priceKopecks, best?.percent ?? 0);
  if (firstPriceKopecks <= 0) return failure("unsupported_amount");
  return { ok: true, value: {
    offer, paymentOption: option, promotion: best ? { id: best.id, revision: best.revision, name: best.name, percent: best.percent } : null,
    currency: "RUB", timezone: "Europe/Moscow", firstPriceKopecks, renewalPriceKopecks: option.priceKopecks,
  } };
}
