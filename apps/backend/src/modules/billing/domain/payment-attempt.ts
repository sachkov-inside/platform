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
 * Почему покупка снята до отправки в банк:
 * - `sale_closed`: цена в архиве или каталог не подтверждает единственный продукт снимка к продаже
 *   (продукт в архиве, не найден или снимок не называет ровно один продукт);
 * - `price_unavailable`: цены продукта нет или покупка с витрины, а цена снята с витрины;
 * - `already_owned`: продукт уже есть у покупателя;
 * - `unsupported_attempt`: попытка сохранена по условиям, которые разовая покупка не отправляет.
 * Init не уходил, поэтому денег банк не брал.
 */
export const retirementReasonSchema = z.enum([
  "sale_closed",
  "price_unavailable",
  "already_owned",
  "unsupported_attempt",
]);
export type RetirementReason = z.infer<typeof retirementReasonSchema>;
