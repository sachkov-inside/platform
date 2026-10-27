import { z } from "zod";

/**
 * Способ, которым человек впервые получил продукт (#1721). Одно слово на способ в списке людей,
 * его фильтре и карточке; само значение решает Product Access.
 */
export const accessOriginSchema = z.enum([
  "paid",
  "manual",
  "course_activation",
  "legacy",
  "unknown",
]);

export type AccessOrigin = z.infer<typeof accessOriginSchema>;

export const accessOriginLabels: Readonly<Record<AccessOrigin, string>> = {
  paid: "Покупка",
  manual: "Выдача владельцем",
  course_activation: "Активация курса",
  legacy: "Прежний доступ",
  unknown: "Способ неизвестен",
};

/** Состояние Product Access человека к одному продукту. */
export const productAccessStateSchema = z.enum(["active", "revoked"]);

export type ProductAccessState = z.infer<typeof productAccessStateSchema>;

/**
 * Общий префикс чтений людей, ответ которых зависит от Product Access: списка людей и карточки.
 * Запись доступа сбрасывает его целиком, не зная ключей каждой страницы.
 */
export const peopleAccessReadsQueryKey = [
  "authoring",
  "people",
  "access",
] as const;
