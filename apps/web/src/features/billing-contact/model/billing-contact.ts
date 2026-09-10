import { z } from "zod";
import {
  legalDocumentSchema,
  verifiedContactSchema,
  type LegalDocument,
  type LegalDocumentKind,
} from "@/entities/subscription";

export const contactSchema = verifiedContactSchema;
export const readContactSchema = z.object({
  ok: z.literal(true),
  contact: contactSchema.nullable(),
  documents: z.array(legalDocumentSchema).default([]),
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
export const contactFailureCodeSchema = z.enum([
  "invalid_input", "forbidden", "revision_conflict", "operation_conflict", "rate_limited",
  "challenge_invalid", "contact_required", "document_changed", "not_found", "provider_unavailable",
  "internal_error", "unauthorized", "unavailable",
]);
export const contactFailureSchema = z.object({
  ok: z.literal(false),
  code: contactFailureCodeSchema,
});
export type ContactFailure = z.infer<typeof contactFailureSchema>;
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
export type BillingContactState = z.infer<typeof readContactSchema>;
export type ContactFailureCode = z.infer<typeof contactFailureCodeSchema>;
export type ReadContactResult = BillingContactState | ContactFailure;
export type { LegalDocument, LegalDocumentKind };
export type StartContactInput = z.infer<typeof startContactInputSchema>;
export type ConfirmContactInput = z.infer<typeof confirmContactInputSchema>;
export type StartContactResult = z.infer<typeof startContactResultSchema>;
export type ConfirmContactResult = z.infer<typeof confirmContactResultSchema>;
export function contactErrorMessage(code: ContactFailureCode): string {
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
    case "contact_required":
      return "Сначала подтвердите email для чеков.";
    case "document_changed":
      return "Условия обновились. Обновите страницу и примите действующую редакцию.";
    case "not_found":
      return "Мы не нашли эту операцию.";
    case "operation_conflict":
      return "Эта операция уже выполнена с другими данными. Обновите страницу и повторите.";
    case "internal_error":
    case "unavailable":
      return "Не удалось получить результат. Повторите действие — повторный запрос безопасен.";
  }
}
