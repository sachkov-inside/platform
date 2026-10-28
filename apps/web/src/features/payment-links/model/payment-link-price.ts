import type { PriceSnapshot } from "@/entities/subscription";

import type { PaymentLinkPrice } from "./payment-link-operations";

/** Наименьшая и наибольшая сумма ссылки в копейках: границы команды `paymentLinks.create`. */
export const paymentLinkMinKopecks = 100;
export const paymentLinkMaxKopecks = 100_000_000;

/**
 * Цена по ссылке, как её задаёт владелец: как у продукта, итоговой суммой в рублях или целой
 * скидкой в процентах от цены продукта.
 */
export type PaymentLinkPriceDraft =
  | { readonly kind: "product" }
  | { readonly kind: "amount"; readonly amountKopecks: number | null }
  | { readonly kind: "discount"; readonly percentText: string };

export type PaymentLinkPricePreview =
  | {
      readonly valid: true;
      /** Что уйдёт в команду: цена продукта равна скидке 0 %. */
      readonly price: PaymentLinkPrice;
      /** Снимок продукта с ценой по ссылке: то, что покупатель увидит на странице оплаты. */
      readonly preview: PriceSnapshot;
    }
  | {
      readonly valid: false;
      readonly error: string;
      /** Снимок с прежней ценой продукта: предпросмотр не показывает неверную сумму. */
      readonly preview: PriceSnapshot;
    };

const decimalPattern = /^\d+(?:[.,]\d{1,2})?$/u;

/**
 * Предпросмотр цены ссылки. Математика перенесена без изменений из прежней панели ссылок: скидка
 * считается от `paymentOption.priceKopecks` с округлением до копейки, итог должен лежать в границах
 * команды, а процент быть целым от 0 до 99. Сервер проверяет то же самое и остаётся последним словом.
 */
export function paymentLinkPricePreview(
  snapshot: PriceSnapshot,
  draft: PaymentLinkPriceDraft,
): PaymentLinkPricePreview {
  const numeric =
    draft.kind === "discount"
      ? decimalPattern.test(draft.percentText)
        ? Number(draft.percentText.replace(",", "."))
        : NaN
      : draft.kind === "product"
        ? 0
        : NaN;
  const amount =
    draft.kind === "amount"
      ? (draft.amountKopecks ?? NaN)
      : Math.round(
          (snapshot.paymentOption.priceKopecks * (100 - numeric)) / 100,
        );
  const valid =
    Number.isSafeInteger(amount) &&
    amount >= paymentLinkMinKopecks &&
    amount <= paymentLinkMaxKopecks &&
    (draft.kind === "amount" ||
      (Number.isInteger(numeric) && numeric >= 0 && numeric <= 99));
  if (!valid)
    return {
      valid: false,
      error: priceError(draft, numeric),
      preview: snapshot,
    };
  return {
    valid: true,
    price:
      draft.kind === "amount"
        ? { kind: "amount", amountKopecks: amount }
        : { kind: "discount", percent: numeric },
    preview: { ...snapshot, firstPriceKopecks: amount },
  };
}

function priceError(draft: PaymentLinkPriceDraft, percent: number): string {
  if (draft.kind === "amount")
    return draft.amountKopecks === null
      ? "Введите сумму к оплате"
      : "Сумма должна быть от 1 до 1 000 000 ₽. Бесплатный доступ выдайте в карточке человека.";
  if (
    draft.kind === "discount" &&
    !(Number.isInteger(percent) && percent >= 0 && percent <= 99)
  )
    return "Скидка должна быть целым числом от 0 до 99 %";
  return "Итоговая цена должна быть не меньше 1 ₽";
}
