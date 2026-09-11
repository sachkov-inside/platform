import { z } from "zod";

export const quoteInputSchema = z.strictObject({
  operationId: z.uuid(),
  paymentOptionId: z.uuid(),
  optionRevision: z.number().int().positive(),
  promoCode: z.string().trim().min(1).max(100).optional(),
});
export const purchaseInputSchema = z.strictObject({
  operationId: z.uuid(),
  quoteRef: z.uuid(),
  contactRevision: z.number().int().positive(),
  consentEvidenceRefs: z.array(z.uuid()).min(2).max(4),
  acknowledgeExistingAccess: z.boolean(),
});
export const purchaseRefSchema = z.uuid();

export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

/** Ссылка на начатую покупку переживает уход в банк, поэтому возврат находит её состояние. */
const storageKey = "inside.billing.purchase";
export function rememberPurchase(purchaseRef: string): void {
  try {
    window.sessionStorage.setItem(storageKey, purchaseRef);
  } catch {
    // Приватное окно и запрет хранилища допустимы: возврат тогда читает состояние подписки.
  }
}
export function recallPurchase(): string | undefined {
  try {
    const value = window.sessionStorage.getItem(storageKey);
    return value === null ? undefined : purchaseRefSchema.parse(value);
  } catch {
    return undefined;
  }
}
export function forgetPurchase(): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Забывать нечего: следующий возврат просто прочитает состояние подписки.
  }
}
