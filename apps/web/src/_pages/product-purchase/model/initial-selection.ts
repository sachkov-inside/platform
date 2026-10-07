import type { PriceSnapshot } from "@/entities/subscription";

/**
 * Первый выбранный тариф: первый вариант оплаты предложения из адреса, если витрина его продаёт,
 * иначе первый тариф витрины. Чужое или снятое с продажи предложение выбор не ломает.
 */
export function initialPaymentOptionId(
  offers: readonly PriceSnapshot[],
  offerId: string | undefined,
): string | null {
  const requested =
    offerId === undefined
      ? undefined
      : offers.find((snapshot) => snapshot.offer.id === offerId);
  return (requested ?? offers[0])?.paymentOption.id ?? null;
}
