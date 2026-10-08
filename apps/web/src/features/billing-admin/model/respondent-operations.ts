import { z } from "zod";

import { productPurchaseHref } from "@/shared/routing/subscription-route";

/** Скидка респондентам анкеты (#815): вход и исходы трёх владельческих операций billing. */
export const importRespondentsInputSchema = z.strictObject({
  operationId: z.uuid(),
  list: z.string().min(1).max(200_000),
});
export const issueRespondentLinkInputSchema = z.strictObject({
  operationId: z.uuid(),
  username: z.string().trim().min(1).max(200),
  templatePromotionId: z.uuid(),
});
export const respondentsStatusInputSchema = z.strictObject({
  operationId: z.uuid(),
});

const count = z.int().nonnegative();
export const respondentImportSchema = z.object({
  recognized: count,
  added: count,
  unrecognized: count,
  total: count,
});
export const respondentLinkSchema = z.object({
  promotionId: z.uuid(),
  code: z.string().min(1),
  productSlug: z.string().nullable(),
  alreadyIssued: z.boolean(),
});
export const respondentsViewSchema = z.object({
  total: count,
  issued: count,
  purchased: count,
  respondents: z.array(
    z.object({
      username: z.string(),
      issuedAt: z.iso.datetime().nullable(),
      purchased: z.boolean(),
    }),
  ),
});

export const respondentImportOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("respondentImport"),
    value: respondentImportSchema,
  }),
});
export const respondentLinkOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("respondentLink"),
    value: respondentLinkSchema,
  }),
});
export const respondentsOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("respondents"),
    value: respondentsViewSchema,
  }),
});

export type RespondentImport = z.infer<typeof respondentImportSchema>;
export type RespondentLink = z.infer<typeof respondentLinkSchema>;
export type RespondentsView = z.infer<typeof respondentsViewSchema>;

/**
 * Готовая ссылка для отправки человеку: страница оплаты продукта с кодом на адресе платформы. Если
 * скидка продаёт не один продукт, адрес не известен и владелец отправляет код.
 */
export function respondentLinkUrl(
  link: RespondentLink,
  origin: string,
): string | null {
  return link.productSlug === null || origin === ""
    ? null
    : new URL(
        productPurchaseHref(link.productSlug, link.code),
        origin,
      ).toString();
}
