import { z } from "zod";

import {
  formatMoscowDate,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";

const MOSCOW_OFFSET = "+03:00";
const DAY_MS = 86_400_000;
const dateSchema = z.iso.date();

/** Начало московских суток календарного дня «YYYY-MM-DD». */
function moscowMidnight(date: string): Date {
  return new Date(`${date}T00:00:00${MOSCOW_OFFSET}`);
}

/** Календарный день по Москве для момента. */
function moscowDay(instant: Date): string {
  return new Date(instant.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export type PaymentLinkExpiry =
  | { readonly ok: true; readonly expiresAt: string | null }
  | { readonly ok: false; readonly error: string };

/**
 * Срок ссылки из поля даты: ссылка действует по выбранный день включительно, до полуночи по Москве
 * следующего дня; прошедший день отклоняется по часам `clock`. Момент уходит в команду строкой ISO со смещением Москвы. Пустое поле значит
 * «без срока»: ссылка действует до одной оплаты или отзыва.
 */
export function paymentLinkExpiresAt(
  date: string,
  clock: () => Date = () => new Date(),
): PaymentLinkExpiry {
  if (date === "") return { ok: true, expiresAt: null };
  if (!dateSchema.safeParse(date).success)
    return { ok: false, error: "Введите дату полностью: день, месяц и год" };
  const end = new Date(moscowMidnight(date).getTime() + DAY_MS);
  if (end.getTime() <= clock().getTime())
    return { ok: false, error: "Дата окончания не может быть в прошлом" };
  return { ok: true, expiresAt: `${moscowDay(end)}T00:00:00${MOSCOW_OFFSET}` };
}

/**
 * Срок ссылки словами. Полночь по Москве показана последним днём действия («по 31 окт. 2026»),
 * другой момент из прежних ссылок показан со временем.
 */
export function paymentLinkExpiryLabel(expiresAt: string | null): string {
  if (expiresAt === null) return "Без срока";
  const instant = new Date(expiresAt);
  const lastDay = new Date(instant.getTime() - 1);
  return moscowMidnight(moscowDay(instant)).getTime() === instant.getTime()
    ? `по ${formatMoscowDate(moscowDay(lastDay))}`
    : `до ${formatMoscowDateTime(expiresAt)}`;
}
