import { accessCapabilitySchema, contentScopeSchema, isEmptyContentScope, isGuideCapability, isWithheldCapability } from "@inside/access-capabilities";
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

function supportPeriodMonths(offer: { readonly benefitPeriods: unknown }): number | null | undefined {
  const periods = benefitPeriodsSchema.safeParse(offer.benefitPeriods);
  return periods.success ? periods.data.find(period => period.capability === "support")?.months : undefined;
}

/**
 * Сопровождение в предложении продукта длится столько, сколько обещает оферта: шесть месяцев.
 * Черновик без сопровождения сохраняется, а сопровождение с другим сроком — нет.
 */
export function productSupportTermMismatch(offer: CatalogOffer & { readonly benefitPeriods: unknown }): boolean {
  return isProductOffer(offer) && offer.benefits.includes("support") && supportPeriodMonths(offer) !== productSupportMonths;
}

/**
 * Покупка продукта — это материалы продукта и сопровождение. Продаётся только предложение продукта,
 * которое даёт сопровождение на срок оферты.
 */
export function productOfferUnsellable(offer: CatalogOffer & { readonly benefitPeriods: unknown }): boolean {
  return isProductOffer(offer) && (!offer.benefits.includes("support") || supportPeriodMonths(offer) !== productSupportMonths);
}

/**
 * Что предложение не может выдавать: право, которое не выдаёт ни одно основание, и отдельный
 * материал в составе. Закрытое живёт внутри продуктов, поэтому состав называет только продукты.
 */
export function offerGrantsWithheld(offer: CatalogOffer & { readonly contentScope?: unknown }): boolean {
  if (offer.benefits.some(isWithheldCapability)) return true;
  const scope = contentScopeSchema.safeParse(offer.contentScope);
  return scope.success && scope.data.materialIds.length > 0;
}

/**
 * Тариф открыт для нового назначения: существует, не в архиве, назначаемый, с составом и без того,
 * что не выдаётся. Одно правило для правила активации курса и сверки Tribute; владельческое
 * назначение отвечает на то же отдельным кодом, чтобы владелец видел причину.
 */
export function tierOpenForAssignment(
  offer: CatalogOffer & { readonly archived: boolean; readonly availableForAssignment: boolean; readonly contentScope: unknown },
): boolean {
  return !offer.archived && offer.availableForAssignment && !tierLacksComposition(offer) && !offerGrantsWithheld(offer);
}

/** Подписка продаётся только тарифом с составом; разовое предложение продукта её не включает. */
export function sellsSubscription(offer: CatalogOffer & { readonly contentScope: unknown }): boolean {
  return !isProductOffer(offer) && !tierLacksComposition(offer);
}
