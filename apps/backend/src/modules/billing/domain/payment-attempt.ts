import { z } from "zod";

/**
 * Вид попытки оплаты. Разовая покупка стоит рядом с подпиской: она оплачивается один раз,
 * не создаёт расписание и не сохраняет привязку карты.
 */
export const attemptKindSchema = z.enum(["initial", "one_time", "renewal", "upgrade"]);
export type AttemptKind = z.infer<typeof attemptKindSchema>;
export const attemptStateSchema = z.enum(["prepared", "sent", "unknown", "pending", "authorized", "confirmed", "failed"]);
export type AttemptState = z.infer<typeof attemptStateSchema>;

/**
 * Покупка по сохранённому расчёту: покупатель начинает её сам, она держит резерв цены и
 * получает собственную ссылку на оплату. Продление и повышение идут по уже принятым условиям.
 */
export function isQuotedPurchase(kind: string): kind is "initial" | "one_time" {
  return kind === "initial" || kind === "one_time";
}
