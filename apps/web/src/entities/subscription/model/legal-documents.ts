import { z } from "zod";

/**
 * Каталог применимых документов ведёт сервер: согласие принимается только при точном
 * совпадении вида, идентификатора, редакции и SHA-256 текста.
 */
export const legalDocumentKindSchema = z.enum([
  "terms",
  "recurring",
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
    case "recurring":
      return "Согласие на регулярные списания";
    case "personal_data":
      return "Обработка персональных данных";
    case "marketing":
      return "Рекламные сообщения";
  }
}

/** Покупка требует принятых `terms` и `recurring`; остальные виды независимы. */
export const requiredConsentKinds: readonly LegalDocumentKind[] = [
  "terms",
  "recurring",
];

/** Согласие фиксируется одной командой на конкретный контекст будущей операции. */
export const consentsInputSchema = z.strictObject({
  operationId: z.uuid(),
  contextRef: z.uuid(),
  documents: z.array(acceptedDocumentSchema).min(1).max(4),
});
export const consentsValueSchema = z.object({
  ok: z.literal(true),
  evidenceRefs: z.array(z.uuid()).min(1).max(4),
});
export type ConsentsInput = z.infer<typeof consentsInputSchema>;
