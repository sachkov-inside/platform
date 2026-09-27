import {
  accessCapabilitySchema,
  contentScopeSchema,
  isEmptyContentScope,
  isGuideCapability,
  isWithheldCapability,
} from "@inside/access-capabilities";
import { benefitPeriodsSchema } from "../domain/pricing.js";

type CatalogOffer = { readonly benefits: readonly string[] };

/** Предложение продукта открывает своё руководство; состав тарифа к нему не относится. */
export function isProductOffer(offer: CatalogOffer): boolean {
  return offer.benefits.some((value) => {
    const capability = accessCapabilitySchema.safeParse(value);
    return capability.success && isGuideCapability(capability.data);
  });
}

/**
 * Тариф открывает материалы только через явный состав. Без состава назначение дало бы чат без
 * единого материала, а продажа — оплату пустоты, поэтому такой тариф не назначается и не продаётся.
 */
export function tierLacksComposition(
  offer: CatalogOffer & { readonly contentScope: unknown },
): boolean {
  return !isProductOffer(offer) && isEmptyContentScope(offer.contentScope);
}

/**
 * Объявленный в предложении срок права: месяцы, `null` — без срока, `undefined` — срок не назван.
 * Нечитаемые сроки читаются как не названные.
 */
function declaredMonths(
  offer: { readonly benefitPeriods: unknown },
  capability: string,
): number | null | undefined {
  const periods = benefitPeriodsSchema.safeParse(offer.benefitPeriods);
  return periods.success
    ? periods.data.find((period) => period.capability === capability)?.months
    : undefined;
}

/**
 * Сопровождение предложения продукта длится столько, сколько называет само предложение: срок
 * задаёт владелец, и без названного срока сопровождение не выдаётся бессрочным по умолчанию.
 */
function productSupportTermMissing(
  offer: CatalogOffer & { readonly benefitPeriods: unknown },
): boolean {
  return (
    offer.benefits.includes("support") &&
    declaredMonths(offer, "support") === undefined
  );
}

/**
 * Общую группу открывают право на продукт и сопровождение, поэтому срок группы, названный в
 * предложении продукта, не может быть короче их сроков: такой срок ничего бы не ограничил. Право
 * разовой покупки без названного срока — бессрочное.
 */
function productCommunityTermShorter(
  offer: CatalogOffer & { readonly benefitPeriods: unknown },
): boolean {
  const community = declaredMonths(offer, "community");
  if (!offer.benefits.includes("community") || community == null) return false;
  return offer.benefits
    .filter((value) => {
      const capability = accessCapabilitySchema.safeParse(value);
      return (
        capability.success &&
        (capability.data === "support" || isGuideCapability(capability.data))
      );
    })
    .some((value) => {
      const months = declaredMonths(offer, value);
      return months == null || months > community;
    });
}

/**
 * Сроки предложения продукта, которые нельзя сохранить: сопровождение без названного срока и
 * общая группа короче права на продукт или сопровождения. Черновик без сопровождения сохраняется.
 */
export function productOfferTermsInvalid(
  offer: CatalogOffer & { readonly benefitPeriods: unknown },
): boolean {
  return (
    isProductOffer(offer) &&
    (productSupportTermMissing(offer) || productCommunityTermShorter(offer))
  );
}

/**
 * Покупка продукта — это материалы продукта и сопровождение. Продаётся только предложение продукта,
 * которое даёт сопровождение на названный в нём срок.
 */
export function productOfferUnsellable(
  offer: CatalogOffer & { readonly benefitPeriods: unknown },
): boolean {
  return (
    isProductOffer(offer) &&
    (!offer.benefits.includes("support") || productOfferTermsInvalid(offer))
  );
}

/**
 * Что предложение не может выдавать: право, которое не выдаёт ни одно основание, и отдельный
 * материал в составе. Закрытое живёт внутри продуктов, поэтому состав называет только продукты.
 */
export function offerGrantsWithheld(
  offer: CatalogOffer & { readonly contentScope?: unknown },
): boolean {
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
  offer: CatalogOffer & {
    readonly archived: boolean;
    readonly availableForAssignment: boolean;
    readonly contentScope: unknown;
  },
): boolean {
  return (
    !offer.archived &&
    offer.availableForAssignment &&
    !tierLacksComposition(offer) &&
    !offerGrantsWithheld(offer)
  );
}

/** Подписка продаётся только тарифом с составом; разовое предложение продукта её не включает. */
export function sellsSubscription(
  offer: CatalogOffer & { readonly contentScope: unknown },
): boolean {
  return !isProductOffer(offer) && !tierLacksComposition(offer);
}
