import { z } from "zod";

import {
  paymentMode,
  purchaseConsentPolicy,
  type AcceptedDocument,
  type BillingQuote,
  type LegalDocument,
} from "@/entities/subscription";

/** Нажатие кнопки оплаты принимает обязательные документы своей покупки: отдельных отметок нет. */
export function acceptedPurchaseDocuments(
  documents: readonly LegalDocument[],
  quote: BillingQuote,
): AcceptedDocument[] {
  // Режим приходит из расчёта, а не из снимка витрины: по расчёту решают и панель, и приложение,
  // поэтому передать сюда устаревший снимок больше нечем.
  const { required, applicable } = purchaseConsentPolicy(
    documents,
    paymentMode(quote.snapshot),
  );
  return applicable
    .filter((document) => required.includes(document.kind))
    .map((document) => ({
      kind: document.kind,
      documentId: document.documentId,
      version: document.version,
      digest: document.digest,
    }));
}

/** Промокод в границах контракта расчёта: сервер сравнивает его с учётом регистра. */
export const promoCodeSchema = z.string().trim().min(1).max(100);

/**
 * Промокод из персональной ссылки `?promo=`. Повтор параметра и значение вне контракта расчёта
 * не угадываются: страница показывает обычную цену.
 */
export function promoCodeFromQuery(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = promoCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const quoteInputSchema = z.strictObject({
  operationId: z.uuid(),
  paymentOptionId: z.uuid(),
  optionRevision: z.number().int().positive(),
  promoCode: promoCodeSchema.optional(),
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
/**
 * Подтверждение покупки объявляется один раз: перезагрузка экрана возврата читает ту же покупку,
 * и соседним вкладкам узнавать о ней снова нечего.
 */
const confirmedStorageKey = "inside.billing.purchase.confirmed";
export function rememberConfirmedPurchase(purchaseRef: string): void {
  try {
    window.sessionStorage.setItem(confirmedStorageKey, purchaseRef);
  } catch {
    // Без хранилища перезагрузка объявит покупку ещё раз: лишнее перечитывание, а не потеря.
  }
}
export function purchaseConfirmationRemembered(purchaseRef: string): boolean {
  try {
    return window.sessionStorage.getItem(confirmedStorageKey) === purchaseRef;
  } catch {
    return false;
  }
}
export function forgetPurchase(): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Забывать нечего: следующий возврат просто прочитает состояние подписки.
  }
}
