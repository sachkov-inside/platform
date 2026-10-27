import { z } from "zod";

import {
  addMoscowDays,
  moscowDayOf,
  moscowDayStart,
  moscowDayStartIso,
} from "@/shared/lib/moscow-day";
import {
  formatMoscowDate,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";

const dateSchema = z.iso.date();

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
  const endDay = addMoscowDays(date, 1);
  if (moscowDayStart(endDay).getTime() <= clock().getTime())
    return { ok: false, error: "Дата окончания не может быть в прошлом" };
  return { ok: true, expiresAt: moscowDayStartIso(endDay) };
}

/**
 * Срок ссылки словами. Полночь по Москве показана последним днём действия («по 31 окт. 2026»),
 * другой момент из прежних ссылок показан со временем.
 */
export function paymentLinkExpiryLabel(expiresAt: string | null): string {
  if (expiresAt === null) return "Без срока";
  const instant = new Date(expiresAt);
  const lastDay = new Date(instant.getTime() - 1);
  return moscowDayStart(moscowDayOf(instant)).getTime() === instant.getTime()
    ? `по ${formatMoscowDate(moscowDayOf(lastDay))}`
    : `до ${formatMoscowDateTime(expiresAt)}`;
}
