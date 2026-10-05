import { idSchema } from "./pricing.js";

/**
 * Единственный адрес оформления Offer, на который ведут продление и покупка по ссылке. Пока
 * отдельной страницы Offer нет, это витрина подписки: она показывает Account те Offer, которые ему
 * продаются. Страница оформления Offer заменяет адрес здесь, и все ссылки меняются вместе.
 */
export function offerCheckoutPath(offerId: string): string {
  return `/subscription?${new URLSearchParams({ offer: idSchema.parse(offerId) }).toString()}`;
}
