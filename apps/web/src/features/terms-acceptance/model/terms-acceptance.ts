import { z } from "zod";

/**
 * Подпись кнопки экрана первого входа. Её пишет в журнал принятия сервер Web, а не браузер:
 * в записи стоит ровно та подпись, которую человек видел.
 */
export const termsAcceptanceButtonLabel = "Принять условия и продолжить";

export const termsStatusSchema = z.object({
  ok: z.literal(true),
  accepted: z.boolean(),
  previouslyAccepted: z.boolean(),
  document: z.object({
    documentId: z.literal("terms"),
    version: z.string().min(1),
    digest: z.string().length(64),
    url: z.url({ protocol: /^https?$/u }),
  }),
});
export type TermsStatus = z.infer<typeof termsStatusSchema>;

export const acceptTermsInputSchema = z.strictObject({
  operationId: z.uuid(),
  version: z.string().min(1).max(100),
  digest: z.string().length(64),
});
export type AcceptTermsInput = z.infer<typeof acceptTermsInputSchema>;

export const acceptTermsResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accepted") }).strict(),
  z.object({ kind: z.literal("document_changed") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);
export type AcceptTermsResult = z.infer<typeof acceptTermsResultSchema>;

/**
 * Куда вернуть человека после экрана: только адрес этого же сайта. Внешний адрес, `//host` и
 * обратная косая черта превращаются в главную, чтобы экран нельзя было сделать переходником.
 */
export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  return value;
}

/** Адрес экрана первого входа, который вернёт человека туда, куда он шёл. */
export function welcomePath(returnTo: string): string {
  return `/welcome?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
