import { accessCapabilitySchema, isEmptyContentScope, isGuideCapability } from "@inside/access-capabilities";
import { benefitPeriodsSchema } from "../domain/pricing.js";

type CatalogOffer = { readonly benefits: readonly string[] };

/** Предложение продукта открывает своё руководство; состав тарифа к нему не относится. */
export function isProductOffer(offer: CatalogOffer): boolean {
  return offer.benefits.some(value => {
    const capability = accessCapabilitySchema.safeParse(value);
    return capability.success && isGuideCapability(capability.data);
  });
}

/**
 * Тариф открывает материалы только через явный состав. Без состава назначение дало бы чат без
 * единого материала, а продажа — оплату пустоты, поэтому такой тариф не назначается и не продаётся.
 */
export function tierLacksComposition(offer: CatalogOffer & { readonly contentScope: unknown }): boolean {
  return !isProductOffer(offer) && isEmptyContentScope(offer.contentScope);
}

/**
 * Сопровождение в предложении продукта всегда конечно: у разовой покупки нет оплаченного периода,
 * и без собственного срока право стало бы бессрочным вопреки условиям покупки.
 */
export function productSupportIsOpenEnded(offer: CatalogOffer & { readonly benefitPeriods: unknown }): boolean {
  if (!isProductOffer(offer) || !offer.benefits.includes("support")) return false;
  const periods = benefitPeriodsSchema.safeParse(offer.benefitPeriods);
  const support = periods.success ? periods.data.find(period => period.capability === "support") : undefined;
  return support?.months === undefined || support.months === null;
}

/** Подписка продаётся только тарифом с составом; разовое предложение продукта её не включает. */
export function sellsSubscription(offer: CatalogOffer & { readonly contentScope: unknown }): boolean {
  return !isProductOffer(offer) && !tierLacksComposition(offer);
}
