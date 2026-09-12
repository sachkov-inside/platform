/**
 * Публичный каталог цен для страниц, которым нужен только он. Страница закрытого материала
 * спрашивает, продаётся ли руководство, и не должна тянуть за собой платёжные команды, согласия
 * и серверную сессию покупателя из широкого входа `subscription.server`.
 */
export {
  loadBillingOffers,
  loadGuideOffers,
  type CatalogQuery,
  type OffersResult,
} from "./subscription/api/billing-catalog.server";
