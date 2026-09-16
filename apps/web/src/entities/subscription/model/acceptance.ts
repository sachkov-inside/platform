import type { BillingQuote, PriceSnapshot, SubscriptionView } from "./billing-contract";
import { paymentMode } from "./billing-contract";
import type { ShownRenewalTerms } from "./legal-documents";
import { formatBillingDate, formatKopecks, formatMonths } from "./presentation";

/**
 * Условия и оферты принимаются нажатием кнопки оплаты, без отметок (путь A, Workspace #185). Подпись
 * кнопки уходит в журнал принятия вместе с редакциями, поэтому её называет одно место.
 */
export function checkoutButtonLabel(snapshot: PriceSnapshot): string {
  const price = formatKopecks(snapshot.firstPriceKopecks);
  return paymentMode(snapshot) === "subscription"
    ? `Оформить подписку и оплатить ${price}`
    : `Оплатить ${price}`;
}

/** Название действия кнопки для строки о принятии: подпись без суммы, которая стоит на самой кнопке. */
export function checkoutActionName(snapshot: PriceSnapshot): string {
  return paymentMode(snapshot) === "subscription"
    ? "Оформить подписку и оплатить"
    : "Оплатить";
}

export const resumeRenewalButtonLabel = "Возобновить автопродление";

/** Возраст — пункт условий использования; у оплаты о нём напоминает одна строка без отметки. */
export const underageNotice =
  "До 18 лет покупку оформляйте с согласия законного представителя.";

const moscowCalendarDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Календарный день по Москве в виде `YYYY-MM-DD`: так его сверяет сервер. */
export function moscowDay(instant: Date): string {
  return moscowCalendarDay.format(instant);
}

/**
 * Условия продления у кнопки новой подписки. Первый период начнётся с подтверждения оплаты,
 * поэтому день следующего списания считается от сохранённого расчёта: его и видит покупатель.
 */
export function renewalTermsAtCheckout(quote: BillingQuote): ShownRenewalTerms {
  const months = quote.snapshot.paymentOption.months;
  const next = new Date(quote.createdAt);
  next.setUTCMonth(next.getUTCMonth() + months);
  return {
    amountKopecks: quote.snapshot.renewalPriceKopecks,
    nextChargeOn: moscowDay(next),
    periodMonths: months,
  };
}

/** Возобновлённая подписка продолжает оплаченный срок: следующее списание — в его последний день. */
export function renewalTermsOnResume(subscription: SubscriptionView): ShownRenewalTerms {
  return {
    amountKopecks: subscription.snapshot.renewalPriceKopecks,
    nextChargeOn: moscowDay(new Date(subscription.paidUntil)),
    periodMonths: subscription.snapshot.paymentOption.months,
  };
}

/** «следующее списание 990 ₽ — 15 октября 2026 г., затем раз в 1 месяц». */
export function renewalTermsLine(terms: ShownRenewalTerms): string {
  return `следующее списание ${formatKopecks(terms.amountKopecks)} — ${formatBillingDate(
    `${terms.nextChargeOn}T12:00:00+03:00`,
  )}, затем раз в ${formatMonths(terms.periodMonths)}`;
}
