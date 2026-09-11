import { z } from "zod";

export const notificationPreferencesSchema = z.object({
  revision: z.number().int().nonnegative(),
  email: z.boolean(),
  telegram: z.boolean(),
});
export const notificationFailureCodeSchema = z.enum([
  "invalid_input",
  "revision_conflict",
  "operation_conflict",
  "unauthorized",
  "unavailable",
]);
const failureSchema = z.object({
  ok: z.literal(false),
  code: notificationFailureCodeSchema,
});
const successSchema = z.object({
  ok: z.literal(true),
  preferences: notificationPreferencesSchema,
});
export const notificationPreferencesResultSchema = z.union([
  successSchema,
  failureSchema,
]);
export const changeNotificationPreferencesInputSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  email: z.boolean(),
  telegram: z.boolean(),
});

export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export type NotificationFailureCode = z.infer<
  typeof notificationFailureCodeSchema
>;
export type NotificationPreferencesResult = z.infer<
  typeof notificationPreferencesResultSchema
>;
export type ChangeNotificationPreferencesInput = z.infer<
  typeof changeNotificationPreferencesInputSchema
>;

/** Ожидаемые исходы объясняются словами владельца аккаунта: повтор здесь безопасен. */
export function notificationErrorMessage(code: NotificationFailureCode): string {
  switch (code) {
    case "revision_conflict":
      return "Настройки изменились в другой вкладке. Обновите данные и повторите.";
    case "operation_conflict":
      return "Эта операция уже выполнена с другими данными. Обновите страницу и повторите.";
    case "invalid_input":
      return "Не удалось сохранить выбор. Обновите страницу и повторите.";
    case "unauthorized":
      return "Сессия завершилась. Войдите снова.";
    case "unavailable":
      return "Настройки уведомлений сейчас недоступны. Повторите попытку позже.";
  }
}
