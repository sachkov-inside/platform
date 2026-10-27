/**
 * Покупатель платежа. До имён людей (#1721, `@/entities/authoring-person`: `PersonIdentity` и
 * `usePersonIdentities`) здесь нейтральная заглушка без имени и email: «Покупатель» и начало номера
 * его аккаунта, по которому строки одного человека узнаются. Замена на `PersonIdentity` — правка
 * только этого модуля; таблица и страница платежа берут покупателя отсюда.
 */
export function PaymentBuyer({ accountId }: { readonly accountId: string }) {
  return <>Покупатель {paymentBuyerShortId(accountId)}</>;
}

/** Начало номера аккаунта: восемь знаков, достаточно, чтобы различать строки списка. */
export function paymentBuyerShortId(accountId: string): string {
  return accountId.slice(0, 8).toUpperCase();
}
