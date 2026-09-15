import { accessCapabilitySchema, contentScopeSchema, isEmptyContentScope, isGuideCapability, withheldAccessCapabilities } from "@inside/access-capabilities";
import { benefitPeriodsSchema } from "../domain/pricing.js";

type CatalogOffer = { readonly benefits: readonly string[] };

/** Сопровождение из предложения продукта: столько календарных месяцев с подтверждения оплаты. */
export const productSupportMonths = 6;

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
 * Сопровождение в предложении продукта длится ровно столько, сколько обещает оферта разовой покупки:
 * шесть месяцев. Бессрочное или другое по длине право разошлось бы с условиями покупки.
 */
export function productSupportOffTerm(offer: CatalogOffer & { readonly benefitPeriods: unknown }): boolean {
  if (!isProductOffer(offer) || !offer.benefits.includes("support")) return false;
  const periods = benefitPeriodsSchema.safeParse(offer.benefitPeriods);
  const support = periods.success ? periods.data.find(period => period.capability === "support") : undefined;
  return support?.months !== productSupportMonths;
}

/**
 * Что предложение не может выдавать (#648): право, которое не выдаёт ни одно основание, и отдельный
 * материал в составе. Закрытое живёт внутри продуктов, поэтому состав называет только продукты.
 */
export function offerGrantsWithheld(offer: CatalogOffer & { readonly contentScope?: unknown }): boolean {
  if (offer.benefits.some(value => withheldAccessCapabilities.some(withheld => withheld === value))) return true;
  const scope = contentScopeSchema.safeParse(offer.contentScope);
  return scope.success && scope.data.materialIds.length > 0;
}

/**
 * Тариф открыт для нового назначения: существует, не в архиве, назначаемый и с составом. Одно
 * правило для правила активации курса и сверки Tribute; владельческое назначение отвечает на
 * пустой состав отдельным кодом, чтобы владелец видел причину.
 */
export function tierOpenForAssignment(
  offer: CatalogOffer & { readonly archived: boolean; readonly availableForAssignment: boolean; readonly contentScope: unknown },
): boolean {
  return !offer.archived && offer.availableForAssignment && !tierLacksComposition(offer);
}

/** Подписка продаётся только тарифом с составом; разовое предложение продукта её не включает. */
export function sellsSubscription(offer: CatalogOffer & { readonly contentScope: unknown }): boolean {
  return !isProductOffer(offer) && !tierLacksComposition(offer);
}
