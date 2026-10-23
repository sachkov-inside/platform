import { z } from "zod";

import { paymentModeSchema, type PaymentMode } from "./billing-contract";

/**
 * Каталог применимых документов ведёт сервер: согласие принимается только при точном
 * совпадении вида, идентификатора, редакции и SHA-256 текста.
 */
export const legalDocumentKindSchema = z.enum([
  "terms",
  "personal_data",
  "marketing",
]);
/**
 * Сервер хранит адрес документа абсолютным. Он попадает в `href`, поэтому схема сужена до
 * http(s): прочие схемы, включая `javascript:`, отклоняются на границе.
 */
export const legalDocumentUrlSchema = z.url({ protocol: /^https?$/u });
export const legalDocumentSchema = z.object({
  kind: legalDocumentKindSchema,
  /**
   * К каким продажам относится документ. Оферта разовой покупки и оферта подписки имеют один
   * вид `terms`, поэтому покупателю показывается та из них, которая описывает его покупку.
   */
  appliesTo: z.array(paymentModeSchema).min(1),
  documentId: z.string().min(1),
  version: z.string().min(1),
  digest: z.string().length(64),
  url: legalDocumentUrlSchema,
  text: z.string(),
});
/** Ссылка на конкретную редакцию, которую покупатель принимает вместе с командой. */
export const acceptedDocumentSchema = z.object({
  kind: legalDocumentKindSchema,
  documentId: z.string().min(1),
  version: z.string().min(1),
  digest: z.string().length(64),
});
export type LegalDocumentKind = z.infer<typeof legalDocumentKindSchema>;
export type LegalDocument = z.infer<typeof legalDocumentSchema>;
export type AcceptedDocument = z.infer<typeof acceptedDocumentSchema>;

export function legalDocumentLabel(kind: LegalDocumentKind): string {
  switch (kind) {
    case "terms":
      return "Оферта и условия";
    case "personal_data":
      return "Обработка персональных данных";
    case "marketing":
      return "Рекламные сообщения";
  }
}

export interface ConsentPolicy {
  /** Без чего оплату принять нельзя. */
  readonly required: readonly LegalDocumentKind[];
  /** Что вообще показывать: лишнее согласие сервер не примет. */
  readonly applicable: readonly LegalDocument[];
}

/** Product purchase accepts its exact current one-time terms. */
export function purchaseConsentPolicy(
  documents: readonly LegalDocument[],
  _mode: PaymentMode,
): ConsentPolicy {
  const applicable = documents.filter((document) =>
    document.appliesTo.includes("one_time"),
  );
  return { required: ["terms"], applicable };
}

/** Passive decoder for immutable historical legal evidence, never a purchase command. */
export const shownRenewalTermsSchema = z.strictObject({
  amountKopecks: z.number().int().positive(),
  nextChargeOn: z.iso.date(),
  periodMonths: z.number().int().positive(),
});
export type ShownRenewalTerms = z.infer<typeof shownRenewalTermsSchema>;

/**
 * Документы принимаются нажатием кнопки оплаты одной командой на контекст будущей операции:
 * экран и подпись нажатой кнопки уходят в журнал принятия вместе с редакциями.
 */
export const consentsInputSchema = z.strictObject({
  operationId: z.uuid(),
  contextRef: z.uuid(),
  screen: z.literal("checkout"),
  buttonLabel: z.string().trim().min(1).max(200),
  documents: z.array(acceptedDocumentSchema).min(1).max(4),
});
export const consentsValueSchema = z.object({
  ok: z.literal(true),
  evidenceRefs: z.array(z.uuid()).min(1).max(4),
});
export type ConsentsInput = z.infer<typeof consentsInputSchema>;
