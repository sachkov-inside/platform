import { z } from "zod";

import {
  paymentMode,
  purchaseConsentPolicy,
  type AcceptedDocument,
  type BillingQuote,
  type LegalDocument,
  type LegalDocumentKind,
} from "@/entities/subscription";

/**
 * Документы, которые уходят в команду вместе с покупкой. Вид документа не различает оферты:
 * разовая покупка и подписка обе `terms`, а различает их область применения. Поэтому отбор идёт
 * по тому же правилу, которым покупателю показывают документы, — иначе в команду попали бы обе
 * оферты сразу, и приложение отвергло бы её как повторяющиеся виды.
 */
export function acceptedPurchaseDocuments(
  documents: readonly LegalDocument[],
  quote: BillingQuote,
  accepted: readonly LegalDocumentKind[],
): AcceptedDocument[] {
  // Режим приходит из расчёта, а не из снимка витрины: по расчёту решают и панель, и приложение,
  // поэтому передать сюда устаревший снимок больше нечем.
  return purchaseConsentPolicy(documents, paymentMode(quote.snapshot))
    .applicable.filter((document) => accepted.includes(document.kind))
    .map((document) => ({
      kind: document.kind,
      documentId: document.documentId,
      version: document.version,
      digest: document.digest,
    }));
}

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
  // Разовой покупке довольно одной оферты, подписке нужна ещё и согласие на списания. Нижняя
  // граница здесь повторяет контракт приложения: он принимает от одного свидетельства.
  consentEvidenceRefs: z.array(z.uuid()).min(1).max(4),
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
