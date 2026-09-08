import { z } from "zod";
export const contactSchema = z.object({
  email: z.email(),
  revision: z.number().int().positive(),
  verifiedAt: z.iso.datetime(),
});
export const readContactSchema = z.object({
  ok: z.literal(true),
  contact: contactSchema.nullable(),
});
export const startContactInputSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  email: z.email(),
});
export const confirmContactInputSchema = z.strictObject({
  operationId: z.uuid(),
  challengeRef: z.uuid(),
  code: z.string().regex(/^[0-9]{6}$/u),
});
export const contactFailureSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
});
export const startContactResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    challengeRef: z.uuid(),
    expiresAt: z.iso.datetime(),
    delivery: z.enum(["sent", "unknown"]),
  }),
  contactFailureSchema,
]);
export const confirmContactResultSchema = z.union([
  z.object({ ok: z.literal(true), revision: z.number().int().positive() }),
  contactFailureSchema,
]);
export type BillingContact = z.infer<typeof contactSchema>;
export type StartContactInput = z.infer<typeof startContactInputSchema>;
export type ConfirmContactInput = z.infer<typeof confirmContactInputSchema>;
export type StartContactResult = z.infer<typeof startContactResultSchema>;
export type ConfirmContactResult = z.infer<typeof confirmContactResultSchema>;
export function contactErrorMessage(code: string): string {
  switch (code) {
    case "challenge_invalid":
      return "Код неверный или устарел. Проверьте последнее письмо или запросите новый код.";
    case "rate_limited":
      return "Слишком много запросов. Подождите перед отправкой нового кода.";
    case "revision_conflict":
      return "Email изменён в другой вкладке. Обновите данные и повторите действие.";
    case "unauthorized":
    case "forbidden":
      return "Сессия завершилась. Войдите снова.";
    case "invalid_input":
      return "Проверьте адрес и шестизначный код.";
    case "provider_unavailable":
      return "Подтверждение email сейчас недоступно. Попробуйте позже.";
    default:
      return "Не удалось получить результат. Повторите действие — повторный запрос безопасен.";
  }
}
