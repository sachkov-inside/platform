/**
 * Публичный каталог цен для страниц, которым нужен только он. Страница закрытого материала
 * спрашивает, продаётся ли руководство, и не должна тянуть за собой платёжные команды, согласия
 * и серверную сессию покупателя из широкого входа `subscription.server`.
 */
export {
  loadProductSalesState,
  loadProductSalesStates,
  loadProductOffers,
} from "./subscription/api/billing-catalog.server";
