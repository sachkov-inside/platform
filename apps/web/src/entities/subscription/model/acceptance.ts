import type { PriceSnapshot } from "./billing-contract";

import { formatKopecks } from "./presentation";

/**
 * Условия и оферты принимаются нажатием кнопки оплаты, без отметок (путь A, Workspace #185). Подпись
 * кнопки уходит в журнал принятия вместе с редакциями, поэтому её называет одно место.
 */
export function checkoutButtonLabel(snapshot: PriceSnapshot): string {
  return `Оплатить ${formatKopecks(snapshot.firstPriceKopecks)}`;
}
export function checkoutActionName(_snapshot: PriceSnapshot): string {
  return "Оплатить";
}

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
