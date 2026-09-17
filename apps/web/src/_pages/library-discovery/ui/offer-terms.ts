import { fillOfferTerms } from "@/entities/guide-page";
import { oneTimeTermLabels } from "@/features/billing-checkout";

/**
 * Сроки называет действующая оферта разовой покупки: автор пишет в описании продукта подстановку
 * `{access_term}` или `{support_term}`, а страница подставляет подписи оферты.
 */
const offerTerms = { access: oneTimeTermLabels.materialsAndChat, support: oneTimeTermLabels.support };

export function fillTerms(text: string): string {
  return fillOfferTerms(text, offerTerms);
}
