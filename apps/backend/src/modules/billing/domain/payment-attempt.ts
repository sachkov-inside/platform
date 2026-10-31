import { z } from "zod";

/**
 * Вид попытки оплаты. Разовая покупка стоит рядом с подпиской: она оплачивается один раз,
 * не создаёт расписание и не сохраняет привязку карты.
 */
export const attemptKindSchema = z.enum([
  "initial",
  "one_time",
  "renewal",
  "upgrade",
]);
export type AttemptKind = z.infer<typeof attemptKindSchema>;
export const attemptStateSchema = z.enum([
  "prepared",
  "sent",
  "unknown",
  "pending",
  "authorized",
  "confirmed",
  "failed",
]);
export type AttemptState = z.infer<typeof attemptStateSchema>;

/**
 * Покупка по сохранённому расчёту: покупатель начинает её сам, она держит резерв цены и
 * получает собственную ссылку на оплату. Продление и повышение идут по уже принятым условиям.
 */
export function isQuotedPurchase(kind: AttemptKind): boolean {
  return kind === "initial" || kind === "one_time";
}

/**
 * Почему покупка снята до отправки в банк: продажа закрыта (цена или продукт в архиве), цена
 * снята с витрины или её нет, продукт уже есть у покупателя, попытка сохранена по условиям,
 * которые разовая покупка больше не отправляет. Init не уходил, поэтому денег банк не брал.
 */
export const retirementReasonSchema = z.enum([
  "sale_closed",
  "price_unavailable",
  "already_owned",
  "unsupported_attempt",
]);
export type RetirementReason = z.infer<typeof retirementReasonSchema>;
