import { benefitTerms, longestTerm } from "./presentation";
import { isProductCapability } from "@inside/access-capabilities";
import type { BillingOffer, BillingPaymentOption } from "./billing-contract";

/**
 * Сроки составляющих разовой покупки, как их задаёт предложение (оферта, раздел 4): число
 * календарных месяцев или `null` — без ограничения срока. `supportMonths` не определён, когда
 * сопровождения в составе предложения нет.
 */
export interface OneTimeOfferTerms {
  readonly materialsMonths: number | null;
  readonly chatMonths: number | null;
  readonly supportMonths?: number | null;
}

/**
 * Сроки из снимка предложения. Материалы — самый долгий срок прав на продукты предложения. Чат
 * без собственного срока в предложении живёт сроком материалов, как это записано в оферте; право
 * в Platform при этом может не иметь даты окончания — договорный срок называет эта функция.
 */
export function oneTimeOfferTerms(conditions: {
  readonly offer: BillingOffer;
  readonly paymentOption: BillingPaymentOption;
}): OneTimeOfferTerms {
  const terms = benefitTerms(conditions);
  const materials = terms.filter(
    ({ capability }) =>
      isProductCapability(capability) || capability === "materials",
  );
  const materialsMonths =
    materials.length === 0
      ? null
      : longestTerm(materials.map(({ months }) => months));
  const ownChat = conditions.offer.benefitPeriods?.find(
    ({ capability }) => capability === "community",
  );
  const support = terms.find(({ capability }) => capability === "support");
  return {
    materialsMonths,
    chatMonths: ownChat === undefined ? materialsMonths : ownChat.months,
    ...(support === undefined ? {} : { supportMonths: support.months }),
  };
}
