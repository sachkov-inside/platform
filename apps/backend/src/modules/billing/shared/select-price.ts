import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";
import {
  applicablePromotion,
  discountedPrice,
  failure,
  offerSchema,
  optionSchema,
  promotionSchema,
  type PriceSnapshot,
  type Promotion,
  type PricingResult,
} from "../domain/pricing.js";
import {
  offerGrantsWithheld,
  productOfferUnsellable,
  tierLacksComposition,
} from "./tier-composition.js";
import { hasText } from "../../../infrastructure/contracts/text.js";

export interface SelectPriceOptions {
  /** Владельческий каталог читает и выключенные из продажи предложения; покупка их не видит. */
  readonly allowUnpublished?: boolean;
}

export async function selectPrice(
  tx: BillingPrisma,
  optionId: string,
  now: Date,
  promoCode?: string,
  options: SelectPriceOptions = {},
): Promise<PricingResult<PriceSnapshot, "not_found" | "unsupported_amount">> {
  const row = await tx.billingPaymentOption.findUnique({
    where: { id: optionId },
    include: { offer: true },
  });
  if (row === null || !priceOptionAvailable(row, options))
    return failure("not_found");
  const prices = await selectPricesForOptions(
    tx,
    [row],
    now,
    promoCode,
    options,
  );
  return prices.get(optionId) ?? failure("not_found");
}

type PriceOptionRow = Awaited<
  ReturnType<BillingPrisma["billingPaymentOption"]["findMany"]>
>[number] & {
  offer: Awaited<ReturnType<BillingPrisma["billingOffer"]["findMany"]>>[number];
};

/** Shared owner pricing projection; authoritative purchase callers retain their transaction. */
export async function selectPricesForOptions(
  tx: BillingPrisma,
  rows: readonly PriceOptionRow[],
  now: Date,
  promoCode?: string,
  options: SelectPriceOptions = {},
) {
  if (rows.length === 0)
    return new Map<
      string,
      PricingResult<PriceSnapshot, "not_found" | "unsupported_amount">
    >();
  const promotionRows = await tx.billingPromotion.findMany({
    where: {
      archived: false,
      startsAt: { lte: now },
      endsAt: { gt: now },
      AND: [
        {
          OR: [
            { code: null },
            ...(hasText(promoCode) ? [{ code: promoCode }] : []),
          ],
        },
        {
          OR: [
            { offerIds: { isEmpty: true } },
            {
              offerIds: {
                hasSome: [...new Set(rows.map((row) => row.offerId))],
              },
            },
          ],
        },
        {
          OR: [
            { paymentOptionIds: { isEmpty: true } },
            { paymentOptionIds: { hasSome: rows.map((row) => row.id) } },
          ],
        },
      ],
    },
  });
  const promotions = promotionRows.map((row) =>
    promotionSchema.parse({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    }),
  );
  const limitedIds = promotions
    .filter((promotion) => promotion.usageLimit !== null)
    .map((promotion) => promotion.id);
  const counts =
    limitedIds.length === 0
      ? []
      : await tx.billingPromoReservation.groupBy({
          by: ["promotionId"],
          where: { promotionId: { in: limitedIds }, state: { not: "failed" } },
          _count: { _all: true },
        });
  const usage = new Map(
    counts.map((row) => [row.promotionId, row._count._all]),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      projectPrice(row, now, promoCode, options, promotions, usage),
    ]),
  );
}

function projectPrice(
  row: PriceOptionRow,
  now: Date,
  promoCode: string | undefined,
  options: SelectPriceOptions,
  promotions: readonly Promotion[],
  usage: ReadonlyMap<string | null, number>,
): PricingResult<PriceSnapshot, "not_found" | "unsupported_amount"> {
  if (!priceOptionAvailable(row, options)) return failure("not_found");
  const offer = offerSchema.parse({
    id: row.offer.id,
    name: row.offer.name,
    revision: row.offer.revision,
    benefits: row.offer.benefits,
    archived: row.offer.archived,
    published: row.offer.published,
    availableForAssignment: row.offer.availableForAssignment,
    coverage: row.offer.coverage,
    eligibility: row.offer.eligibility,
    ...(Array.isArray(row.offer.benefitPeriods) &&
    row.offer.benefitPeriods.length > 0
      ? { benefitPeriods: row.offer.benefitPeriods }
      : {}),
  });
  const option = optionSchema.parse({
    id: row.id,
    offerId: row.offerId,
    revision: row.revision,
    months: row.months,
    mode: row.mode,
    priceKopecks: Number(row.priceKopecks),
    archived: row.archived,
  });
  const available = [];
  for (const promotion of promotions) {
    if (!applicablePromotion(promotion, option, now, promoCode)) continue;
    const used = usage.get(promotion.id) ?? 0;
    if (promotion.usageLimit === null || used < promotion.usageLimit)
      available.push(promotion);
  }
  available.sort((a, b) =>
    b.percent !== a.percent ? b.percent - a.percent : a.id.localeCompare(b.id),
  );
  const best = available[0];
  const firstPriceKopecks = discountedPrice(
    option.priceKopecks,
    best?.percent ?? 0,
  );
  if (firstPriceKopecks <= 0) return failure("unsupported_amount");
  return {
    ok: true,
    value: {
      offer,
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
  };
}

function priceOptionAvailable(
  row: PriceOptionRow,
  options: SelectPriceOptions,
): boolean {
  if (
    row.archived ||
    row.offer.archived ||
    (options.allowUnpublished !== true && !row.offer.published)
  )
    return false;
  // Catalog rows cannot sell an empty composition or withheld benefits through another read path.
  return (
    options.allowUnpublished === true ||
    !(
      tierLacksComposition(row.offer) ||
      productOfferUnsellable(row.offer) ||
      offerGrantsWithheld(row.offer)
    )
  );
}
